# Milestone 1 review: what changed from the draft, and what to send the other teams

This file goes with `HIAS_Milestone1.md` / `.docx`. It records what was wrong or missing in the earlier draft (`reference/HIAS_Milestone_1_draft_original.pdf`), what the revision does about it, and the questions each other team needs to answer. The review checked the draft against the assignment template, the AVC team's two documents and their block diagram.

## Verdict on the earlier draft

The signal work was strong. Ten of the eleven signals had every field the template asks for, and AVC has already copied six of our definitions word for word, so the two teams are closer than it looks. Measured against the template's Definition of Done, though, the draft was missing these:

- **No block diagram** (template item 1).
- **`emergency_stop` was blank.**
- **None of the Team 4 questions were answered:** hardware, microcontroller, motor and steering connections, stop conditions, how the e-stop overrides, and what happens on sensor loss.
- **No purpose statement**, and **no consolidated list of unknowns.** Open items were scattered as "?", "????" and "___".
- **The dependency tables had questions but no answers.**

The revision fixes all of these. Section 7 of the new document lists what still needs another team, or a hardware decision, to close.

## Your question: is `emergency_stop` the main one?

Yes. The template lists `emergency_stop` (Safety → Control/Hardware) as a starting signal, and its example safety rule ends in `emergency_stop = TRUE`. Two refinements came out of the review:

1. **The real override is not the signal; it's HIAS's position in the wiring.** AVC's commands pass through HIAS on their way to the motor and servo, so HIAS stops the car by simply not passing them on (the "command gate"). `emergency_stop` exists so the other teams **follow along**. The most important reason: AVC's PI speed controller must reset while stopped, or its integrator winds up and the car lurches when the stop is released.
2. **It is now defined as "HIAS is not passing AVC's commands through"**, i.e. TRUE whenever `safety_supervisory_state` ≠ ACTIVE. It is derived from the state, so the two can never disagree, and it is TRUE at power-up (fail-safe).

## Signal count: 5 in / 6 out → 8 in / 7 out

| Change | Signals | Why |
|---|---|---|
| Renamed to match AVC's I/O table | `new_speed` → `cmd_speed`, `steering_angle` → `cmd_steering_angle` | AVC's I/O table, responsibilities and test plan all say `cmd_*`. Only their diagram still says `new_speed`/`steering_angle`. |
| Added (proposed, from the template) | `obstacle_distance`, `sensor_valid` | Both are template starting signals sent to Safety. The template's example interface and example rule use `obstacle_distance`. Our own fallbacks ("raw distance telemetry") and Test 1 ("sensor-valid input") already depended on both, but neither was an input. |
| Added (proposed) | `avc_heartbeat` | AVC is the only team whose commands actually reach the motor. Without a counter, a frozen AVC that keeps sending its last command looks healthy. |
| Added (proposed) | `user_on/off/inc/dec/setspeed` (outbound to AVC) | AVC's diagram has these inputs but no team was their source. We're using a remote control, and HIAS owns that link, so we relay them. |
| Filled in | `emergency_stop` | See above |
| Extended, backward compatible | `safety_supervisory_state` adds `4 = SYS_SAFE_STOP`; `hw_hardware_health` adds bits 5–10 | The draft required controlled stops (lost heartbeat, stale commands, low battery) that matched no state. 255 had been used both as a state name and as the invalid value. AVC's copies of states 0–3 and bits 0–4 stay valid. |

## Technical fixes inside existing signals

