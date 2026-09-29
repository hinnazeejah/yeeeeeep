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
| Tab | Toggle 3D view / fluoroscopy |
| Space (hold) | Fluoro pedal: live X-ray; release = last image hold |
| C | Contrast injection (cine) into the left coronary system |
| V | Cycle standard C-arm projections |
| Arrow keys | Fine-tune C-arm angle (LAO/RAO, cranial/caudal) |
| L | Toggle anatomy labels (3D) |
| Mouse | Orbit / zoom (3D view) |

## Layout

```
src/config/anatomy.ts   all anatomy sizes, positions, lesion, fluoro & contrast constants
src/anatomy/            procedural heart, vessel tree, lumen profiles, fluoro skeleton
src/physics/            contrast transit / flow model
src/scene/              renderer, cameras, C-arm, fluoroscopy materials + post-processing
src/ui/                 start screen, HUD
src/state/              in-memory store
tests/                  unit tests
```

See [PLAN.md](PLAN.md) for the milestone plan.
