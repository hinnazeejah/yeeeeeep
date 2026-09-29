import { FLUORO, type CArmAngle } from '../config/anatomy';
import { store, type SimState } from '../state/store';

/** Formats a C-arm angle the way it is written in cath reports, e.g. "RAO 30° CRA 30°". */
export function formatCArm(a: CArmAngle): string {
  const side = a.lao === 0 ? 'AP' : `${a.lao > 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(a.lao))}°`;
  const tilt = a.cra === 0 ? '' : ` ${a.cra > 0 ? 'CRA' : 'CAU'} ${Math.abs(Math.round(a.cra))}°`;
  return side + tilt;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Top bar, key hints and the text overlay on the fluoro monitor. */
export class Hud {
  private readonly viewTag: HTMLElement;
  private readonly xrayTag: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly carmEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly msgEl: HTMLElement;

  constructor(root: HTMLElement) {
    const top = document.createElement('div');
    top.id = 'hud-top';
    top.className = 'panel';
    top.innerHTML = `
      <span class="title">PCI SIM</span>
      <span class="tag" data-view>3D</span>
      <span class="tag" data-xray>X-RAY OFF</span>`;
    root.appendChild(top);
    this.viewTag = top.querySelector('[data-view]')!;
    this.xrayTag = top.querySelector('[data-xray]')!;

    const hints = document.createElement('div');
    hints.id = 'hud-hints';
    hints.className = 'panel';
    hints.innerHTML =
      '<b>Tab</b> view · <b>Space</b> fluoro · <b>C</b> cine · <b>V</b> C-arm preset · <b>←↑↓→</b> angle · <b>L</b> labels · drag to orbit (3D)';
    root.appendChild(hints);

    this.overlay = document.createElement('div');
    this.overlay.id = 'fluoro-overlay';
    this.overlay.innerHTML = `
      <div class="corner tl"><div data-carm></div><div class="dim">FOV 7"</div></div>
      <div class="corner tr"><div data-mode></div><div>${FLUORO.fps} p/s</div></div>
      <div class="center-msg" data-msg>Hold SPACE for fluoroscopy</div>`;
    root.appendChild(this.overlay);
    this.carmEl = this.overlay.querySelector('[data-carm]')!;
    this.modeEl = this.overlay.querySelector('[data-mode]')!;
    this.msgEl = this.overlay.querySelector('[data-msg]')!;

    store.subscribe((s) => this.update(s));
    this.update(store.state);
  }

  update(s: SimState, cine = false, hasImage = false): void {
    const fluoro = s.view === 'fluoro';
    this.viewTag.textContent = fluoro ? 'FLUORO' : '3D';
    this.viewTag.classList.toggle('on', fluoro);
    this.xrayTag.textContent = s.xrayOn ? 'X-RAY ON' : 'X-RAY OFF';
    this.xrayTag.classList.toggle('xray', s.xrayOn);
    this.overlay.classList.toggle('visible', fluoro);
    this.carmEl.textContent = formatCArm(s.carm);
    this.modeEl.textContent = cine ? 'CINE' : s.xrayOn ? 'FLUORO' : 'LIH';
    this.msgEl.style.display = hasImage ? 'none' : '';
  }
}
