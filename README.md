# HIAS: Hardware Integration & Active Safety

Planning repo for the **Hardware Integration & Active Safety** subsystem of the ISE 350 autonomous vehicle project. The four teams are Perception & Sensor Fusion, Motion Planning, Autonomous Vehicle Control (AVC), and HIAS. HIAS connects the software to the physical car (motor, steering, sensors, remote control) and runs the safety supervisor that can always stop the vehicle.

Team: Colin Iorio, Jessica Horncastle, Stephen Marth.

## Layout

| Path | What it is |
|---|---|
| `milestone-1/HIAS_Milestone1.md` | **Milestone 1 interface plan (submitted version).** This is the source of truth; edit this file. |
| `milestone-1/HIAS_Milestone1.docx` | The same document as a Word file for submission (generated from the `.md`) |
| `milestone-1/diagrams/` | HIAS I/O block diagram (used in the doc) and a system-context diagram: `.png` / `.svg` to view, `.drawio` to edit in [diagrams.net](https://app.diagrams.net) |
| `milestone-1/REVIEW.md` | What changed from the first draft, decisions to confirm, and messages ready to send to AVC, Perception and Motion Planning |
| `milestone-1/notes/` | Longer working notes behind the submitted doc: per-signal write-ups, question tables, hardware notes, and ideas held for Milestone 2 |
| `reference/` | Inputs: the assignment template, our original draft, AVC's Milestone 1 and Checkpoint 1 docs, and a photo of AVC's block diagram |
| `tools/` | Scripts that regenerate the diagrams and the `.docx` |

## Current interface at a glance

**Into HIAS:**

- From AVC: `cmd_speed`, `cmd_steering_angle`
- From Perception: `obstacle_distance`*, `obstacle_ttc`, `sensor_valid`*
- From Motion Planning: `planner_heartbeat`

**Out of HIAS:**

- `fbk_wheel_speed`, `fbk_actual_steering`
- `emergency_stop`*, `safety_supervisory_state`, `hw_hardware_health`
- `battery_rail_voltage`*
- Operator buttons `user_*`*, relayed from the remote control

\* proposed in Milestone 1 and waiting for the other team to agree. The doc's "Remaining Unknowns" table lists every open item.

## Rebuilding the diagram and Word file

Both scripts need Node 18+. The diagram script also uses Playwright for the PNG export; it skips that step if Playwright isn't installed. The Word script needs the `docx` package.

```bash
npm install --prefix tools          # once: installs docx + playwright into tools/node_modules
node tools/build_diagrams.mjs       # -> milestone-1/diagrams/*.svg, *.drawio, *.png
node tools/md2docx.mjs milestone-1/HIAS_Milestone1.md milestone-1/HIAS_Milestone1.docx
```

To rename or add a signal, change it in the milestone doc (Section 2) and in the `INPUTS` / `OUTPUTS` lists at the top of `tools/build_diagrams.mjs`, then re-run both commands. The doc and the diagram must match, because the class combines every team's diagram into one system diagram. (Figure 2's labels are set directly in `systemContext()` in the same file.)
