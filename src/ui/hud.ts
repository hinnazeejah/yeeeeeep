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
  private readonly flEl: HTMLElement;
  private readonly ctEl: HTMLElement;
  private readonly help: HTMLElement;

  toggleHelp(): void {
    this.help.classList.toggle('show');
  }

  constructor(root: HTMLElement) {
    const top = document.createElement('div');
    top.id = 'hud-top';
    top.className = 'panel';
    top.innerHTML = `
      <span class="title">PCI SIM</span>
      <span class="tag" data-view>3D</span>
      <span class="tag" data-xray>X-RAY OFF</span>
      <span class="stat">FLUORO <b class="mono" data-fl>00:00</b></span>
      <span class="stat">CONTRAST <b class="mono" data-ct>0</b> ml</span>`;
    root.appendChild(top);
    this.viewTag = top.querySelector('[data-view]')!;
    this.xrayTag = top.querySelector('[data-xray]')!;
    this.flEl = top.querySelector('[data-fl]')!;
    this.ctEl = top.querySelector('[data-ct]')!;

    const helpBtn = document.createElement('button');
    helpBtn.className = 'tag help-btn';
    helpBtn.textContent = 'H · KEYS';
    top.appendChild(helpBtn);
    this.help = document.createElement('div');
    this.help.id = 'hud-help';
    this.help.className = 'panel';
    this.help.innerHTML = `
      <table>
        <tr><td>1–7</td><td>Select tool (hover a tool for its rules)</td></tr>
        <tr><td>W / S · wheel</td><td>Advance / retract the device</td></tr>
        <tr><td>A / D</td><td>Rotate (torque) the device</td></tr>
        <tr><td>Shift</td><td>Fine control</td></tr>
        <tr><td>Space · 6</td><td>Fluoro pedal (hold)</td></tr>
        <tr><td>5 · C</td><td>Contrast injection (cine)</td></tr>
        <tr><td>Tab</td><td>3D view / fluoroscopy</td></tr>
        <tr><td>V · arrows</td><td>C-arm projection / angle</td></tr>
        <tr><td>F</td><td>Camera follows device tip</td></tr>
        <tr><td>L</td><td>Anatomy labels</td></tr>
        <tr><td>Drag · Ctrl+wheel</td><td>Orbit / zoom (3D)</td></tr>
      </table>`;
    root.appendChild(this.help);
    helpBtn.addEventListener('click', () => this.toggleHelp());

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
    this.flEl.textContent = formatTime(s.fluoroSeconds);
    this.ctEl.textContent = String(s.contrastMl);
  }
}
