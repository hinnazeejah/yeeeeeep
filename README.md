# PCI Simulator

Browser-based **educational** simulator of percutaneous coronary intervention (PCI): stenting a 90% mid-LAD
stenosis via right radial access. Vite + TypeScript + Three.js, runs entirely in the browser.

> For education and demonstration only. Not clinical training, not medical advice.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # typecheck + production build
```

## The case

A 68-year-old with stable angina and a 90% mid-LAD stenosis. The learner works through six stages, with a
mentor panel giving situation-specific hints and a short "Why this step?" explanation for each:

1. **Access**: advance the 6F guide from the right radial artery to the aortic root
2. **Engage**: rotate the curved tip to the left coronary cusp, seat it in the left main, take an angiogram
3. **Wire**: give heparin (ACT 250–300 s), steer the 0.014" wire into the LAD and gently across the lesion
4. **Pre-dilate**: position a balloon by its markers, inflate (watch ST elevation and chest pain), deflate
5. **Stent**: measure with QCA, size the stent 1:1 to the reference diameter, cover the lesion, deploy
6. **Final angiogram**: check flow and the stent edges in two projections

Then a **debrief** scores the result (residual stenosis, TIMI flow, stent sizing and coverage, heparin,
inflation time, contrast, fluoro time, complications), with a teaching point for every item.

**Watch a demo first** runs the whole case on autopilot through the same controls a learner uses;
press any key or click to take over at any point.

### What the model simulates (simplified on purpose)

- **Flow**: contrast arrival time along each vessel depends on the tightest narrowing upstream, so the
  untreated lesion fills slowly (TIMI 2), an inflated balloon stops flow, and a good stent restores TIMI 3.
- **Balloons and stents**: semi-compliant pressure–diameter curves, nominal pressure and rated burst
  pressure (RBP), elastic recoil after plain balloon angioplasty, stent post-dilation by re-inflating inside it.
- **Complications**: dissection from forcing the wire or oversizing a balloon/stent (shown as contrast
  staining and reduced flow until stented over), balloon rupture above RBP, ischaemia with ST elevation,
  hypotension and ventricular ectopy if the LAD stays occluded too long.
- **Monitor**: V2 ECG with ST changes, HR, arterial pressure, SpO2, ACT, QRS beep and alarms.

## Controls

| Key | Action |
| --- | --- |
| 1–7 | Tools: guide, wire, balloon, stent, contrast, fluoro, measure (hover toolbar buttons for rules) |
| W / S, mouse wheel | Advance / retract the active device (Shift = fine) |
| A / D | Rotate (torque) the guide or wire |
| E (hold) / Q | Inflate / deflate the balloon or stent (Shift = fine pressure) |
| G | Give heparin |
| 5 or C | Contrast injection (cine): selective if the guide is engaged, aortic flush otherwise |
| 6 or Space (hold) | Fluoro pedal: live X-ray; release = last image hold |
| Tab | Toggle 3D view / fluoroscopy |
| V, arrow keys | C-arm projection presets / fine angle |
| F | Camera follows the device tip |
| L / H / M / N | Anatomy labels / key help / collapse mentor / monitor sound |
| Esc | Pause |
| Mouse drag, Ctrl+wheel | Orbit / zoom (3D view) |

## Layout

```
src/config/anatomy.ts   all anatomy sizes, lesion, fluoro, contrast, device and physiology constants
src/anatomy/            procedural heart, vessel tree, lumen profiles (stenosis + treatment), fluoro skeleton
src/physics/            device rail model, guide, wire, balloon/stent catheter, flow (TIMI), physiology + ECG
src/tools/              tool definitions & rules, device controller, hover picking
src/procedure/          stages, progression, per-frame snapshot, evaluation & debrief, demo autopilot
src/scene/              renderer, cameras, C-arm, fluoroscopy materials, balloon/stent meshes
src/ui/                 start screen, HUD, toolbar, device panel, checklist, mentor, vitals, debrief
src/audio/              monitor beep and alarms (Web Audio)
src/state/              in-memory store
tests/                  unit tests (lumen, flow, devices, balloon, physiology, stages, evaluation)
```

See [PLAN.md](PLAN.md) for the milestone plan.
