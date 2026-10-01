import { ecgSample, type Physiology } from '../physics/physiology';

/**
 * Patient monitor (top right): sweeping V2 ECG, heart rate, blood pressure, SpO2, ACT, ST level,
 * plus buttons for heparin and sound.
 */
export class VitalsPanel {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly f: Record<string, HTMLElement> = {};
  private x = 0;
  private lastY: number | null = null;
  private lastPhase = 0;
  private numbersAt = 0;
  onHeparin: () => void = () => {};
  onMute: () => void = () => {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'vitals';
    this.el.className = 'panel';
    this.el.innerHTML = `
      <div class="vt-head"><span class="panel-title">MONITOR</span><span class="vt-alarm" data-f="alarm"></span></div>
      <div class="vt-ecg"><span class="vt-lead mono">V2</span><canvas width="300" height="64"></canvas></div>
      <div class="vt-nums">
        <div class="vt-num hr"><span class="dim">HR</span><b class="mono" data-f="hr">72</b></div>
        <div class="vt-num bp"><span class="dim">ART</span><b class="mono" data-f="bp">128/76</b></div>
        <div class="vt-num sp"><span class="dim">SpO₂</span><b class="mono" data-f="spo2">98</b></div>
      </div>
      <div class="vt-row mono">
        <span><span class="dim">ST V2</span> <span data-f="st">0.0</span> mm</span>
        <span><span class="dim">ACT</span> <span data-f="act">128</span> s</span>
      </div>
      <div class="vt-actions">
        <button data-f="heparin" title="Unfractionated heparin 70–100 U/kg IV (key G)">Heparin (G)</button>
        <button data-f="mute" title="Monitor sound (key N)">Sound on (N)</button>
      </div>`;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>('[data-f]').forEach((e) => (this.f[e.dataset.f!] = e));
    this.canvas = this.el.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
    this.g.fillStyle = '#05080a';
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.f.heparin.addEventListener('click', () => this.onHeparin());
    this.f.mute.addEventListener('click', () => this.onMute());
  }

  /**
   * Draw the next slice of the ECG sweep.
   * @param phase cardiac phase now (0 = R wave), `pvc` = current beat is ectopic
   */
  update(dt: number, phase: number, p: Physiology, pvc: boolean, heparinGiven: boolean, muted: boolean): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const g = this.g;
    const speed = 75; // px per second (about 25 mm/s on a small screen)
    const steps = Math.max(1, Math.ceil(dt * speed));
    const dPhase = (phase - this.lastPhase + 1) % 1;
    for (let i = 1; i <= steps; i++) {
      const ph = (this.lastPhase + (dPhase * i) / steps) % 1;
      const v = ecgSample(ph, p.stMm, pvc);
      const y = h * 0.62 - v * h * 0.42;
      const x0 = this.x;
      this.x = (this.x + (dt * speed) / steps) % w;
      // Erase a gap ahead of the trace, like a real sweep monitor.
      g.fillStyle = '#05080a';
      g.fillRect(Math.floor(this.x), 0, 8, h);
      if (this.lastY !== null && this.x > x0) {
        g.strokeStyle = '#5ee27a';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x0, this.lastY);
        g.lineTo(this.x, y);
        g.stroke();
      }
      this.lastY = y;
    }
    this.lastPhase = phase;

    // Numbers refresh a few times per second.
    this.numbersAt -= dt;
    if (this.numbersAt > 0) return;
    this.numbersAt = 0.4;
    this.f.hr.textContent = String(Math.round(p.hr));
    this.f.bp.textContent = `${Math.round(p.sys)}/${Math.round(p.dia)}`;
    this.f.spo2.textContent = String(Math.round(p.spo2));
    this.f.st.textContent = (p.stMm >= 0.05 ? '+' : '') + p.stMm.toFixed(1);
    this.f.st.className = p.stMm >= 2 ? 'danger-text' : p.stMm >= 1 ? 'warn' : '';
    this.f.act.textContent = String(Math.round(p.act));
    this.f.act.className = p.act >= 250 ? 'ok' : '';
    this.f.bp.parentElement!.classList.toggle('low', p.sys < 100);
    const alarm = p.unstable ? 'HYPOTENSION · VENTRICULAR ECTOPY' : p.stMm >= 2 ? 'ST ELEVATION' : p.ectopyRate > 0 ? 'PVCs' : '';
    this.f.alarm.textContent = alarm;
    this.f.heparin.toggleAttribute('disabled', heparinGiven);
    this.f.heparin.textContent = heparinGiven ? 'Heparin given ✓' : 'Heparin (G)';
    this.f.mute.textContent = muted ? 'Sound off (N)' : 'Sound on (N)';
  }
}
