import type { DeviceController } from '../tools/deviceController';
import type { DeviceInput } from './input';

/**
 * Shows the state of the device being driven: inserted length, tip location, rotation dial,
 * branch hints and the resistance meter, plus hold-buttons for mouse / touch control.
 */
export class DevicePanel {
  private readonly el: HTMLElement;
  private readonly f: Record<string, HTMLElement> = {};
  private readonly needle: SVGLineElement;
  private readonly target: SVGCircleElement;

  constructor(root: HTMLElement, input: DeviceInput) {
    this.el = document.createElement('div');
    this.el.id = 'device-panel';
    this.el.className = 'panel';
    this.el.innerHTML = `
      <div class="dp-head"><span data-f="name"></span><span class="mono dim" data-f="len"></span></div>
      <div class="dp-body">
        <svg class="dial" viewBox="-30 -30 60 60" width="64" height="64">
          <circle r="26" class="dial-ring"/>
          <circle r="3.5" cx="0" cy="-26" class="dial-target"/>
          <line x1="0" y1="0" x2="0" y2="-22" class="dial-needle"/>
          <circle r="2.5" class="dial-hub"/>
        </svg>
        <div class="dp-rows">
          <div><span class="dim">Tip</span> <span data-f="loc"></span></div>
          <div><span class="dim">Rot</span> <span class="mono" data-f="rot"></span> <span data-f="facing"></span></div>
          <div data-f="hint" class="hint"></div>
          <div class="meter-row" data-f="meterRow"><span class="dim">Resistance</span><div class="meter"><div data-f="meter"></div></div></div>
        </div>
      </div>
      <div class="pad">
        <button data-a="-1" title="Retract (S)">▼</button>
        <button data-a="1" title="Advance (W)">▲</button>
        <button data-r="-1" title="Rotate left (A)">⟲</button>
        <button data-r="1" title="Rotate right (D)">⟳</button>
        <span class="dim pad-hint">Shift = fine</span>
      </div>`;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>('[data-f]').forEach((e) => (this.f[e.dataset.f!] = e));
    this.needle = this.el.querySelector('.dial-needle')!;
    this.target = this.el.querySelector('.dial-target')!;

    this.el.querySelectorAll<HTMLButtonElement>('.pad button').forEach((b) => {
      const set = (on: boolean) => {
        if (b.dataset.a) input.padAdvance = on ? Number(b.dataset.a) : 0;
        if (b.dataset.r) input.padRotate = on ? Number(b.dataset.r) : 0;
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        set(true);
      });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
    });
  }

  update(d: DeviceController): void {
    const tool = d.activeTool;
    const show = tool === 'guide' || tool === 'wire';
    this.el.style.display = show ? '' : 'none';
    if (!show) return;

    if (tool === 'guide') {
      const g = d.guide;
      this.f.name.textContent = 'GUIDE CATHETER 6F';
      this.f.len.textContent = `${g.inserted.toFixed(0)} mm`;
      this.f.loc.textContent = g.location();
      this.f.rot.textContent = `${g.rotation.toFixed(0).padStart(3, ' ')}°`;
      this.f.facing.textContent = g.inAorta ? `→ ${g.facing()}` : '';
      this.f.facing.className = g.facing() === 'Left coronary cusp' ? 'ok' : '';
      this.needle.setAttribute('transform', `rotate(${g.rotation})`);
      this.target.style.display = g.atRoot ? '' : 'none';
      this.target.setAttribute('transform', 'rotate(0)');
      let hint = '';
      if (g.engaged) hint = 'Engaged. Select the guidewire (2).';
      else if (g.atRoot) hint = 'At the root: rotate until the tip faces the left cusp, then advance.';
      else if (g.inAorta) hint = 'Advance down the ascending aorta to the root.';
      else hint = 'Advance up the arm (W or wheel).';
      this.f.hint.textContent = hint;
      this.f.meterRow.style.display = 'none';
    } else {
      const w = d.wire;
      this.f.name.textContent = 'GUIDEWIRE 0.014"';
      this.f.len.textContent = `${w.out.toFixed(0)} mm out`;
      this.f.loc.textContent = w.location();
      this.f.loc.className = w.inLesion ? 'warn' : w.distal ? 'ok' : '';
      this.f.rot.textContent = `${w.rotation.toFixed(0).padStart(3, ' ')}°`;
      this.f.facing.textContent = '';
      this.needle.setAttribute('transform', `rotate(${w.rotation})`);
      this.target.style.display = 'none';
      const up = w.upcomingBranch();
      if (w.inLesion) this.f.hint.textContent = 'In the lesion: advance slowly with Shift held.';
      else if (up) this.f.hint.textContent = `${up.name} in ${up.mm.toFixed(0)} mm: tip ${up.pointing ? 'WILL enter it' : 'will pass it'}`;
      else if (w.crossed && w.distal) this.f.hint.textContent = 'Wire is across the lesion in the distal LAD. ✓';
      else if (!w.tip) this.f.hint.textContent = 'Advance the wire out of the guide into the left main.';
      else this.f.hint.textContent = '';
      this.f.meterRow.style.display = '';
      const pct = Math.min(100, (w.force / 20) * 100);
      this.f.meter.style.width = `${pct}%`;
      this.f.meter.className = pct > 50 ? 'danger' : pct > 10 ? 'warn' : '';
    }
  }
}
