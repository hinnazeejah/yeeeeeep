import './ui/styles.css';
import { Timer, Vector3 } from 'three';
import { FLUORO } from './config/anatomy';
import { AnatomyModel } from './anatomy/anatomyModel';
import { MonitorAudio } from './audio/monitor';
import { ContrastBolus } from './physics/flow';
import { Physiology } from './physics/physiology';
import { DemoPilot, type DemoHost } from './procedure/demo';
import { buildDebrief, coverage, type ProcedureSummary } from './procedure/evaluation';
import { Procedure } from './procedure/procedure';
import { buildContext, ProcedureLog } from './procedure/snapshot';
import { ViewManager } from './scene/viewManager';
import { store } from './state/store';
import { DeviceController } from './tools/deviceController';
import { HoverPicker } from './tools/hover';
import { TOOL_BY_KEY, TOOLS, type ToolId } from './tools/tools';
import { Checklist } from './ui/checklist';
import { DebriefScreen } from './ui/debrief';
import { DevicePanel } from './ui/devicePanel';
import { formatCArm, Hud } from './ui/hud';
import { DeviceInput } from './ui/input';
import { MentorPanel } from './ui/mentor';
import { Messages } from './ui/messages';
import { showStartScreen } from './ui/startScreen';
import { Toolbar } from './ui/toolbar';
import { VitalsPanel } from './ui/vitals';

const app = document.getElementById('app')!;
const views = new ViewManager(app);
const anatomy = new AnatomyModel(views.scene3d, views.sceneFluoro);
const log = new ProcedureLog();
const devices = new DeviceController(anatomy, views.scene3d, views.sceneFluoro, log);
const bolus = new ContrastBolus();
const input = new DeviceInput();
const procedure = new Procedure();
const patient = new Physiology();
const audio = new MonitorAudio();
const demo = new DemoPilot();

const hud = new Hud(document.body);
const messages = new Messages(document.body);
const panel = new DevicePanel(document.body, input);
const hover = new HoverPicker(views.renderer.domElement, anatomy, devices);
const checklist = new Checklist(document.body, procedure);
const mentor = new MentorPanel(document.body, procedure);
const vitals = new VitalsPanel(document.body);
const debrief = new DebriefScreen(document.body);
devices.onFeedback = (f) => messages.show(f);

views.setCArm(store.state.carm);
views.onBeforeLabels = (cam) => anatomy.updateLabels(cam);

// ---------------------------------------------------------------------------
// Actions (shared by keyboard, toolbar, panels and the demo autopilot)
// ---------------------------------------------------------------------------

let pedalDown = false;
let paused = false;
const pressed: Partial<Record<ToolId, boolean>> = {};

/** Camera distance to glide to in the 3D view (coronary work needs a close-up), or null. */
let zoomGoal: number | null = null;

function selectTool(id: ToolId): void {
  const f = devices.selectTool(id);
  if (f) messages.show(f);
  else {
    if (id === 'measure' && devices.angioTaken) log.measured = true;
    if (['wire', 'balloon', 'stent', 'measure'].includes(id)) zoomGoal = 150;
  }
  applyCursor();
}

function injectContrast(): void {
  const r = devices.inject(bolus);
  if (r.feedback) messages.show(r.feedback);
  if (r.ok) {
    log.recordInjection(devices.guide.engaged, formatCArm(store.state.carm));
    store.set({ contrastMl: store.state.contrastMl + r.ml });
    if (store.state.view !== 'fluoro') store.set({ view: 'fluoro' });
  }
}

function setPedal(down: boolean): void {
  pedalDown = down;
  pressed.fluoro = down;
}

function setProjection(i: number): void {
  const p = FLUORO.presets[i];
  store.set({ carmPreset: i, carm: { lao: p.lao, cra: p.cra } });
  views.setCArm(store.state.carm);
}

function giveHeparin(): void {
  messages.show(devices.giveHeparin());
}

function toggleMute(): void {
  audio.muted = !audio.muted;
}

