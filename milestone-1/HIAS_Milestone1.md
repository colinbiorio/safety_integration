# ISE 350 Milestone 1 — Hardware Integration & Active Safety (HIAS)

**System Connections and Interface Plan** · Team: Colin Iorio, Jessica Horncastle, Stephen Marth

## Purpose

HIAS connects the software to the physical vehicle and keeps it safe. It:

- turns Autonomous Vehicle Control's (AVC) speed and steering commands into motor and steering-servo signals,
- reports the vehicle's state back to the other teams (wheel speed, steering angle, battery and hardware health), and
- runs a safety supervisor that can override AVC and stop the vehicle when something is unsafe or a signal is lost.

## Team 4 Questions

**What vehicle hardware do we already have?** Nothing is chosen yet *(TBD)*. Our working plan is a prebuilt RC car with a drive motor and electronic speed controller (ESC), a steering servo, and a 2S LiPo battery. We would add a wheel-speed sensor, plus a remote control (an RC transmitter or a phone app) for the operator buttons and E-STOP.

**What microcontroller will be used?** Not decided *(TBD)*; we are considering an ESP32, a Raspberry Pi, or similar. We recommend an ESP32: it has real-time PWM outputs for the ESC and servo, inputs for the wheel sensor and battery voltage, and built-in Wi-Fi/Bluetooth for a phone remote.

**How might the motor connect to the controller?** A microcontroller PWM pin drives the ESC signal wire, and the ESC drives the motor. The signal is standard servo-style PWM: 50 Hz, a 1.0–2.0 ms pulse, with 1.5 ms = neutral. HIAS converts `cmd_speed` (m/s) into a pulse width using a calibration table.

**How might steering connect to the controller?** A second microcontroller PWM pin drives the steering servo. HIAS converts `cmd_steering_angle` (rad) into a pulse width (1.5 ms = straight) and limits it to ±25°.

**What information does the hardware need from Control?** `cmd_speed` and `cmd_steering_angle` at 50 Hz. While `emergency_stop` is TRUE, AVC should command 0 m/s and reset its speed controller, so the car does not lurch when the stop is released.

**What conditions should cause the vehicle to stop?** The main rule, in the template's format:

> **If** `obstacle_ttc` < 1.5 s **or** `obstacle_distance` < 0.5 m, **then** `emergency_stop` = TRUE (automatic emergency braking, AEB).

The vehicle also stops if:

- the operator presses E-STOP, or the remote link is lost for more than 0.5 s;
- any input signal is missing, stale or invalid, including `sensor_valid` = FALSE;
- the battery drops below 6.4 V;
- the wheel-speed sensor fails; or
- the vehicle goes faster than 4.0 m/s.

All thresholds are starting values that will be tuned in testing.

**How will the emergency-stop signal override normal operation?** HIAS is the last stage before the motor and servo. It passes AVC's speed command through only in the ACTIVE state; in every other state, HIAS commands the stop itself. The override therefore does not depend on any other team responding. `emergency_stop` tells AVC and Motion Planning to command zero and reset. As a hardware backup, we recommend an on-car kill switch that cuts power to the ESC. HIAS also powers up in STANDBY with the motor at neutral.

**What happens if sensor information is unavailable?** The vehicle stops. If any of Perception's data is missing, stale, or flagged `sensor_valid` = FALSE, HIAS brakes to a stop at full braking, because the vehicle can no longer see ahead. A failed wheel-speed sensor or battery measurement also causes a controlled stop.

<!-- \landscape -->

## 1. Subsystem Diagram