| Signal | Draft said | Now | Why |
|---|---|---|---|
| `cmd_steering_angle`, `fbk_actual_steering` | "rad/s or degrees?" | **rad** | rad/s is a turning rate, not an angle. A rad/degree mix-up is a 57× error on the servo. The range and limits were already in rad. |
| `cmd_speed`, `cmd_steering_angle` | "single (or double)" | single | Matches every other signal. Mismatched types break Simulink bus connections. |
| `obstacle_ttc` | Invalid: "≤ 0 s while distance or NaN" | 0 s is **valid** and means contact. "No threat" is sent as 10.0 s. | As written, the most dangerous reading would have been discarded as a fault. |
| `cmd_speed` | "Clamp to 0 within 100 ms (smooth down to stop)" | Override *starts* within 100 ms, then ramps at a set deceleration | Going from 3.5 m/s to 0 in 100 ms would need about 35 m/s², which no car can do. "Clamp" and "smooth" also contradict each other. |
| All inputs | Only the planner heartbeat had a timeout | One rule: stale after 3 missed periods | In Simulink, a frozen signal holds its last value, so "unavailable" could never trigger. |
| Steering on stop | "Neutral lock" in one place, "lock steering" in another | One rule: follow AVC's steering while it is valid, otherwise ramp to 0 rad | The draft contradicted itself. Losing the steering command also never stopped the car. |
| `battery_rail_voltage` | Fault < 6.4 V inside a 6.0–8.4 range; "unavailable" field held the thresholds; "parking brake" | Thresholds moved into the description, with time filters; invalid now means a sensor fault; stop = controlled stop | A low battery is a valid reading, not a broken sensor. The car may have no parking brake. |
| `battery_rail_voltage`, `emergency_stop` | Destination "Master Telemetry / All Teams" | Named teams | The Definition of Done requires a known destination. "Master Telemetry" isn't a subsystem. |
| `hw_hardware_health` | Invalid = "critical bits asserted" | Invalid = reserved bit set or stale; bits now say what they trigger | A reported fault is valid data. |
| `fbk_actual_steering` | "Modeled actual" steering | Explicitly **estimated**; AVC shouldn't treat it as a sensor | Hobby servos don't report their position. |
| `fbk_wheel_speed` | Fallback: "visual/optical or back-EMF?" | Sensor fault → NaN + bit 7 + safe stop; overspeed check added | An unplugged encoder reads a valid-looking 0 m/s. AVC's controller would then wind up to full speed, and TTC (distance ÷ speed) would look harmless. |
| `aeb_trigger_request` | "Unavoidable" collision; Perception decides | "Imminent"; advisory only; **HIAS decides** | AEB must fire while braking can still help. The template puts the decision in Safety. |
| `planner_heartbeat` | "Lock steering" | Safe stop with the single steering rule | |

## Decisions made as defaults (confirm as a team)

These are written into the doc as starting values and listed in Section 7, so changing any of them is a one-line edit.

- **AEB thresholds:** trigger at TTC < 1.5 s or distance < 0.5 m; release at TTC > 3.0 s and distance > 1.0 m. These are about 2× the physics minimum at 3.5 m/s.
- **No stop resumes driving on its own.** Every stop ends in STANDBY, and the operator presses ARM. This answers Stephen's "does AEB latch?": no reset switch is needed, but the car never drives off by itself.
- **Re-arming requires `cmd_speed` = 0**, so AVC always starts from rest. This replaced asking AVC for a mode signal.
- **Microcontroller:** an ESP32 for HIAS. It has fixed timing, hardware PWM, a pulse counter for the wheel sensor, and Wi-Fi/Bluetooth for a phone remote. Don't use a Raspberry Pi as the final stage before the motors: if its program crashes, its hardware PWM keeps sending the last pulse.
- **Vehicle:** assumed to be a prebuilt RC car (ESC + steering servo). If you end up with a kit that steers by driving its two sides at different speeds, the AVC interface doesn't change; HIAS converts internally.
- **`cmd_speed` stays a speed in m/s.** HIAS applies a calibrated map to the ESC, and AVC's PI loop closes on `fbk_wheel_speed`. This keeps AVC's published interface as it is. Confirm with AVC (doc item A1).

## AVC's diagram: feedback to send them

Their diagram (`reference/AVC_block_diagram_photo.jpg`) disagrees with their own I/O table:

