import { Vector3 } from 'three';
import { DEVICES, LESION } from '../config/anatomy';
import type { Vessel } from '../anatomy/vessel';
import type { VesselTree } from '../anatomy/vesselTree';
import { angleDiff, type Feedback } from './guideCatheter';
import type { RouteSegment } from './route';

const W = DEVICES.wire;
const DEG = 180 / Math.PI;

/**
 * Angle (deg) of a side branch around its parent at the junction, measured in the parent's
 * local frame. The wire tip's rotation uses the same convention, so "tip angle ≈ branch angle"
 * means the tip is pointing into that branch.
 */
export function branchAngle(parent: Vessel, child: Vessel): number {
  const at = child.spec.joins!.at;
  const { t, n, b } = parent.frameAt(at);
  const p0 = parent.pointAt(at);
  const d = child.pointAt(Math.min(1, 4 / child.length)).sub(p0);
  d.addScaledVector(t, -d.dot(t));
  return Math.atan2(d.dot(b), d.dot(n)) * DEG;
}

/**
 * The 0.014" coronary guidewire. It runs inside the guide and out of its tip into the coronary
 * tree. At each bifurcation the shaped tip's direction decides which branch it enters.
 * Pushing it quickly through the tight lesion is "forcing" and raises a hidden dissection risk.
 */
export class Guidewire {
  /** Length beyond the guide tip (mm). 0 = parked inside the guide. */
  out = 0;
  /** Tip rotation (deg), relative to the local vessel frame. */
  rotation = 0;
  /** Coronary path taken so far; the last segment ends at the tip. */
  segs: RouteSegment[] = [];
  /** Smoothed excess push speed while in the lesion (for the resistance meter). */
  force = 0;
  /** Hidden: accumulated probability-like risk of dissection from forcing. */
  dissectionRisk = 0;
  /** Seconds spent forcing the wire. */
  forcingSeconds = 0;
  /** Recently rotated (torque helps cross a tight lesion). */
  private torqueTimer = 0;
  private readonly lesionStart: number;
  private readonly lesionEnd: number;

  constructor(private readonly tree: VesselTree) {
    const lad = tree.get(LESION.vessel)!;
    const c = LESION.centerU * lad.length;
    this.lesionStart = c - LESION.lengthMm / 2;
    this.lesionEnd = c + LESION.lengthMm / 2;
  }

  get tip(): { vessel: Vessel; u: number } | null {
    const s = this.segs[this.segs.length - 1];
    return s && this.out > 0 ? { vessel: s.vessel, u: s.u1 } : null;
  }

  /** Tip distance along the LAD in mm, or -1 when not in the LAD. */
  get ladMm(): number {
    const t = this.tip;
    return t && t.vessel.spec.id === LESION.vessel ? t.u * t.vessel.length : -1;
  }

  get inLesion(): boolean {
    const mm = this.ladMm;
    return mm >= this.lesionStart - 1 && mm <= this.lesionEnd;
  }

  /** Wire tip has crossed the lesion into the distal LAD. */
  get crossed(): boolean {
    return this.ladMm > this.lesionEnd + 3;
  }

  /** Tip is well down the distal LAD (a safe, stable wire position for balloons and stents). */
  get distal(): boolean {
    const t = this.tip;
    return !!t && t.vessel.spec.id === 'lad' && t.u > 0.7;
  }

  rotate(deg: number): void {
    if (deg === 0) return;
    this.rotation = (this.rotation + deg + 360) % 360;
    this.torqueTimer = 0.6;
  }

  /**
   * Push/pull the wire by `mm` over `dt` seconds.
   * @param lmStartU where the guide tip sits in the left main (wire exits here)
   */
  advance(mm: number, dt: number, lmStartU: number): Feedback | null {
    this.torqueTimer = Math.max(0, this.torqueTimer - dt);
    this.force *= Math.exp(-dt * 3);
    if (mm === 0) return null;
    if (this.out <= 0 && mm < 0) return null;

    let feedback: Feedback | null = null;
    if (mm > 0 && this.inLesion && dt > 0) {
      const speed = mm / dt;
      const safe = W.lesionSafeSpeed + (this.torqueTimer > 0 ? 3 : 0);
      if (speed > safe) {
        const excess = speed - safe;
        this.force = Math.max(this.force, excess);
        this.dissectionRisk += excess * dt * W.riskPerExcess;
        this.forcingSeconds += dt;
        mm = safe * 0.3 * dt; // the tip buckles instead of advancing
        feedback = { text: 'Resistance! The wire is buckling. Advance gently (hold Shift) and torque the tip.', level: 'danger' };
      } else {
        mm *= 0.8;
      }
    }

    // Move in ≤ 0.5 mm steps so every bifurcation is noticed.
    let remaining = mm;
    while (Math.abs(remaining) > 1e-6) {
      const step = Math.sign(remaining) * Math.min(0.5, Math.abs(remaining));
      remaining -= step;
      const f = step > 0 ? this.stepForward(step, lmStartU) : this.stepBack(-step);
      if (f) {
        feedback = f;
        break;
      }
    }
    return feedback;
  }

