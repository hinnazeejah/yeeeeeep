import './ui/styles.css';
import { Timer } from 'three';
import { FLUORO } from './config/anatomy';
import { AnatomyModel } from './anatomy/anatomyModel';
import { ContrastBolus } from './physics/flow';
import { ViewManager } from './scene/viewManager';
import { store } from './state/store';
import { Hud } from './ui/hud';
import { showStartScreen } from './ui/startScreen';

const app = document.getElementById('app')!;
const views = new ViewManager(app);
const anatomy = new AnatomyModel(views.scene3d, views.sceneFluoro);
const hud = new Hud(document.body);
const bolus = new ContrastBolus();

views.setCArm(store.state.carm);
views.onBeforeLabels = (cam) => anatomy.updateLabels(cam);

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

let pedalDown = false;

window.addEventListener('keydown', (e) => {
  if (!store.state.started) return;
  const s = store.state;
  switch (e.code) {
    case 'Tab':
      e.preventDefault();
      store.set({ view: s.view === '3d' ? 'fluoro' : '3d' });
      break;
    case 'Space':
      e.preventDefault();
      pedalDown = true;
      break;
    case 'KeyC':
      if (!e.repeat) {
        bolus.start();
        if (s.view !== 'fluoro') store.set({ view: 'fluoro' });
      }
      break;
    case 'KeyV': {
      const i = (s.carmPreset + 1) % FLUORO.presets.length;
      const p = FLUORO.presets[i];
      store.set({ carmPreset: i, carm: { lao: p.lao, cra: p.cra } });
      views.setCArm(store.state.carm);
views.onBeforeLabels = (cam) => anatomy.updateLabels(cam);
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
views.onBeforeLabels = (cam) => anatomy.updateLabels(cam);
      break;
    }
    case 'KeyL':
      store.set({ labelsVisible: !s.labelsVisible });
      anatomy.setLabelsVisible(store.state.labelsVisible);
      break;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') pedalDown = false;
});
window.addEventListener('blur', () => (pedalDown = false));

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const timer = new Timer();
timer.connect(document);

function frame(time: number): void {
  timer.update(time);
  const dt = Math.min(0.1, timer.getDelta());
  const s = store.state;

  if (s.started) s.elapsed += dt;
  s.beatPhase = (s.beatPhase + (dt * s.hr) / 60) % 1;
  anatomy.updateBeat(s.beatPhase);

  bolus.update(dt);
  anatomy.updateContrast(bolus);

  // X-rays are on while the pedal is held or during a cine run.
  const xrayOn = pedalDown || bolus.active;
  if (xrayOn !== s.xrayOn) store.set({ xrayOn });

  views.render(s.view, dt, xrayOn);
  hud.update(s, bolus.active, views.fluoro.hasImage);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

showStartScreen(document.body).then(() => store.set({ started: true }));

// Handy for debugging in the browser console.
Object.assign(window, { __sim: { store, anatomy, views, bolus } });
