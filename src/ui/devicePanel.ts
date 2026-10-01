import type { BalloonCatheter } from '../physics/balloon';
import type { DeviceController } from '../tools/deviceController';
import type { DeviceInput } from './input';

const GAUGE_MAX = 22;

/** Point on the pressure gauge arc for a given pressure (atm). Arc runs from -135° to +135°. */
function gaugeAngle(atm: number): number {
  return -135 + (270 * Math.min(GAUGE_MAX, Math.max(0, atm))) / GAUGE_MAX;
}

function tick(atm: number, cls: string): string {
  const a = (gaugeAngle(atm) * Math.PI) / 180;
  const x1 = Math.sin(a) * 20;
  const y1 = -Math.cos(a) * 20;
  const x2 = Math.sin(a) * 27;
  const y2 = -Math.cos(a) * 27;
  return `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
}

/**
 * Shows the state of the device being driven: guide and wire (rotation dial, tip location, branch
 * hints, resistance), balloon and stent (size, position against the lesion, inflation gauge) and
 * QCA measurements. Includes hold-buttons for mouse / touch control.
 */
export class DevicePanel {
  private readonly el: HTMLElement;
  private readonly f: Record<string, HTMLElement> = {};
  private readonly needle: SVGLineElement;
  private readonly target: SVGCircleElement;
  private readonly gaugeNeedle: SVGLineElement;
  private readonly gaugeTicks: SVGGElement;
  private mode = '';
  private sizeKey = '';
  onSize: (kind: 'balloon' | 'stent', d: number, l: number) => void = () => {};

  constructor(root: HTMLElement, input: DeviceInput) {
    this.el = document.createElement('div');
    this.el.id = 'device-panel';
    this.el.className = 'panel';
    this.el.innerHTML = `
      <div class="dp-head"><span data-f="name"></span><span class="mono dim" data-f="len"></span></div>
      <div class="dp-body sec-steer">
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
      <div class="sec-cath">
        <div class="size-row"><span class="dim">Ø mm</span><span class="chips" data-f="dChips"></span></div>
        <div class="size-row"><span class="dim">L mm</span><span class="chips" data-f="lChips"></span></div>
        <div class="dp-body">
          <svg class="gauge" viewBox="-30 -30 60 60" width="72" height="72">
            <path class="gauge-arc" d="${arc(0, GAUGE_MAX)}"/>
            <g data-ticks></g>
            <line x1="0" y1="0" x2="0" y2="-22" class="gauge-needle"/>
            <circle r="2.5" class="dial-hub"/>
          </svg>
          <div class="dp-rows">
            <div><span class="mono big" data-f="atm">0.0</span> <span class="dim">atm</span> <span class="mono" data-f="dia"></span></div>
            <div class="dim mono" data-f="specs"></div>
            <div><span class="dim">Pos</span> <span data-f="pos"></span></div>
            <div class="hint" data-f="chint"></div>
          </div>
        </div>
      </div>
      <div class="sec-qca">
        <table class="qca mono">
          <tr><td class="dim">Reference Ø</td><td data-f="qRef"></td></tr>
          <tr><td class="dim">Minimal lumen Ø</td><td data-f="qMld"></td></tr>
          <tr><td class="dim">Diameter stenosis</td><td data-f="qDs"></td></tr>
          <tr><td class="dim">Lesion length</td><td data-f="qLen"></td></tr>
        </table>
        <div class="hint">Rule of thumb: stent Ø about 1:1 with the reference; length covers the lesion plus 2–3 mm each side. Hover the LAD in 3D to read local diameters.</div>
      </div>
      <div class="pad">
        <button data-a="-1" title="Retract (S)">▼</button>
        <button data-a="1" title="Advance (W)">▲</button>
        <button class="steer" data-r="-1" title="Rotate left (A)">⟲</button>
        <button class="steer" data-r="1" title="Rotate right (D)">⟳</button>
        <button class="cath wide" data-i="1" title="Hold to inflate (E)">Inflate (E)</button>
        <button class="cath wide" data-q="1" title="Deflate (Q)">Deflate (Q)</button>
        <span class="dim pad-hint">Shift = fine</span>
      </div>`;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>('[data-f]').forEach((e) => (this.f[e.dataset.f!] = e));
    this.needle = this.el.querySelector('.dial-needle')!;
    this.target = this.el.querySelector('.dial-target')!;
    this.gaugeNeedle = this.el.querySelector('.gauge-needle')!;
    this.gaugeTicks = this.el.querySelector('[data-ticks]')!;

    this.el.querySelectorAll<HTMLButtonElement>('.pad button').forEach((b) => {
      const set = (on: boolean) => {
        if (b.dataset.a) input.padAdvance = on ? Number(b.dataset.a) : 0;
        if (b.dataset.r) input.padRotate = on ? Number(b.dataset.r) : 0;
        if (b.dataset.i) input.padInflate = on;
        if (b.dataset.q && on) input.requestDeflate();
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        set(true);
      });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
    });
  }

  private setMode(mode: string): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.el.dataset.mode = mode;
    this.sizeKey = '';
  }

  update(d: DeviceController): void {
    const tool = d.activeTool;
    const mode = tool === 'guide' || tool === 'wire' ? 'steer' : tool === 'balloon' || tool === 'stent' ? 'cath' : tool === 'measure' ? 'qca' : '';
    this.el.style.display = mode ? '' : 'none';
    this.setMode(mode);
    if (mode === 'steer') this.updateSteer(d);
    else if (mode === 'cath') this.updateCath(d, tool === 'stent' ? d.stentSys : d.balloon);
    else if (mode === 'qca') this.updateQca(d);
  }

  private updateSteer(d: DeviceController): void {
    if (d.activeTool === 'guide') {
      const g = d.guide;
      this.f.name.textContent = 'GUIDE CATHETER 6F';
      this.f.len.textContent = `${g.inserted.toFixed(0)} mm`;
      this.f.loc.textContent = g.location();
      this.f.loc.className = '';
      this.f.rot.textContent = `${g.rotation.toFixed(0).padStart(3, ' ')}°`;
      this.f.facing.textContent = g.inAorta ? `→ ${g.facing()}` : '';
      this.f.facing.className = g.facing() === 'Left coronary cusp' ? 'ok' : '';
      this.needle.setAttribute('transform', `rotate(${g.rotation})`);
      this.target.style.display = g.atRoot ? '' : 'none';
      let hint = '';
      if (g.engaged) hint = d.stageIndex < 2 ? 'Engaged. Take an angiogram (5).' : 'Engaged. Select the guidewire (2).';
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

  private updateCath(d: DeviceController, c: BalloonCatheter): void {
    const stent = c.kind === 'stent';
    this.f.name.textContent = `${stent ? 'STENT (DES)' : 'BALLOON'} ${c.label}`;
    this.f.len.textContent = c.out ? `${c.adv.toFixed(0)} mm out` : 'in guide';

    // Size chips: rebuilt only when the size or availability changes.
    const key = `${c.kind}|${c.sizeIdx.d}|${c.sizeIdx.l}|${c.out}`;
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      const chips = (vals: number[], sel: number, digits: number, onPick: (i: number) => void) => {
        const frag = document.createDocumentFragment();
        vals.forEach((v, i) => {
          const b = document.createElement('button');
          b.className = `chip${i === sel ? ' sel' : ''}`;
          b.textContent = v.toFixed(digits);
          b.disabled = c.out;
          b.title = c.out ? 'Pull the catheter back into the guide to change size' : '';
          b.addEventListener('click', () => onPick(i));
          frag.appendChild(b);
        });
        return frag;
      };
      this.f.dChips.replaceChildren(chips(c.spec.diameters, c.sizeIdx.d, stent ? 2 : 1, (i) => this.onSize(c.kind, i, c.sizeIdx.l)));
      this.f.lChips.replaceChildren(chips(c.spec.lengths, c.sizeIdx.l, 0, (i) => this.onSize(c.kind, c.sizeIdx.d, i)));
      this.gaugeTicks.innerHTML = tick(c.spec.nominalAtm, 'tick-nominal') + tick(c.spec.rbpAtm, 'tick-rbp');
      this.f.specs.textContent = `Nominal ${c.spec.nominalAtm} atm · RBP ${c.spec.rbpAtm} atm`;
    }

    this.f.atm.textContent = c.pressure.toFixed(1);
    this.f.atm.className = `mono big ${c.pressure > c.spec.rbpAtm ? 'danger-text' : c.pressure >= c.spec.nominalAtm ? 'ok' : ''}`;
    this.f.dia.textContent = c.inflated ? `→ Ø ${c.diameter().toFixed(2)} mm${c.occluding ? ` · ${c.inflatedSeconds.toFixed(0)} s` : ''}` : '';
    this.gaugeNeedle.setAttribute('transform', `rotate(${gaugeAngle(c.pressure)})`);

    const span = d.span(c);
    const cov = d.lesionCoverage(c);
    const les = d.lesionSpan;
    let pos = '';
    let cls = '';
    if (!c.out) pos = 'Inside the guide';
    else if (!span || !cov) pos = 'Off the LAD';
    else if (cov.covers) {
      pos = `Covers the lesion ✓ (prox +${cov.proximalMargin.toFixed(1)}, dist +${cov.distalMargin.toFixed(1)} mm)`;
      cls = 'ok';
    } else if (cov.overlap > 0) {
      pos = `Partly over the lesion (prox ${signed(cov.proximalMargin)}, dist ${signed(cov.distalMargin)} mm)`;
      cls = 'warn';
    } else if (span.end <= les.start) {
      pos = `${(les.start - span.end).toFixed(0)} mm proximal to the lesion`;
    } else {
      pos = `${(span.start - les.end).toFixed(0)} mm beyond the lesion`;
    }
    this.f.pos.textContent = pos;
    this.f.pos.className = cls;

    let hint = '';
    if (c.ruptured) hint = 'Ruptured. Pull back into the guide (S) to exchange it.';
    else if (stent && c.deployed && !c.inflated) hint = 'Stent deployed. Re-inflate inside it to post-dilate, or pull back (S).';
    else if (!c.out) hint = 'Pick a size, then advance over the wire (W).';
    else if (c.inflated) hint = c.pressure > c.spec.rbpAtm ? 'Above RBP: rupture risk!' : 'Hold E to raise pressure, Q to deflate.';
    else hint = 'Line the markers up across the lesion (watch on fluoro), then hold E.';
    this.f.chint.textContent = hint;
  }

  private updateQca(d: DeviceController): void {
    const q = d.qca();
    this.f.name.textContent = 'QCA · MID LAD';
    this.f.len.textContent = '';
    this.f.qRef.textContent = `${q.referenceDiameter.toFixed(2)} mm`;
    this.f.qMld.textContent = `${q.mld.toFixed(2)} mm`;
    this.f.qDs.textContent = `${Math.round(q.ds * 100)}%`;
    this.f.qDs.className = q.ds > 0.5 ? 'danger-text' : q.ds > 0.2 ? 'warn' : 'ok';
    this.f.qLen.textContent = q.lesionLength > 0.5 ? `${q.lesionLength.toFixed(1)} mm` : '—';
  }
}

function signed(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
}

/** SVG arc path on the gauge between two pressures. */
function arc(from: number, to: number): string {
  const r = 24;
  const a0 = (gaugeAngle(from) * Math.PI) / 180;
  const a1 = (gaugeAngle(to) * Math.PI) / 180;
  const p = (a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  return `M ${p(a0)} A ${r} ${r} 0 1 1 ${p(a1)}`;
}

