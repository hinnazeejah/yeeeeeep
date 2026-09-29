import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { HEART, type PathPoint, type SurfacePoint, type LocalPoint } from '../config/anatomy';

const DEG = Math.PI / 180;
const CENTER = new Vector3(...HEART.center);

/** Resting transform from heart-local to world coordinates (the beat is applied on top). */
export const HEART_QUATERNION = new Quaternion().setFromEuler(
  // three.js 'XYZ' order applies Z first, then X: tilt apex left, then forwards.
  new Euler(HEART.rotationDeg.x * DEG, 0, HEART.rotationDeg.z * DEG, 'XYZ'),
);
export const HEART_POSITION = new Vector3(...HEART.position);
export const HEART_MATRIX = new Matrix4().compose(HEART_POSITION, HEART_QUATERNION, new Vector3(1, 1, 1));
const HEART_MATRIX_INV = HEART_MATRIX.clone().invert();

export function heartLocalToWorld(v: Vector3): Vector3 {
  return v.clone().applyMatrix4(HEART_MATRIX);
}
export function worldToHeartLocal(v: Vector3): Vector3 {
  return v.clone().applyMatrix4(HEART_MATRIX_INV);
}
export function heartCenterWorld(): Vector3 {
  return heartLocalToWorld(CENTER);
}

/**
 * Distance from the heart centre to the epicardial (outer) surface along unit direction `d`
 * (heart-local). Used for both the heart mesh and to lay coronaries on the surface, so the
 * arteries always sit exactly on the muscle.
 */
export function heartSurfaceRadius(d: Vector3): number {
  const [rx, ry, rz] = HEART.radii;
  // The apex is narrower than the base.
  const apexW = Math.max(0, -d.y);
  const f = 1 - HEART.apexTaper * apexW * apexW;
  const a = rx * f;
  const c = rz * f;
  let r = 1 / Math.sqrt((d.x / a) ** 2 + (d.y / ry) ** 2 + (d.z / c) ** 2);
  // The base, where the atria and great vessels attach, is flatter.
  if (d.y > 0.6) r *= 1 - HEART.baseFlatten * ((d.y - 0.6) / 0.4) ** 2;
  // Right ventricle bulges forwards on the patient's right.
  const rv = Math.max(0, -d.x) * Math.max(0, d.z) * Math.max(0, 1 - Math.abs(d.y + 0.1) * 1.5);
  r += HEART.rvBulge * rv;
  // Gentle organic irregularity.
  r += 0.8 * Math.sin(d.x * 7 + d.y * 3) * Math.sin(d.z * 6 - d.y * 4);
  return r;
}

/** Unit direction (heart-local, from the centre) for a surface coordinate. */
export function surfaceDirection(p: SurfacePoint): Vector3 {
  const theta = (HEART.grooveTheta + p.t * (180 - HEART.grooveTheta)) * DEG;
  const az = p.az * DEG;
  return new Vector3(Math.sin(theta) * Math.sin(az), Math.cos(theta), Math.sin(theta) * Math.cos(az));
}

/** Heart-local position of a surface point, lifted `offset` mm above the epicardium. */
export function surfacePointToLocal(p: SurfacePoint, offset = 0): Vector3 {
  const d = surfaceDirection(p);
  return d.multiplyScalar(heartSurfaceRadius(d) + offset).add(CENTER);
}

/** If `p` (heart-local) is closer to the centre than the surface + offset, push it out. */
export function pushOutOfHeart(p: Vector3, offset: number): Vector3 {
  const rel = p.clone().sub(CENTER);
  const dist = rel.length();
  if (dist < 1e-6) return p.clone();
  const d = rel.divideScalar(dist);
  const minR = heartSurfaceRadius(d) + offset;
  return dist >= minR ? p.clone() : d.multiplyScalar(minR).add(CENTER);
}

export function isSurfacePoint(p: PathPoint): p is SurfacePoint {
  return !Array.isArray(p) && 'az' in p;
}
export function isLocalPoint(p: PathPoint): p is LocalPoint {
  return !Array.isArray(p) && 'local' in p;
}

/** Resolve a config path point into either heart-local or world space. */
export function resolvePoint(p: PathPoint, space: 'local' | 'world', surfaceOffset: number): Vector3 {
  if (isSurfacePoint(p)) {
    const v = surfacePointToLocal(p, surfaceOffset);
    return space === 'local' ? v : heartLocalToWorld(v);
  }
  if (isLocalPoint(p)) {
    const v = new Vector3(...p.local);
    return space === 'local' ? v : heartLocalToWorld(v);
  }
  const v = new Vector3(...p);
  return space === 'world' ? v : worldToHeartLocal(v);
}

/**
 * Ventricular contraction over one cardiac cycle (0 = relaxed, 1 = end-systole).
 * phase 0 is the R wave on the ECG; contraction follows it.
 */
export function contraction(phase: number, systoleFraction = HEART.pulse.systoleFraction): number {
  const p = ((phase % 1) + 1) % 1;
  if (p >= systoleFraction) return 0;
  return Math.pow(Math.sin((Math.PI * p) / systoleFraction), 1.3);
}
