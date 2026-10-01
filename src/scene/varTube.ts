import { BufferAttribute, BufferGeometry, Mesh, Vector3, type Material } from 'three';

export interface RingSpec {
  /** Tube radius at this ring (mm). */
  r: number;
  /** X-ray attenuation at this ring. */
  mu: number;
}

/**
 * A tube with a per-ring radius, redrawn along a polyline. Used for balloons (which change shape
 * as they inflate), stents and dissection staining. Coordinates are in whatever space the parent
 * group uses (heart-local for coronary devices, so they beat with the heart).
 * uv.x runs along the tube in mm, uv.y around it (0..1), for stent strut textures.
 */
export class VarTube {
  readonly geometry = new BufferGeometry();
  readonly mesh3d: Mesh;
  readonly meshFluoro: Mesh;
  private readonly cols: number;

  constructor(
    private readonly maxRings: number,
    private readonly radial: number,
    material3d: Material,
    materialFluoro: Material,
  ) {
    this.cols = radial + 1;
    const n = maxRings * this.cols;
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    this.geometry.setAttribute('aMu', new BufferAttribute(new Float32Array(n), 1));
    this.geometry.setAttribute('aR', new BufferAttribute(new Float32Array(n), 1));
    const idx: number[] = [];
    for (let i = 0; i < maxRings - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * this.cols + j;
        const b = (i + 1) * this.cols + j;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    this.geometry.setIndex(idx);
    this.geometry.setDrawRange(0, 0);
    this.mesh3d = new Mesh(this.geometry, material3d);
    this.meshFluoro = new Mesh(this.geometry, materialFluoro);
    for (const m of [this.mesh3d, this.meshFluoro]) {
      m.frustumCulled = false;
      m.visible = false;
    }
  }

  hide(): void {
    this.mesh3d.visible = false;
    this.meshFluoro.visible = false;
  }

  /**
   * @param points centreline, proximal → distal
   * @param ring radius and attenuation for ring i at `mm` from the proximal end
   */
  setPath(points: Vector3[], ring: (i: number, mm: number) => RingSpec): void {
    const pts: Vector3[] = [];
    for (const p of points) if (pts.length === 0 || p.distanceToSquared(pts[pts.length - 1]) > 1e-4) pts.push(p);
    if (pts.length > this.maxRings) pts.length = this.maxRings;
    if (pts.length < 2) {
      this.hide();
      return;
    }
    this.mesh3d.visible = true;
    this.meshFluoro.visible = true;

    const pos = this.geometry.getAttribute('position') as BufferAttribute;
    const nor = this.geometry.getAttribute('normal') as BufferAttribute;
    const uv = this.geometry.getAttribute('uv') as BufferAttribute;
    const mu = this.geometry.getAttribute('aMu') as BufferAttribute;
    const ar = this.geometry.getAttribute('aR') as BufferAttribute;

    const t = new Vector3();
    const n = new Vector3();
    const b = new Vector3();
    const prevT = new Vector3();
    const axis = new Vector3();
    let mm = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) mm += pts[i].distanceTo(pts[i - 1]);
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(c, a).normalize();
      if (i === 0) {
        n.set(0, 1, 0);
        if (Math.abs(n.dot(t)) > 0.9) n.set(1, 0, 0);
        n.addScaledVector(t, -n.dot(t)).normalize();
      } else {
        axis.crossVectors(prevT, t);
        const s = axis.length();
        if (s > 1e-6) n.applyAxisAngle(axis.divideScalar(s), Math.asin(Math.min(1, s)));
        n.addScaledVector(t, -n.dot(t)).normalize();
      }
      b.crossVectors(t, n);
      prevT.copy(t);
      const spec = ring(i, mm);
      for (let j = 0; j <= this.radial; j++) {
        const v = (j / this.radial) * Math.PI * 2;
        const cx = Math.cos(v);
        const sx = Math.sin(v);
        const nx = n.x * cx + b.x * sx;
        const ny = n.y * cx + b.y * sx;
        const nz = n.z * cx + b.z * sx;
        const k = i * this.cols + j;
        nor.setXYZ(k, nx, ny, nz);
        pos.setXYZ(k, pts[i].x + nx * spec.r, pts[i].y + ny * spec.r, pts[i].z + nz * spec.r);
        uv.setXY(k, mm, j / this.radial);
        mu.setX(k, spec.mu);
        ar.setX(k, spec.r);
      }
    }
    for (const a of [pos, nor, uv, mu, ar]) a.needsUpdate = true;
    this.geometry.setDrawRange(0, (pts.length - 1) * this.radial * 6);
  }
}