  private stepForward(mm: number, lmStartU: number): Feedback | null {
    if (this.out <= 0 || this.segs.length === 0) {
      const lm = this.tree.get('lm')!;
      this.segs = [{ vessel: lm, u0: lmStartU, u1: lmStartU }];
      this.out = 0;
    }
    const seg = this.segs[this.segs.length - 1];
    const v = seg.vessel;
    const u = seg.u1;
    const nu = u + mm / v.length;

    // Side branches between u and nu (not at the very end of the vessel).
    for (const c of v.children) {
      const at = c.spec.joins!.at;
      if (at > u && at <= nu && at < 0.999) {
        if (Math.abs(angleDiff(this.rotation, branchAngle(v, c))) <= W.branchCaptureDeg) {
          seg.u1 = at;
          this.segs.push({ vessel: c, u0: 0, u1: (nu - at) * (v.length / c.length) });
          this.out += mm;
          return { text: `The wire tip entered ${c.spec.name}.`, level: 'info' };
        }
      }
    }

    if (nu >= 1) {
      // End of this vessel: either a terminal bifurcation (LM → LAD/LCx) or the distal tip.
      const ends = v.children.filter((c) => c.spec.joins!.at >= 0.999);
      if (ends.length > 0) {
        let best = ends[0];
        let bestErr = Infinity;
        for (const c of ends) {
          const e = Math.abs(angleDiff(this.rotation, branchAngle(v, c)));
          if (e < bestErr) {
            bestErr = e;
            best = c;
          }
        }
        seg.u1 = 1;
        this.segs.push({ vessel: best, u0: 0, u1: ((nu - 1) * v.length) / best.length });
        this.out += mm;
        return { text: `The wire tip entered ${best.spec.name}.`, level: 'info' };
      }
      seg.u1 = 1;
      return { text: 'The wire tip is at the end of the vessel. Do not push further (perforation risk).', level: 'warn' };
    }
    seg.u1 = nu;
    this.out += mm;
    return null;
  }

  private stepBack(mm: number): Feedback | null {
    const seg = this.segs[this.segs.length - 1];
    if (!seg) return null;
    const v = seg.vessel;
    const nu = seg.u1 - mm / v.length;
    this.out = Math.max(0, this.out - mm);
    if (nu <= seg.u0) {
      if (this.segs.length > 1) {
        this.segs.pop();
        return null;
      }
      this.out = 0;
      this.segs = [];
      return { text: 'The wire is back inside the guide catheter.', level: 'info' };
    }
    seg.u1 = nu;
    return null;
  }

  /** The next bifurcation within `lookahead` mm of the tip, and whether the tip points into it. */
  upcomingBranch(lookahead = 12): { name: string; pointing: boolean; mm: number } | null {
    const t = this.tip;
    if (!t) return null;
    const v = t.vessel;
    for (const c of v.children) {
      const at = c.spec.joins!.at;
      const dist = (at - t.u) * v.length;
      if (dist > 0 && dist <= lookahead) {
        if (at >= 0.999) {
          // Terminal split: report which branch the tip will choose.
          const ends = v.children.filter((x) => x.spec.joins!.at >= 0.999);
          let best = ends[0];
          for (const e of ends)
            if (Math.abs(angleDiff(this.rotation, branchAngle(v, e))) < Math.abs(angleDiff(this.rotation, branchAngle(v, best))))
              best = e;
          return { name: best.spec.name, pointing: true, mm: dist };
        }
        const pointing = Math.abs(angleDiff(this.rotation, branchAngle(v, c))) <= W.branchCaptureDeg;
        return { name: c.spec.name, pointing, mm: dist };
      }
    }
    return null;
  }

  /** Unit direction of the shaped tip (in the tip vessel's own space). */
  tipBendDirection(out = new Vector3()): Vector3 {
    const t = this.tip;
    if (!t) return out.set(0, 0, 0);
    const { n, b } = t.vessel.frameAt(t.u);
    const a = this.rotation / DEG;
    return out.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
  }

  location(): string {
    const t = this.tip;
    if (!t) return 'Inside guide catheter';
    const id = t.vessel.spec.id;
    if (id === 'lad') {
      const mm = t.u * t.vessel.length;
      if (mm < this.lesionStart - 1) return 'Proximal LAD';
      if (mm <= this.lesionEnd) return 'Mid LAD: IN THE LESION';
      if (t.u < 0.7) return 'Mid LAD (past the lesion)';
      return 'Distal LAD';
    }
    return t.vessel.spec.name;
  }
}
