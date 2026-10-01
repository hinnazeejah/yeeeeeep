import { DEVICES } from '../config/anatomy';
import { achievedDiameter } from '../procedure/evaluation';
import type { Feedback } from './guideCatheter';

const INF = DEVICES.inflation;

export type BalloonKind = 'balloon' | 'stent';

/**
 * A balloon catheter that rides over the guidewire: either a pre-dilation balloon or a stent
 * delivery system (a stent crimped on a balloon). Position is the distance of the distal marker
 * beyond the guide tip along the wire (mm). Pressure comes from the inflation device (atm).
 */
export class BalloonCatheter {
  readonly spec: typeof DEVICES.balloon | typeof DEVICES.stent;
  sizeIdx: { d: number; l: number };
  /** Distal marker position beyond the guide tip along the wire (mm); 0 = inside the guide. */
  adv = 0;
  pressure = 0;
  deflating = false;
  ruptured = false;
  /** Seconds the current inflation has been up (pressure >= 2 atm). */
  inflatedSeconds = 0;
  /** Highest pressure reached in the current inflation. */
  peakAtm = 0;
  /** Stent only: the stent has been expanded off the balloon. */
  deployed = false;
  private warnedRbp = false;

  constructor(readonly kind: BalloonKind) {
    this.spec = kind === 'balloon' ? DEVICES.balloon : DEVICES.stent;
    this.sizeIdx = { ...this.spec.defaultSize };
  }

  get nominal(): number {
    return this.spec.diameters[this.sizeIdx.d];
  }

  get length(): number {
    return this.spec.lengths[this.sizeIdx.l];
  }

  get out(): boolean {
    return this.adv > 0.01;
  }

  /** Balloon up enough to be touching the wall and blocking flow. */
  get occluding(): boolean {
    return this.pressure >= 2;
  }

  get inflated(): boolean {
    return this.pressure > 0.3;
  }

  get label(): string {
    const d = this.kind === 'stent' ? this.nominal.toFixed(2) : this.nominal.toFixed(1);
    return `${d} × ${this.length} mm`;
  }

  /** Current balloon diameter (mm). */
  diameter(): number {
    return achievedDiameter(this.nominal, this.pressure, this.spec);
  }

  /** Radius to draw (never thinner than the folded balloon). */
  drawRadius(): number {
    return Math.max(INF.foldedRadius, this.diameter() / 2);
  }

  /** Change size; only possible while the catheter is outside the patient (inside the guide). */
  setSize(d: number, l: number): Feedback | null {
    if (this.out) return { text: 'Pull the catheter back into the guide before changing its size.', level: 'warn' };
    this.sizeIdx = {
      d: Math.max(0, Math.min(this.spec.diameters.length - 1, d)),
      l: Math.max(0, Math.min(this.spec.lengths.length - 1, l)),
    };
    return null;
  }

  /** Slide along the wire. `maxAdv` keeps the tip behind the wire tip. */
  move(mm: number, maxAdv: number): Feedback | null {
    if (mm === 0) return null;
    if (this.inflated) {
      return { text: 'Deflate fully before moving the balloon. Dragging an inflated balloon can tear the artery.', level: 'warn' };
    }
    const before = this.adv;
    this.adv = Math.max(0, Math.min(Math.max(0, maxAdv), this.adv + mm));
    if (mm > 0 && this.adv >= maxAdv - 0.01 && before >= maxAdv - 0.01) {
      return { text: 'The balloon is near the wire tip. Advance the wire further before pushing the balloon on.', level: 'warn' };
    }
    return null;
  }

  /** Screw in the inflation device. Returns feedback and whether the balloon just ruptured. */
  inflate(atm: number): { feedback: Feedback | null; ruptured: boolean } {
    if (atm <= 0) return { feedback: null, ruptured: false };
    if (!this.out) return { feedback: { text: 'Advance the balloon out of the guide first.', level: 'warn' }, ruptured: false };
    if (this.ruptured) {
      return { feedback: { text: 'This balloon has ruptured. Pull it back into the guide to exchange it.', level: 'warn' }, ruptured: false };
    }
    this.deflating = false;
    this.pressure += atm;
    this.peakAtm = Math.max(this.peakAtm, this.pressure);
    if (this.pressure > this.spec.rbpAtm + INF.ruptureOverRbp) {
      this.ruptured = true;
      this.pressure = 0;
      this.deflating = false;
      return {
        feedback: { text: `The balloon ruptured at ${this.peakAtm.toFixed(0)} atm (rated burst ${this.spec.rbpAtm} atm).`, level: 'danger' },
        ruptured: true,
      };
    }
    if (this.pressure > this.spec.rbpAtm && !this.warnedRbp) {
      this.warnedRbp = true;
      return {
        feedback: { text: `Above rated burst pressure (${this.spec.rbpAtm} atm). Risk of balloon rupture.`, level: 'danger' },
        ruptured: false,
      };
    }
    return { feedback: null, ruptured: false };
  }

  /** Pull negative on the inflation device: deflates fully over the next second or two. */
  deflate(): void {
    if (this.pressure > 0) this.deflating = true;
  }

  /**
   * Advance timers. Returns 'deflated' on the frame an inflation ends (so the caller can record it).
   */
  update(dt: number): 'deflated' | null {
    if (this.occluding) this.inflatedSeconds += dt;
    if (this.deflating) {
      this.pressure = Math.max(0, this.pressure - INF.deflateAtmPerS * dt);
      if (this.pressure === 0) {
        this.deflating = false;
        return this.endInflation();
      }
    }
    if (this.ruptured && this.peakAtm > 0 && this.pressure === 0) return this.endInflation();
    return null;
  }

  private endInflation(): 'deflated' | null {
    const was = this.peakAtm > 0;
    this.warnedRbp = false;
    return was ? 'deflated' : null;
  }

  /** Clear per-inflation bookkeeping after the caller has recorded it. */
  resetInflation(): void {
    this.inflatedSeconds = 0;
    this.peakAtm = 0;
  }

  /** A fresh catheter of the same size (after a rupture, or to load another stent). */
  exchange(): void {
    this.ruptured = false;
    this.deployed = false;
    this.pressure = 0;
    this.deflating = false;
    this.resetInflation();
  }
}
