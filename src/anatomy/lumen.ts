/**
 * Pure functions describing the inside diameter (lumen) of a vessel along its length.
 * No Three.js here, so they are easy to unit test.
 */

/**
 * A narrowing caused by atherosclerotic plaque.
 * severity is the *diameter* stenosis used in angiography reports:
 * 0.9 ("90%") means the narrowest point is 10% of the normal (reference) diameter.
 */
export interface Stenosis {
  centerMm: number;
  lengthMm: number;
  severity: number;
}

/**
 * Radius multiplier (0..1) produced by a stenosis at a given distance along the vessel.
 * The plaque has a short plateau at its tightest point and tapers smoothly at both ends.
 */
export function stenosisFactor(mm: number, s: Stenosis): number {
  const half = s.lengthMm / 2;
  const d = Math.abs(mm - s.centerMm);
  if (d >= half) return 1;
  const plateau = half * 0.3;
  if (d <= plateau) return 1 - s.severity;
  const t = (d - plateau) / (half - plateau);
  const k = 0.5 * (1 + Math.cos(Math.PI * t));
  return 1 - s.severity * k;
}

/** Piecewise-linear interpolation of radius between control knots (u = 0..1). */
export function taperRadius(u: number, knots: { u: number; r: number }[]): number {
  if (knots.length === 0) return 1;
  if (u <= knots[0].u) return knots[0].r;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    if (u <= b.u) {
      const t = (u - a.u) / Math.max(1e-6, b.u - a.u);
      return a.r + (b.r - a.r) * t;
    }
  }
  return knots[knots.length - 1].r;
}

/** Percent diameter stenosis (0..1) given the minimal lumen diameter and the reference diameter. */
export function diameterStenosis(minDiameter: number, referenceDiameter: number): number {
  if (referenceDiameter <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - minDiameter / referenceDiameter));
}

/**
 * A segment where a device holds the lumen open (inflated balloon, balloon result, stent).
 * The lumen radius there is at least `radius`, with short tapers at both ends.
 */
export interface Expansion {
  startMm: number;
  endMm: number;
  radius: number;
}

/** 0..1 weight of an expansion at `mm`: 1 inside, smooth falloff over `edgeMm` outside the ends. */
export function expansionWeight(mm: number, e: Expansion, edgeMm = 1.2): number {
  if (mm >= e.startMm && mm <= e.endMm) return 1;
  const d = mm < e.startMm ? e.startMm - mm : mm - e.endMm;
  if (d >= edgeMm) return 0;
  const t = d / edgeMm;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Apply expansions to a diseased radius: each one pushes the lumen out to its radius. */
export function expandedRadius(mm: number, diseased: number, expansions: Expansion[]): number {
  let r = diseased;
  for (const e of expansions) {
    const w = expansionWeight(mm, e);
    if (w > 0) r = Math.max(r, diseased + (e.radius - diseased) * w);
  }
  return r;
}
