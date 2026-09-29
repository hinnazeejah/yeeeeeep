import { CONTRAST } from '../config/anatomy';
import type { VesselTree } from '../anatomy/vesselTree';

/**
 * Contrast transit model.
 *
 * Each point in a coronary gets an "arrival time": how long after the start of an injection the
 * dye front reaches it. The shader colours a point dark when
 *   tail < arrival time < front
 * where `front` is time since injection began and `tail` trails behind once injection stops
 * (fresh unopacified blood washes the dye out, proximal segments first).
 *
 * In M1 the speed is uniform; later milestones slow the flow beyond a tight lesion.
 */
export function computeTransitTimes(tree: VesselTree, speedMmPerS = CONTRAST.speedMmPerS): void {
  for (const v of tree.values()) {
    if (v.spec.onHeart) {
      const j = v.spec.joins;
      const parent = j ? tree.get(j.vessel) : undefined;
      v.startTransit = parent && parent.spec.onHeart ? sampleTransit(parent.transit, j!.at) : 0;
    } else {
      v.startTransit = 0;
    }
    const ds = v.length / v.segments;
    let t = v.startTransit;
    v.transit[0] = t;
    for (let i = 1; i <= v.segments; i++) {
      t += ds / speedMmPerS;
      v.transit[i] = t;
    }
    v.updateTransitAttribute();
  }
}

function sampleTransit(arr: Float32Array, u: number): number {
  const f = u * (arr.length - 1);
  const i = Math.min(arr.length - 2, Math.floor(f));
  const k = f - i;
  return arr[i] * (1 - k) + arr[i + 1] * k;
}

/** One contrast injection: tracks the dye front, washout tail and overall density. */
export class ContrastBolus {
  active = false;
  /** Seconds since injection began. */
  elapsed = 0;
  injectSeconds: number = CONTRAST.injectSeconds;

  start(injectSeconds: number = CONTRAST.injectSeconds): void {
    this.active = true;
    this.elapsed = 0;
    this.injectSeconds = injectSeconds;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    // Done once the tail has passed the most distal points (generous upper bound).
    if (this.tail > 6) this.active = false;
  }

  /** Arrival-time threshold of the dye front. */
  get front(): number {
    return this.active ? this.elapsed : -1;
  }

  /** Arrival-time threshold of the washout (points with arrival < tail are clear again). */
  get tail(): number {
    return this.elapsed - this.injectSeconds;
  }

  /** Overall dye density 0..1 (ramps up at the start of the injection). */
  get density(): number {
    if (!this.active) return 0;
    return Math.min(1, this.elapsed / CONTRAST.rampSeconds);
  }
}
