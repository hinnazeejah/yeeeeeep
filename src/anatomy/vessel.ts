import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from 'three';
import type { VesselSpec } from '../config/anatomy';
import { stenosisFactor, taperRadius, type Stenosis } from './lumen';

const MIN_VISUAL_RADIUS = 0.3;

/**
 * One blood vessel: a centreline spline plus a lumen radius profile.
 * The tube geometry is rebuilt in place whenever the lumen changes (balloon, stent, dissection).
 *
 * Coordinates are heart-local for coronaries (so they beat with the heart) and world otherwise.
 */
export class Vessel {
  readonly spec: VesselSpec;
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  readonly segments: number;
  readonly radialSegments: number;
  readonly geometry: BufferGeometry;

  /** Distance of this vessel's start from the coronary ostium along the tree (mm). */
  startMm = 0;
  /** Contrast arrival time at this vessel's start (s after injection begins). */
  startTransit = 0;
  /** Contrast arrival time at each ring (s), filled by the flow model. */
  readonly transit: Float32Array;

  readonly stenoses: Stenosis[] = [];
  /** Coronary branches that leave this vessel (filled in by the tree builder). */
  readonly children: Vessel[] = [];
  private readonly knots: { u: number; r: number }[];
  private readonly frames: { tangents: Vector3[]; normals: Vector3[]; binormals: Vector3[] };
  private readonly centers: Vector3[] = [];

  constructor(spec: VesselSpec, curve: CatmullRomCurve3, knots: { u: number; r: number }[]) {
    this.spec = spec;
    this.curve = curve;
    this.knots = knots;
    this.length = curve.getLength();
    const maxR = Math.max(...knots.map((k) => k.r));
    // Roughly one ring per mm for small vessels, coarser for the big ones.
    this.segments = Math.max(24, Math.ceil(this.length / (maxR > 5 ? 3 : 0.8)));
    this.radialSegments = maxR > 5 ? 28 : 14;
    this.frames = curve.computeFrenetFrames(this.segments, false);
    for (let i = 0; i <= this.segments; i++) this.centers.push(curve.getPointAt(i / this.segments));
    this.transit = new Float32Array(this.segments + 1);
    this.geometry = this.createGeometry();
  }

  /** Reference (healthy) radius at u, ignoring disease. */
  referenceRadiusAt(u: number): number {
    return taperRadius(u, this.knots);
  }

  /** Actual lumen radius at u including stenoses and any later treatment. */
  radiusAt(u: number): number {
    const mm = u * this.length;
    let f = 1;
    for (const s of this.stenoses) f *= stenosisFactor(mm, s);
    return this.referenceRadiusAt(u) * f;
  }

  pointAt(u: number, out = new Vector3()): Vector3 {
    return out.copy(this.curve.getPointAt(Math.min(1, Math.max(0, u))));
  }

  /** Local tangent / normal / binormal at u (nearest ring). Used to measure branch and tip angles. */
  frameAt(u: number): { t: Vector3; n: Vector3; b: Vector3 } {
    const i = Math.round(Math.min(1, Math.max(0, u)) * this.segments);
    return { t: this.frames.tangents[i], n: this.frames.normals[i], b: this.frames.binormals[i] };
  }

  private createGeometry(): BufferGeometry {
    const rings = this.segments + 1;
    const cols = this.radialSegments + 1;
    const n = rings * cols;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aU', new BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aR', new BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aT', new BufferAttribute(new Float32Array(n), 1));
    const idx: number[] = [];
    for (let i = 0; i < this.segments; i++) {
      for (let j = 0; j < this.radialSegments; j++) {
        const a = i * cols + j;
        const b = (i + 1) * cols + j;
        // Counter-clockwise seen from outside, so the outer wall is the front face.
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    g.setIndex(idx);
    this.updateGeometry(g);
    return g;
  }

  /** Recompute ring radii (call after the lumen changes). */
  updateGeometry(g: BufferGeometry = this.geometry): void {
    const pos = g.getAttribute('position') as BufferAttribute;
    const nor = g.getAttribute('normal') as BufferAttribute;
    const au = g.getAttribute('aU') as BufferAttribute;
    const ar = g.getAttribute('aR') as BufferAttribute;
    const cols = this.radialSegments + 1;
    const tmp = new Vector3();
    for (let i = 0; i <= this.segments; i++) {
      const u = i / this.segments;
      // Never draw thinner than MIN_VISUAL_RADIUS so a critical lesion stays visible on screen.
      // (Measurements always use the true radiusAt value.)
      const r = Math.max(MIN_VISUAL_RADIUS, this.radiusAt(u));
      const c = this.centers[i];
      const N = this.frames.normals[i];
      const B = this.frames.binormals[i];
      for (let j = 0; j <= this.radialSegments; j++) {
        const v = (j / this.radialSegments) * Math.PI * 2;
        tmp.copy(N).multiplyScalar(Math.cos(v)).addScaledVector(B, Math.sin(v));
        const k = i * cols + j;
        nor.setXYZ(k, tmp.x, tmp.y, tmp.z);
        pos.setXYZ(k, c.x + tmp.x * r, c.y + tmp.y * r, c.z + tmp.z * r);
        au.setX(k, u);
        ar.setX(k, r);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    au.needsUpdate = true;
    ar.needsUpdate = true;
    g.computeBoundingSphere();
  }

  /** Push the per-ring transit times into the geometry for the contrast shader. */
  updateTransitAttribute(): void {
    const at = this.geometry.getAttribute('aT') as BufferAttribute;
    const cols = this.radialSegments + 1;
    for (let i = 0; i <= this.segments; i++) {
      for (let j = 0; j < cols; j++) at.setX(i * cols + j, this.transit[i]);
    }
    at.needsUpdate = true;
  }
}
