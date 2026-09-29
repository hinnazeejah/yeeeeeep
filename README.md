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

## Controls (so far)

| Key | Action |
| --- | --- |
| 1 / 2 | Select guide catheter / guidewire (hover toolbar buttons for rules) |
| W / S, mouse wheel | Advance / retract the active device (Shift = fine) |
| A / D | Rotate (torque) the active device |
| 5 or C | Contrast injection (cine): selective if the guide is engaged, aortic flush otherwise |
| 6 or Space (hold) | Fluoro pedal: live X-ray; release = last image hold |
| Tab | Toggle 3D view / fluoroscopy |
| V, arrow keys | C-arm projection presets / fine angle |
| F | Camera follows the device tip |
| L / H | Anatomy labels / key help |
| Mouse drag, Ctrl+wheel | Orbit / zoom (3D view) |

## Layout

```
src/config/anatomy.ts   all anatomy sizes, positions, lesion, fluoro & contrast constants
src/anatomy/            procedural heart, vessel tree, lumen profiles, fluoro skeleton
src/physics/            device rail model (route), guide catheter, guidewire, contrast transit
src/tools/              tool definitions & rules, device controller, hover picking
src/scene/              renderer, cameras, C-arm, fluoroscopy materials + post-processing
src/ui/                 start screen, HUD
src/state/              in-memory store
tests/                  unit tests
```

See [PLAN.md](PLAN.md) for the milestone plan.
