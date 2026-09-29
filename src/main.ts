import './ui/styles.css';
import { Timer, Vector3 } from 'three';
import { FLUORO } from './config/anatomy';
import { AnatomyModel } from './anatomy/anatomyModel';
import { ContrastBolus } from './physics/flow';
import { ViewManager } from './scene/viewManager';
import { store } from './state/store';
import { DeviceController } from './tools/deviceController';
import { HoverPicker } from './tools/hover';
import { TOOL_BY_KEY, TOOLS, type ToolId } from './tools/tools';
import { Procedure } from './procedure/procedure';
import { buildContext, ProcedureLog } from './procedure/snapshot';
import { formatCArm } from './ui/hud';
import { Checklist } from './ui/checklist';
import { MentorPanel } from './ui/mentor';
import { DevicePanel } from './ui/devicePanel';
import { Hud } from './ui/hud';
import { DeviceInput } from './ui/input';
import { Messages } from './ui/messages';
import { showStartScreen } from './ui/startScreen';
import { Toolbar } from './ui/toolbar';

const app = document.getElementById('app')!;
const views = new ViewManager(app);
const anatomy = new AnatomyModel(views.scene3d, views.sceneFluoro);
const devices = new DeviceController(anatomy, views.scene3d, views.sceneFluoro);
const bolus = new ContrastBolus();
const input = new DeviceInput();
const procedure = new Procedure();
const log = new ProcedureLog();

const hud = new Hud(document.body);
const messages = new Messages(document.body);
const panel = new DevicePanel(document.body, input);
const hover = new HoverPicker(views.renderer.domElement, anatomy, devices);
const checklist = new Checklist(document.body, procedure);
const mentor = new MentorPanel(document.body, procedure);
devices.onFeedback = (f) => messages.show(f);

views.setCArm(store.state.carm);
views.onBeforeLabels = (cam) => anatomy.updateLabels(cam);

// ---------------------------------------------------------------------------
// Tool actions
// ---------------------------------------------------------------------------

let pedalDown = false;
const pressed: Partial<Record<ToolId, boolean>> = {};

function selectTool(id: ToolId): void {
  const f = devices.selectTool(id);
  if (f) messages.show(f);
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

function applyCursor(): void {
  const def = TOOLS.find((t) => t.id === devices.activeTool)!;
  views.renderer.domElement.style.cursor = def.cursor;
}

const toolbar = new Toolbar(document.body, {
  select: selectTool,
  action: (id) => id === 'contrast' && injectContrast(),
  hold: (id, down) => id === 'fluoro' && setPedal(down),
});
applyCursor();

// ---------------------------------------------------------------------------
// Keyboard and mouse
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (!store.state.started) return;
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
    case 'KeyV': {
      const i = (s.carmPreset + 1) % FLUORO.presets.length;
      const p = FLUORO.presets[i];
      store.set({ carmPreset: i, carm: { lao: p.lao, cra: p.cra } });
      views.setCArm(store.state.carm);
      break;
    }
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

// Wheel: drives the active device; Ctrl/Cmd + wheel (or a non-device tool) zooms the 3D camera.
const canvas = views.renderer.domElement;
canvas.addEventListener(
  'wheel',
  (e) => {
    const deviceTool = devices.activeTool === 'guide' || devices.activeTool === 'wire';
    if (deviceTool && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      input.addWheel(-Math.sign(e.deltaY) * (input.fine ? 1 : 4));
      views.controls.enableZoom = false;
    } else {
      views.controls.enableZoom = true;
    }
  },
  { capture: true, passive: false },
);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const timer = new Timer();
timer.connect(document);
const tipPos = new Vector3();
const followDelta = new Vector3();

function frame(time: number): void {
  timer.update(time);
  const dt = Math.min(0.1, timer.getDelta());
  const s = store.state;

  if (s.started) s.elapsed += dt;
  s.beatPhase = (s.beatPhase + (dt * s.hr) / 60) % 1;
  anatomy.updateBeat(s.beatPhase);

  input.enabled = s.started;
  devices.update(dt, input);

  bolus.update(dt);
  anatomy.updateContrast(bolus);

  // X-rays are on while the pedal is held or during a cine run.
  const xrayOn = pedalDown || bolus.active;
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
      messages.show({ text: 'All stages complete.', level: 'ok' });
    }
  }
  devices.stageIndex = procedure.current;

  // Camera follow: glide the orbit target (and the camera with it) towards the device tip.
  if (s.follow && s.view === '3d') {
    devices.activeTip(tipPos);
    followDelta.subVectors(tipPos, views.controls.target).multiplyScalar(1 - Math.exp(-dt * 3));
    views.controls.target.add(followDelta);
    views.camera3d.position.add(followDelta);
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

showStartScreen(document.body).then(() => store.set({ started: true }));

// Handy for debugging in the browser console.
Object.assign(window, { __sim: { store, anatomy, views, bolus, devices, procedure, log } });