![Figure 1 — HIAS inputs and outputs. Solid arrows are signals exchanged with other teams; dashed arrows are physical wiring that HIAS owns; amber rows are proposed and need the other team's agreement.](diagrams/hias_io_diagram.png)

<!-- \portrait -->

## 2. Input/Output Table

**Status key.** *AVC doc*: also listed in AVC's Milestone 1 document. *Expected*: what we expect the other team to send, not yet confirmed. *Proposed*: new; needs the other team's agreement.

| Signal | Source → Destination | Description | Type | Units | Status |
|---|---|---|---|---|---|
| `cmd_speed` | AVC → HIAS | Speed command. HIAS converts it to the ESC pulse. | single | m/s | AVC doc |
| `cmd_steering_angle` | AVC → HIAS | Front-wheel steering angle command (+ = left). HIAS converts it to the servo pulse. | single | rad | AVC doc |
| `obstacle_distance` | Perception → HIAS | Distance to the closest obstacle ahead (4.0 m = nothing detected) | single | m | Proposed |
| `obstacle_ttc` | Perception → HIAS | Time to collision with the closest obstacle ahead (0 s = contact; 10.0 s = no threat) | single | s | Expected |
| `sensor_valid` | Perception → HIAS | TRUE when Perception's obstacle data can be trusted | boolean | — | Proposed |
| `planner_heartbeat` | Motion Planning → HIAS | Counter that goes up by 1 every planning cycle, so HIAS can detect a stalled planner | uint32 | counts | Expected |
| `fbk_wheel_speed` | HIAS → AVC, Perception | Measured vehicle speed from the wheel-speed sensor | single | m/s | AVC doc |
| `fbk_actual_steering` | HIAS → AVC | Estimated steering angle from a servo model (not measured) | single | rad | AVC doc |
| `emergency_stop` | HIAS → AVC, Motion Planning, Perception | TRUE whenever HIAS is overriding AVC (every state except ACTIVE). AVC: command 0 m/s and reset. Motion Planning: hold the plan. | boolean | — | Proposed |
| `safety_supervisory_state` | HIAS → AVC, Motion Planning, Perception | Current safety supervisor state (see the states table below) | uint8 | — | AVC doc (state 4 proposed) |
| `hw_hardware_health` | HIAS → AVC, Motion Planning, Perception | Fault and warning flags explaining a stop (see the bit list below) | uint16 | bitmask | AVC doc (bits 5–10 proposed) |
| `battery_rail_voltage` | HIAS → all teams (for information) | Drive battery voltage, filtered | single | V | Proposed |
| `user_on`, `user_off`, `user_inc`, `user_dec`, `user_setspeed` | HIAS (from the remote) → AVC | Operator buttons for AVC's cruise control, passed through from the remote. `user_setspeed` is a speed (single, m/s). | boolean | — | Proposed |

| Signal | Expected range | Update rate | Invalid / fault condition | If unavailable or invalid |
|---|---|---|---|---|
| `cmd_speed` | 0–3.5 m/s, forward only (3.5–3.6 is capped to 3.5) | 50 Hz | NaN, < 0, > 3.6, or no update for 60 ms | SAFE_STOP: ramp to 0 m/s |
| `cmd_steering_angle` | ±0.436 rad (±25°) | 50 Hz | NaN, \|x\| > 0.5 rad, or no update for 60 ms | Steer straight (0 rad) and SAFE_STOP |
| `obstacle_distance` | 0–4.0 m | 20 Hz | NaN, < 0, `sensor_valid` = FALSE, or no update for 150 ms | SAFE_STOP, full braking |
| `obstacle_ttc` | 0–10.0 s | 20 Hz | NaN, < 0, `sensor_valid` = FALSE, or no update for 150 ms | SAFE_STOP, full braking |
| `sensor_valid` | TRUE / FALSE | 20 Hz | No update for 150 ms | Treated as FALSE: SAFE_STOP, full braking |
| `planner_heartbeat` | 0 to 2³²−1, wraps to 0 | 20 Hz (planner cycle rate, TBD) | Unchanged for 150 ms, or goes backwards | SAFE_STOP |
| `fbk_wheel_speed` | 0–4.5 m/s | 100 Hz | NaN (sensor fault), < 0, > 4.5, or no update for 30 ms | AVC holds 0 m/s; HIAS goes to SAFE_STOP |
| `fbk_actual_steering` | ±0.436 rad | 50 Hz | NaN, \|x\| > 0.5 rad, or no update for 60 ms | AVC assumes the commanded angle was reached |
| `emergency_stop` | TRUE / FALSE (TRUE at power-up) | 100 Hz | No update for 30 ms | Receivers treat it as TRUE |
| `safety_supervisory_state` | 0–4 | 100 Hz | Any other value, or no update for 30 ms | Receivers treat HIAS as offline (AVC: Error mode, 0 m/s) |
| `hw_hardware_health` | 0x0000–0x07FF | 10 Hz | A reserved bit set, or no update for 300 ms | Receivers stop issuing motion and alert the operator |
| `battery_rail_voltage` | 6.0–8.4 V (2S LiPo) | 10 Hz | < 5.0 V or > 8.6 V (sensor fault), or no update for 300 ms | For information only; inside HIAS it triggers SAFE_STOP |
| `user_*` buttons | TRUE while held; `user_setspeed` 0–3.5 m/s | 20 Hz | No update for 150 ms | AVC treats all buttons as released |

"No update" timeouts equal 3 missed update periods. Angles are in the vehicle frame, with + = left turn.

**Safety supervisor states** (`safety_supervisory_state`; states 0–3 are unchanged from the version AVC copied)

| Value | State | Meaning | AVC mode |
|---|---|---|---|
| 0 | STANDBY | Power-up, or after any stop; motor at neutral until the operator arms | Stop |
| 1 | ACTIVE | Normal driving; AVC's commands pass through | Normal |
| 2 | AEB | Obstacle too close; full braking | Emergency Stop |
| 3 | E-STOP | Operator pressed E-STOP or the remote link was lost; motor to neutral; latched until reset | Emergency Stop |
| 4 | SAFE_STOP *(proposed)* | An input was lost or invalid, the battery is low, or a sensor faulted; controlled stop (full braking if Perception's data is lost) | Error |

Every stop ends in STANDBY. The vehicle moves again only after the operator re-arms it while `cmd_speed` = 0.

**Hardware health bits** (`hw_hardware_health`): 0 E-STOP pressed · 1 battery low (< 6.8 V) · 2 ESC fault · 3 steering fault · 4 planner heartbeat lost · 5 AVC command lost · 6 Perception data lost · 7 wheel-speed sensor fault · 8 battery critical (< 6.4 V) · 9 remote link lost · 10 overspeed · 11–15 reserved (0). Bits 0–4 are unchanged from the version AVC copied.

## 3. Team Responsibilities

| Team member | Initial responsibility |
|---|---|
| Colin Iorio | Physical chassis assembly, hardware selection, and testing |
| Jessica Horncastle | Interface/data management, subsystem communication, and team coordination |
| Stephen Marth | Automatic Emergency Braking (AEB) programming and safety logic |

## 4. Team Dependencies

HIAS communicates with all three other teams, because it connects their software to the physical vehicle and can override it.

- **Autonomous Vehicle Control** sends us `cmd_speed` and `cmd_steering_angle`. We send AVC `fbk_wheel_speed`, `fbk_actual_steering`, `emergency_stop`, `safety_supervisory_state`, `hw_hardware_health` and the operator buttons. AVC's Milestone 1 document already lists the command and feedback signals. The remaining differences are listed under Remaining Unknowns.
- **Perception & Sensor Fusion** sends us `obstacle_distance`, `obstacle_ttc` and `sensor_valid`. We send Perception `fbk_wheel_speed`, `emergency_stop`, `safety_supervisory_state` and `hw_hardware_health`. Perception has not shared its signal list yet, so these are still to be confirmed.
- **Motion Planning** sends us `planner_heartbeat`. We send Motion Planning `emergency_stop`, `safety_supervisory_state` and `hw_hardware_health`. Motion Planning has not shared its signal list yet, so these are still to be confirmed.

## 5. Initial Testing Plan

We will test HIAS in MATLAB/Simulink/Stateflow using simulated inputs from the other teams. First, a simulated obstacle approaches the vehicle. We will check that the state switches to AEB, that the speed command drops to 0 within 20 ms of the threshold, and that the simulated vehicle stops before reaching the obstacle. Next, we will remove or corrupt each input in turn (`sensor_valid` = FALSE, a frozen speed command, a stalled planner heartbeat, a low battery) and check that HIAS enters SAFE_STOP and reports the cause. Once hardware is chosen, we will repeat these tests on a bench with the wheels off the ground, and check that E-STOP brings the motor to neutral within 100 ms.

## Remaining Unknowns

| # | Unknown | Owner | Confirm with |
|---|---|---|---|
| 1 | Vehicle, microcontroller, wheel-speed sensor and battery are not chosen yet | Colin | HIAS team |
| 2 | Signal names and units: AVC's diagram still says `new_speed`, `steering_angle` and `vehicle_speed`, and both documents say steering is "rad/s or degrees?". We propose `cmd_speed`, `cmd_steering_angle` and `fbk_wheel_speed`, with steering in **rad**. | Jessica | AVC |
| 3 | Is `cmd_speed` a speed target in m/s (our assumption) or a motor effort? | Jessica | AVC |
| 4 | AVC to add `emergency_stop` and the operator buttons as inputs. Is `user_setspeed` a number or a SET button? | Jessica | AVC |
| 5 | Perception's signals, sensor range and update rate; agreement that HIAS makes the AEB decision | Jessica, Stephen | Perception |
| 6 | Motion Planning's cycle rate and `planner_heartbeat` | Jessica | Motion Planning |
| 7 | Thresholds: AEB (TTC 1.5 s, distance 0.5 m), battery (6.8 V / 6.4 V), overspeed (4.0 m/s) | Stephen | Testing |
| 8 | What the steering does during a stop: keep following AVC (our default) or straighten | Stephen | HIAS team, AVC |
| 9 | How signals physically travel between teams (one Simulink model, or a serial/Wi-Fi link) | All | Milestone 2 |