function applyCursor(): void {
  const def = TOOLS.find((t) => t.id === devices.activeTool)!;
  views.renderer.domElement.style.cursor = def.cursor;
}

function setPaused(p: boolean): void {
  paused = p;
  pauseEl.hidden = !p;
  input.enabled = !p && store.state.started;
  if (p) setPedal(false);
}

const toolbar = new Toolbar(document.body, {
  select: selectTool,
  action: (id) => id === 'contrast' && injectContrast(),
  hold: (id, down) => id === 'fluoro' && setPedal(down),
});
applyCursor();

panel.onSize = (kind, d, l) => {
  const c = kind === 'balloon' ? devices.balloon : devices.stentSys;
  const f = c.setSize(d, l);
  if (f) messages.show(f);
};
vitals.onHeparin = giveHeparin;
vitals.onMute = toggleMute;

// Extra HUD buttons: pause and end the case.
const hudTop = document.getElementById('hud-top')!;
const pauseBtn = document.createElement('button');
pauseBtn.className = 'tag help-btn';
pauseBtn.textContent = 'ESC · PAUSE';
pauseBtn.addEventListener('click', () => setPaused(!paused));
const endBtn = document.createElement('button');
endBtn.className = 'tag help-btn end-btn';
endBtn.textContent = 'END CASE';
endBtn.addEventListener('click', () => showDebrief());
hudTop.append(pauseBtn, endBtn);

const pauseEl = document.createElement('div');
pauseEl.id = 'pause';
pauseEl.hidden = true;
pauseEl.innerHTML = '<div class="card panel"><h2>Paused</h2><p class="dim">The patient is safe while paused. Press Esc or click to continue.</p></div>';
pauseEl.addEventListener('click', () => setPaused(false));
document.body.appendChild(pauseEl);

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

const demoHost: DemoHost = {
  devices,
  vessels: anatomy.vessels,
  selectTool,
  inject: injectContrast,
  bolusActive: () => bolus.active,
  setPedal,
  setProjection,
  setView: (view) => store.set({ view }),
  giveHeparin,
  setSize: (kind, d, l) => panel.onSize(kind, d, l),
  requestDeflate: () => input.requestDeflate(),
};

function takeOver(): void {
  if (!demo.active) return;
  demo.stop();
  input.auto = null;
  setPedal(false);
  mentor.demoText = null;
  messages.show({ text: 'You have control. The mentor will guide you from here.', level: 'ok' });
}

// ---------------------------------------------------------------------------
// Keyboard and mouse
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (!store.state.started || debrief.open) return;
  if (e.code === 'Escape') {
    setPaused(!paused);
    return;
  }
  if (paused) return;
  if (demo.active && !['ShiftLeft', 'ShiftRight', 'Tab', 'KeyH', 'KeyL', 'KeyM', 'KeyN'].includes(e.code)) takeOver();
  const s = store.state;
  const tool = TOOL_BY_KEY.get(e.key);
  if (tool) {
    if (tool.kind === 'modal') selectTool(tool.id);
    else if (tool.kind === 'action' && !e.repeat) injectContrast();
    else if (tool.kind === 'hold') setPedal(true);
    return;
  }
  switch (e.code) {
    case 'Tab':
      e.preventDefault();
      store.set({ view: s.view === '3d' ? 'fluoro' : '3d' });
      break;
    case 'Space':
      e.preventDefault();
      setPedal(true);
      break;
    case 'KeyC':
      if (!e.repeat) injectContrast();
      break;
    case 'KeyG':
      if (!e.repeat) giveHeparin();
      break;
    case 'KeyN':
      toggleMute();
      break;
    case 'KeyV':
      setProjection((s.carmPreset + 1) % FLUORO.presets.length);
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      const step = 5;
      const lao = s.carm.lao + (e.code === 'ArrowRight' ? step : e.code === 'ArrowLeft' ? -step : 0);
      const cra = s.carm.cra + (e.code === 'ArrowUp' ? step : e.code === 'ArrowDown' ? -step : 0);
      store.set({ carm: { lao: clamp(lao, -90, 90), cra: clamp(cra, -45, 45) } });
      views.setCArm(store.state.carm);
      break;
    }
    case 'KeyL':
      store.set({ labelsVisible: !s.labelsVisible });
      anatomy.setLabelsVisible(store.state.labelsVisible);
      break;
    case 'KeyM':
      mentor.toggle();
      break;
    case 'KeyH':
      hud.toggleHelp();
      break;
    case 'KeyF':
      store.set({ follow: !s.follow });
      messages.show({ text: store.state.follow ? 'Camera follows the device tip.' : 'Camera free.', level: 'info' });
      break;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === '6') setPedal(false);
});
window.addEventListener('blur', () => setPedal(false));
window.addEventListener('pointerdown', (e) => {
  // Clicking the panels or the scene during the demo hands control to the learner.
  if (demo.active && !(e.target as HTMLElement).closest('#hud-top, #mentor, #vitals')) takeOver();
});