1. The outputs are labeled `new_speed` / `steering_angle`, but their table says `cmd_speed` / `cmd_steering_angle`.
2. `vehicle_speed` should be `fbk_wheel_speed`. Their dependency text also says speed comes from Perception; it comes from HIAS.
3. `mot_trajectory` is one arrow, but their table has two inputs: `desired_speed` and `desired_steering`.
4. **No input from HIAS at all.** Their own table lists `fbk_actual_steering`, `safety_supervisory_state` and `hw_hardware_health`, and `emergency_stop` needs to be added. The template requires Safety to be able to override Control, so the class-level diagram needs this path.
5. The `user_*` inputs have no source. We're proposing HIAS relays them from the remote. Their Checkpoint 1 listed "Pause / On / Off" instead, so they should pick one set.
6. Their `desired_steering` description is a copy of the speed text.

## Messages ready to send

**To AVC**

> Hi AVC team. HIAS here, following up on your Milestone 1 doc. Thanks for copying our feedback signals; that made lining up easy. A few things to settle so both docs match:
> 1. **Names:** we're switching to your table's names, `cmd_speed` and `cmd_steering_angle`. Could you relabel your diagram (it still says `new_speed`/`steering_angle`) and rename `vehicle_speed` to `fbk_wheel_speed`?
> 2. **Units:** `cmd_steering_angle` should be **rad**, not "rad/s or degrees?". Both docs carry that leftover question mark.
> 3. **Is `cmd_speed` a speed (m/s) or a motor effort?** We're assuming m/s: we map it to the ESC, and your PI closes the loop on `fbk_wheel_speed`. If you'd rather send an effort (0–1), tell us and we'll rename it.
> 4. **E-stop:** please add `emergency_stop` (boolean, 100 Hz) to your inbound table, and add it plus `safety_supervisory_state` / `hw_hardware_health` to your diagram. While it's TRUE, please hold `cmd_speed` = 0 and reset your integrators. We stop the motor regardless, but otherwise your controller winds up and the car lurches on release. Our state-to-mode mapping is in Section 2.4 of our doc.
> 5. **Heartbeat:** could you add `avc_heartbeat` (uint32, +1 per cycle, sent with the commands)? It lets us tell a frozen controller from a steady command.
> 6. **User buttons:** we'll be driving with a remote control, so we propose HIAS relays `user_on/off/inc/dec/setspeed` to you (held = TRUE). Is `user_setspeed` a number in m/s, or a SET button?
> 7. Do you still want the 0.1 s safety-override response from your Checkpoint 1? Our budget comes out at about 80 ms.

**To Perception & Sensor Fusion**

> Hi Perception team. HIAS needs these from you (details in Section 2.2 of our doc): `obstacle_distance` (m, closest obstacle ahead, send 4.0 m when there's nothing), `obstacle_ttc` (s, saturate at 10.0 s when nothing is closing; 0 means contact), `sensor_valid` (boolean), and optionally `aeb_trigger_request` (boolean, held while a collision is imminent). Ideally all at 20 Hz; we need at least 10 Hz. We plan for HIAS to make the final AEB decision from distance and TTC; your trigger can add a stop but not block one. Does that work for you? What sensor and range are you using, and will it be wired to your own board or to our microcontroller on the car? (If it's ours, we'll forward the raw readings to you.) We send you `fbk_wheel_speed` (m/s, 100 Hz), if that helps with TTC, plus our safety state. Please keep publishing obstacle data even while we're stopped: we use it to decide when it's safe to release an AEB stop.

**To Motion Planning**

> Hi Motion Planning team. HIAS would like a `planner_heartbeat` from you: a uint32 counter that goes up by 1 every planning cycle. What is your cycle rate? We assumed 20 Hz, but AVC assumed 50 Hz. If it stalls for 3 cycles, we bring the car to a controlled stop. We'll send you `emergency_stop`, `safety_supervisory_state` and `hw_hardware_health`. While `emergency_stop` is TRUE, please hold the plan (`desired_speed` = 0) and replan from the current position after release.

## Timing note

The template lists the due date as **Saturday, Oct 3**. If the draft was already submitted, treat this revision as the starting interface for Milestone 2. The template says "Interfaces can still be changed … any change that affects another subsystem must be discussed with the affected team", so send the messages above either way.
