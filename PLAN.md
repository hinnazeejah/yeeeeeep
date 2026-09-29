# PCI Simulator — Plan

Browser-based educational simulator of PCI: stenting a 90% mid-LAD lesion through right radial access.
**For education and demonstration only. Not clinical training or medical advice.** (Shown on the start screen.)

## Stack
Vite + TypeScript (strict) + Three.js, Web Audio API, Vitest for unit tests. No backend; all state in memory.

## Architecture

```
src/
  main.ts                 bootstrap, render loop, wires modules together
  config/anatomy.ts       ALL anatomy sizes/positions/spline control points, lesion spec, device sizes
  state/store.ts          single in-memory SimState + tiny event emitter (subscribe/emit)
  scene/                  renderer, cameras, lights, view manager (3D <-> fluoro, Tab)
    fluoroPass.ts         fluoro look: grayscale, noise, vignette, low contrast (custom ShaderMaterial / post pass)
  anatomy/                procedural geometry
    heart.ts              deformed ellipsoid myocardium, pulsation driven by HR
    vesselTree.ts         builds Vessel objects (spline + radius profile) from config
    vesselMesh.ts         custom tube with variable radius (for stenosis, dissection flap, stent result)
    access.ts             simplified radial -> brachial -> subclavian -> brachiocephalic -> aortic arch path
  physics/
    devicePath.ts         devices move by arc length along a vessel centerline graph (1D "rail" model)
    wire.ts               tip steering at bifurcations (rotation selects branch), force/resistance, dissection risk
    flow.ts               TIMI-like flow model: fill speed from min lumen diameter -> contrast front per segment
  tools/                  one module per tool (1–7): cursor, hover highlight, input rules, can-use checks
    guideCatheter.ts guidewire.ts balloon.ts stent.ts contrast.ts fluoroPedal.ts measure.ts
  procedure/
    stages.ts             6 stages, goals, sub-tasks, unlock logic
    evaluation.ts         PURE functions: stent sizing -> residual stenosis, flow grade, debrief tips
    complications.ts      dissection, ischemia from long inflation, undersized stent
    demo.ts               scripted autopilot; any user input = take over at current step
  ui/                     plain DOM + CSS overlays
    startScreen.ts toolbar.ts checklist.ts mentor.ts vitals.ts ecg.ts pressureDial.ts debrief.ts
  audio/monitor.ts        QRS beep (pitch tracks SpO2), alarm tones
tests/                    evaluation + flow unit tests (Vitest)
```

## Key modelling decisions (simplified on purpose)
- **Devices on rails**: catheter, wire, balloon, stent each have an arc-length position on a path through the vessel graph. Rendered as thin tubes along that path. Advance/retract with mouse wheel or W/S, rotate with A/D. Keeps it robust and learnable.
- **Guide engagement**: at the aortic root, rotating the guide into the correct angle window "pops" it into the left main ostium.
- **Wire steering**: at each bifurcation, tip rotation decides the branch (Diagonal vs LAD, LAD vs LCx). Crossing the lesion needs gentle advance; advancing fast/against resistance ("forcing") accumulates a hidden dissection risk; a random roll against that risk can trigger a dissection.
- **Lumen**: each vessel has a radius profile r(s). Stenosis = smooth dip to 10% diameter area-equivalent (90% diameter stenosis) over a lesion length. Balloon and stent modify the profile. Dissection adds a flap mesh that only shows in contrast.
- **Flow**: fill speed ∝ f(minimum lumen diameter). Contrast "front" advances along each segment; beyond a severe lesion it advances slowly (TIMI 1–2), after good stenting fast (TIMI 3). Rendered as vessel opacity in fluoro, not just a message.
- **Fluoroscopy**: a separate render of the scene with a grayscale X-ray material: vessels ~invisible without contrast, devices (radiopaque) dark, stent struts faint, heart as soft shadow; noise + vignette shader. Only live while pedal (6) held or during cine (5); otherwise last-image hold.
- **Physiology**: HR/BP/SpO2 baseline with jitter. Balloon inflation occludes LAD → ST elevation after a few seconds, grows with time; >~30–45 s adds BP drop / arrhythmia risk; resolves on deflation. ECG is a synthetic PQRST waveform drawn to canvas.
- **Stent sizing**: user picks stent diameter/length and deploy pressure. Achieved diameter = f(nominal, pressure compliance). Residual stenosis vs reference vessel diameter → evaluated by pure functions (unit tested). Undersized = visible residual narrowing on final angiogram.

## Stages
1. Advance guide to aortic root → 2. Engage left main (+ first angiogram) → 3. Wire across LAD lesion into distal LAD → 4. Pre-dilate (balloon positioned over lesion, inflated, deflated) → 5. Deploy stent (covers lesion, adequate pressure) → 6. Final angiogram (cine with flow assessment) → Debrief.

## Controls
Tab toggle view · 1–7 tools · wheel / W,S advance-retract · A,D rotate · hold Space or 6 = fluoro · click-and-hold dial for pressure · mouse orbit in 3D · Esc pause · D-mode button for demo.

## Milestones (each runnable with `npm run dev`)
- **M1** Project scaffold, config file, heart + coronaries + aorta + access path, orbit camera, fluoro view + Tab toggle.
- **M2** Toolbar (1–7, cursors, hover), device rail model, guide catheter + guidewire movement and branch steering.
- **M3** Stage system, checklist, mentor panel (collapsible, sub-tasks, %).
- **M4** Balloon, stent (strut expansion), contrast fill/washout, vitals + ECG with ST changes, audio.
- **M5** Complications, debrief, demo mode with take-over, start screen/disclaimer, polish. Unit tests land in M4 alongside evaluation code and grow in M5.

After each milestone: `npm run build` + `npm test` + dev server smoke run, fixes, and a short "what to test" list.

## Out of scope
Real hemodynamics/CFD, soft-body catheter physics, patient-specific anatomy, persistence/accounts, clinical accuracy guarantees.
