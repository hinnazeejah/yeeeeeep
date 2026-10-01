import { CONTRAST, FLOW } from '../config/anatomy';
import type { VesselTree } from '../anatomy/vesselTree';
import { flowFactor } from '../procedure/evaluation';

/** Arrival time used for segments that contrast never reaches (occluded). */
export const NO_FLOW_TIME = 1e4;

/**
 * Contrast transit model.
 *
 * Each point in a coronary gets an "arrival time": how long after the start of an injection the
 * dye front reaches it. The shader colours a point dark when
 *   tail < arrival time < front
 * where `front` is time since injection began and `tail` trails behind once injection stops
 * (fresh unopacified blood washes the dye out, proximal segments first).
 *
 * Flow is limited by the tightest narrowing upstream of each point: beyond a severe stenosis the
 * dye front crawls (TIMI 1–2), after good stenting it is brisk again (TIMI 3). An inflated balloon
 * stops flow completely, and an unsealed dissection slows everything downstream.
 *
 * Returns the latest finite arrival time (s), so a cine run knows how long to keep recording.
 */
export function computeTransitTimes(tree: VesselTree, speedMmPerS = CONTRAST.speedMmPerS): number {
  let latest = 0;
  // VESSELS is ordered parents-first, so a branch always sees its parent's finished arrays.
  for (const v of tree.values()) {
    let startFlow = 1;
    if (v.spec.onHeart) {
      const j = v.spec.joins;
      const parent = j ? tree.get(j.vessel) : undefined;
      if (parent && parent.spec.onHeart) {
        v.startTransit = sampleArray(parent.transit, j!.at);
        startFlow = sampleArray(parent.flow, j!.at);
      } else {
        v.startTransit = 0;
      }
    } else {
      v.startTransit = 0;
    }

    const ds = v.length / v.segments;
    let t = v.startTransit;
    let worst = 0;
    for (let i = 0; i <= v.segments; i++) {
      const u = i / v.segments;
      const mm = u * v.length;
      let f = startFlow;
      if (v.spec.onHeart) {
        const ref = v.referenceRadiusAt(u);
        worst = Math.max(worst, 1 - v.radiusAt(u) / ref);
        f = Math.min(f, flowFactor(worst));
        if (v.occludedFromMm !== null && mm >= v.occludedFromMm) f = 0;
        if (v.dissection && !v.dissection.sealed && mm >= v.dissection.mm - 2) f *= FLOW.dissectionPenalty;
      }
      v.flow[i] = f;
      if (i > 0) t = t >= NO_FLOW_TIME || f <= 0 ? NO_FLOW_TIME : t + ds / (speedMmPerS * Math.max(0.02, f));
      v.transit[i] = t;
      if (t < NO_FLOW_TIME && v.spec.system === 'left') latest = Math.max(latest, t);
    }
    v.updateTransitAttribute();
  }
  return latest;
}

export function sampleArray(arr: Float32Array, u: number): number {
  const f = Math.min(1, Math.max(0, u)) * (arr.length - 1);
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
  /** Latest arrival time in the filled tree; recording continues until it has washed out. */
  maxTransit = 2;

  start(injectSeconds: number = CONTRAST.injectSeconds, maxTransit = this.maxTransit): void {
    this.active = true;
    this.elapsed = 0;
    this.injectSeconds = injectSeconds;
    this.maxTransit = maxTransit;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    // Done once the tail has passed the most distal filled points (capped for very slow flow).
    if (this.tail > Math.min(12, this.maxTransit) + 0.5) this.active = false;
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