// Wheel: drives the active device; Ctrl/Cmd + wheel (or a non-device tool) zooms the 3D camera.
const canvas = views.renderer.domElement;
canvas.addEventListener(
  'wheel',
  (e) => {
    takeOver();
    if (e.ctrlKey || e.metaKey) zoomGoal = null;
    const deviceTool = ['guide', 'wire', 'balloon', 'stent'].includes(devices.activeTool);
    if (deviceTool && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      input.addWheel(-Math.sign(e.deltaY) * (input.fine ? 1 : 4));
      views.controls.enableZoom = false;
    } else {
      views.controls.enableZoom = true;
      zoomGoal = null;
    }
  },
  { capture: true, passive: false },
);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

function summary(): ProcedureSummary {
  const q = devices.qca();
  const d = devices.dissection;
  return {
    finished: procedure.finished,
    referenceDiameter: devices.lesionReferenceDiameter,
    residual: q.ds,
    finalFlow: devices.distalFlow,
    heparinGiven: log.heparinGiven,
    measured: log.measured,
    predilated: log.predilated,
    predilationBalloon: log.predilationBalloon,
    stents: devices.stents.map((s) => {
      const c = coverage({ start: s.startMm, end: s.endMm }, devices.lesionSpan);
      return { nominal: s.nominal, length: s.length, achieved: s.expansion.radius * 2, proximalMargin: c.proximalMargin, distalMargin: c.distalMargin };
    }),
    longestInflation: log.longestInflation,
    dissection: d ? { cause: log.dissectionCause ?? 'Dissection', sealed: d.sealed } : null,
    balloonRupture: log.balloonRupture,
    wireForcingSeconds: devices.wire.forcingSeconds,
    fluoroSeconds: store.state.fluoroSeconds,
    contrastMl: store.state.contrastMl,
    totalSeconds: store.state.elapsed,
    finalViews: log.projectionCountAfterStent,
  };
}

