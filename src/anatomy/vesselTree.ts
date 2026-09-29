import { CatmullRomCurve3, Vector3 } from 'three';
import { LESION, VESSELS, type VesselId, type VesselSpec } from '../config/anatomy';
import { pushOutOfHeart, resolvePoint, heartLocalToWorld, worldToHeartLocal } from './heartShape';
import { Vessel } from './vessel';

export type VesselTree = Map<VesselId, Vessel>;

/** How high a coronary sits above the muscle, as a fraction of its radius (it lies in epicardial fat). */
const SURFACE_LIFT = 0.8;

/** Build every vessel from the config. Parents are built before their branches. */
export function buildVesselTree(): VesselTree {
  const tree: VesselTree = new Map();
  for (const spec of VESSELS) tree.set(spec.id, buildVessel(spec, tree));

  // Add the target lesion.
  const lad = tree.get(LESION.vessel)!;
  lad.stenoses.push({
    centerMm: LESION.centerU * lad.length,
    lengthMm: LESION.lengthMm,
    severity: LESION.severity,
  });
  lad.updateGeometry();

  computeTreeDistances(tree);
  return tree;
}

function buildVessel(spec: VesselSpec, tree: VesselTree): Vessel {
  const space = spec.onHeart ? 'local' : 'world';
  const r0 = spec.radii[0];
  const pts = spec.points.map((p) => resolvePoint(p, space, r0 * SURFACE_LIFT));

  if (spec.startAtParent && spec.joins) {
    const parent = tree.get(spec.joins.vessel);
    if (!parent) throw new Error(`Vessel ${spec.id}: parent ${spec.joins.vessel} not built yet`);
    const p = parent.pointAt(spec.joins.at);
    const inSpace =
      parent.spec.onHeart === spec.onHeart ? p : spec.onHeart ? worldToHeartLocal(p) : heartLocalToWorld(p);
    pts.unshift(inSpace);
  }

  let curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const knots = radiusKnots(curve, spec);

  if (spec.onHeart) {
    // Resample densely and make sure no part of the artery dips inside the heart muscle.
    const n = Math.max(12, Math.ceil(curve.getLength() / 3));
    const dense: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const r = interpKnots(u, knots);
      dense.push(pushOutOfHeart(curve.getPointAt(u), r * SURFACE_LIFT));
    }
    curve = new CatmullRomCurve3(dense, false, 'centripetal');
  }
  return new Vessel(spec, curve, knots);
}

/** Map config radii to arc-length positions along the curve. */
function radiusKnots(curve: CatmullRomCurve3, spec: VesselSpec): { u: number; r: number }[] {
  const r = spec.radii;
  if (r.length === 2 || r.length !== spec.points.length) {
    return [
      { u: 0, r: r[0] },
      { u: 1, r: r[r.length - 1] },
    ];
  }
  // One radius per control point: find each point's arc-length fraction.
  const n = curve.points.length;
  const offset = n - r.length; // a prepended parent point has no radius of its own
  const divisions = 400;
  const lengths = curve.getLengths(divisions);
  const total = lengths[divisions];
  return r.map((radius, i) => {
    const t = (i + offset) / (n - 1);
    return { u: lengths[Math.round(t * divisions)] / total, r: radius };
  });
}

function interpKnots(u: number, knots: { u: number; r: number }[]): number {
  for (let i = 1; i < knots.length; i++) {
    if (u <= knots[i].u) {
      const a = knots[i - 1];
      const b = knots[i];
      return a.r + ((b.r - a.r) * (u - a.u)) / Math.max(1e-6, b.u - a.u);
    }
  }
  return knots[knots.length - 1].r;
}

/** Distance of each vessel's start from its coronary ostium, walking up the tree. */
function computeTreeDistances(tree: VesselTree): void {
  for (const v of tree.values()) {
    const j = v.spec.joins;
    if (!j || !v.spec.onHeart) continue;
    const parent = tree.get(j.vessel)!;
    v.startMm = parent.spec.onHeart ? parent.startMm + j.at * parent.length : 0;
  }
}
