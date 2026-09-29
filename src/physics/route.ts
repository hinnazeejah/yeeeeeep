import { Vector3 } from 'three';
import type { Vessel } from '../anatomy/vessel';

/** Part of a device path: travel along `vessel` from u0 to u1 (u1 < u0 means travelling backwards). */
export interface RouteSegment {
  vessel: Vessel;
  u0: number;
  u1: number;
}

/** Converts a point in a vessel's own space (heart-local or world) into world space. */
export type ToWorld = (vessel: Vessel, local: Vector3, out: Vector3) => Vector3;

export function segmentLength(s: RouteSegment): number {
  return Math.abs(s.u1 - s.u0) * s.vessel.length;
}

/**
 * A device path through the vessel tree, measured in mm from its start.
 * Devices are modelled as sliding along this 1D "rail": simple, stable, and easy to learn with.
 */
export class Route {
  constructor(
    public segs: RouteSegment[],
    private readonly toWorld: ToWorld,
  ) {}

  get length(): number {
    let l = 0;
    for (const s of this.segs) l += segmentLength(s);
    return l;
  }

  /** Which segment and vessel position lie `mm` along the route. */
  locate(mm: number): { seg: RouteSegment; index: number; u: number } {
    let rest = Math.max(0, mm);
    for (let i = 0; i < this.segs.length; i++) {
      const seg = this.segs[i];
      const len = segmentLength(seg);
      if (rest <= len || i === this.segs.length - 1) {
        const f = len > 0 ? Math.min(1, rest / len) : 0;
        return { seg, index: i, u: seg.u0 + (seg.u1 - seg.u0) * f };
      }
      rest -= len;
    }
    throw new Error('empty route');
  }

  pointAt(mm: number, out = new Vector3()): Vector3 {
    const { seg, u } = this.locate(mm);
    return this.toWorld(seg.vessel, seg.vessel.pointAt(u, out), out);
  }

  /** World-space points every `step` mm between `from` and `to`. */
  sample(from: number, to: number, step: number): Vector3[] {
    const pts: Vector3[] = [];
    if (to <= from) return pts;
    const n = Math.max(1, Math.ceil((to - from) / step));
    for (let i = 0; i <= n; i++) pts.push(this.pointAt(from + ((to - from) * i) / n));
    return pts;
  }
}