function showDebrief(): void {
  if (!store.state.started) return;
  takeOver();
  setPedal(false);
  debrief.show(buildDebrief(summary()), store.state.elapsed);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const timer = new Timer();
timer.connect(document);
const tipPos = new Vector3();
const followDelta = new Vector3();
let pvcBeat = false;
let debriefTimer = -1;
let warnedPain = false;
let warnedUnstable = false;

function frame(time: number): void {
  timer.update(time);
  const rawDt = Math.min(0.1, timer.getDelta());
  const dt = paused || debrief.open ? 0 : rawDt;
  const s = store.state;

  if (s.started) s.elapsed += dt;
  const prevPhase = s.beatPhase;
  s.beatPhase = (s.beatPhase + (dt * patient.hr) / 60) % 1;
  if (dt > 0 && s.beatPhase < prevPhase) {
    // New beat: ectopic beats come early and have no P wave.
    pvcBeat = Math.random() < patient.ectopyRate / patient.hr;
    if (s.started) audio.beat(patient.spo2);
  }
  anatomy.updateBeat(s.beatPhase);

  // Demo autopilot drives the input; the learner's input otherwise.
  input.enabled = s.started && !paused && !debrief.open;
  if (demo.active && dt > 0) {
    const said = demo.update(dt, demoHost);
    input.auto = demo.active ? demo.auto : null;
    if (said) mentor.demoText = said;
    if (!demo.active) {
      mentor.demoText = null;
      setPedal(false);
      messages.show({ text: 'Demo complete. Press New case in the debrief to try it yourself.', level: 'ok' });
    }
  }
  devices.update(dt, input);

  bolus.update(dt);
  anatomy.updateContrast(bolus);
  devices.updateStain(dt, bolus);

  // Patient.
  if (s.started) {
    patient.update(dt, devices.ladOccluded, devices.distalFlow, log.heparinGiven);
    if (patient.chestPain && !warnedPain) {
      warnedPain = true;
      messages.show({ text: "Patient: \"My chest feels tight.\" Expected while the LAD is blocked. Keep inflations short.", level: 'warn' });
    }
    if (!patient.chestPain && patient.ischemia < 0.1) warnedPain = false;
    if (patient.unstable && !warnedUnstable) {
      warnedUnstable = true;
      messages.show({ text: 'Blood pressure is falling with ventricular ectopy. Deflate the balloon now (Q).', level: 'danger' });
    }
    if (!patient.unstable) warnedUnstable = false;
  }
  audio.alarm(s.started && !paused && (patient.unstable || patient.stMm >= 2));
  vitals.update(rawDt, s.beatPhase, patient, pvcBeat, log.heparinGiven, audio.muted);

  // X-rays are on while the pedal is held or during a cine run.
  const xrayOn = !paused && (pedalDown || bolus.active);
  if (xrayOn !== s.xrayOn) store.set({ xrayOn });
  if (xrayOn) {
    s.fluoroSeconds += dt;
    log.recordFluoro(devices);
  }

  // Stage system.
  const ctx = buildContext(devices, log);
  for (const ev of procedure.update(ctx, s.elapsed)) {
    if (ev.type === 'stage') {
      checklist.flash(ev.stage);
      messages.show({ text: `Stage ${ev.stage + 1} complete: ${ev.title}.`, level: 'ok' });
    } else if (ev.type === 'complete') {
      messages.show({ text: 'All stages complete. Opening your debrief…', level: 'ok' });
      debriefTimer = 3;
    }
  }
  devices.stageIndex = procedure.current;
  if (debriefTimer > 0) {
    debriefTimer -= dt;
    if (debriefTimer <= 0 && !demo.active) showDebrief();
    else if (debriefTimer <= 0) debriefTimer = 0.5; // let the demo finish its last cine run
  }

  // Camera follow: glide the orbit target (and the camera with it) towards the device tip.
  if (s.follow && s.view === '3d') {
    devices.activeTip(tipPos);
    followDelta.subVectors(tipPos, views.controls.target).multiplyScalar(1 - Math.exp(-rawDt * 3));
    views.controls.target.add(followDelta);
    views.camera3d.position.add(followDelta);
  }
  if (zoomGoal !== null && s.view === '3d') {
    const off = views.camera3d.position.clone().sub(views.controls.target);
    const dist = off.length();
    const next = dist + (zoomGoal - dist) * (1 - Math.exp(-rawDt * 2.5));
    views.camera3d.position.copy(views.controls.target).addScaledVector(off.normalize(), next);
    if (Math.abs(next - zoomGoal) < 1) zoomGoal = null;
  }

  views.render(s.view, dt, xrayOn);
  hover.update(views.camera3d, s.view === '3d' && s.started);
  hud.update(s, bolus.active, views.fluoro.hasImage);
  panel.update(devices);
  checklist.update();
  mentor.update(ctx);
  toolbar.update(devices.activeTool, devices, pressed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

showStartScreen(document.body).then((choice) => {
  audio.unlock();
  store.set({ started: true });
  if (choice === 'demo') {
    demo.start();
    input.auto = demo.auto;
  }
});

// Handy for debugging in the browser console.
Object.assign(window, { __sim: { store, anatomy, views, bolus, devices, procedure, log, patient, demo, input } });
