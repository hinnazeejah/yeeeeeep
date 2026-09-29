import { BufferAttribute, BufferGeometry, Mesh, Vector3, type Material } from 'three';
import { createDeviceFluoroMaterial } from './fluoroMaterials';

/**
 * A flexible tube (catheter, wire) redrawn every frame along a polyline in world space.
 * Buffers are allocated once; only positions change, so it is cheap to update.
 */
export class DeviceTube {
  readonly geometry = new BufferGeometry();
  readonly mesh3d: Mesh;
  readonly meshFluoro: Mesh;
  private readonly cols: number;

  constructor(
    private readonly maxRings: number,
    private readonly radial: number,
    private readonly radius: number,
    material3d: Material,
    fluoroRadius = radius,
  ) {
    this.cols = radial + 1;
    const n = maxRings * this.cols;
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aMu', new BufferAttribute(new Float32Array(n), 1));
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
    this.meshFluoro = new Mesh(this.geometry, createDeviceFluoroMaterial(fluoroRadius));
    for (const m of [this.mesh3d, this.meshFluoro]) {
      m.frustumCulled = false;
      m.visible = false;
    }
  }

  /**
   * @param points world-space centreline, proximal → distal
   * @param muAt attenuation for fluoro as a function of distance from the distal tip (mm)
   */
  setPath(points: Vector3[], muAt: (fromTipMm: number) => number): void {
    // Drop near-duplicate points (segment joins) so tangents stay well defined.
    const pts: Vector3[] = [];
    for (const p of points) if (pts.length === 0 || p.distanceToSquared(pts[pts.length - 1]) > 0.01) pts.push(p);
    if (pts.length > this.maxRings) pts.splice(0, pts.length - this.maxRings);
    const visible = pts.length >= 2;
    this.mesh3d.visible = visible;
    this.meshFluoro.visible = visible;
    if (!visible) return;

    const pos = this.geometry.getAttribute('position') as BufferAttribute;
    const nor = this.geometry.getAttribute('normal') as BufferAttribute;
    const mu = this.geometry.getAttribute('aMu') as BufferAttribute;

    // Distance from the tip for each ring.
    const fromTip = new Float32Array(pts.length);
    for (let i = pts.length - 2; i >= 0; i--) fromTip[i] = fromTip[i + 1] + pts[i].distanceTo(pts[i + 1]);

    // Parallel-transport frames: no sudden twisting as the tube bends.
    const t = new Vector3();
    const n = new Vector3();
    const b = new Vector3();
    const prevT = new Vector3();
    const dir = new Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(c, a).normalize();
      if (i === 0) {
        n.set(0, 1, 0);
        if (Math.abs(n.dot(t)) > 0.9) n.set(1, 0, 0);
        n.addScaledVector(t, -n.dot(t)).normalize();
      } else {
        // Rotate the previous normal by the change in tangent.
        const axis = dir.crossVectors(prevT, t);
        const s = axis.length();
        if (s > 1e-6) n.applyAxisAngle(axis.divideScalar(s), Math.asin(Math.min(1, s)));
        n.addScaledVector(t, -n.dot(t)).normalize();
      }
      b.crossVectors(t, n);
      prevT.copy(t);
      const m = muAt(fromTip[i]);
      for (let j = 0; j <= this.radial; j++) {
        const v = (j / this.radial) * Math.PI * 2;
        const cx = Math.cos(v);
        const sx = Math.sin(v);
        const nx = n.x * cx + b.x * sx;
        const ny = n.y * cx + b.y * sx;
        const nz = n.z * cx + b.z * sx;
        const k = i * this.cols + j;
        nor.setXYZ(k, nx, ny, nz);
        pos.setXYZ(k, pts[i].x + nx * this.radius, pts[i].y + ny * this.radius, pts[i].z + nz * this.radius);
        mu.setX(k, m);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    mu.needsUpdate = true;
    this.geometry.setDrawRange(0, (pts.length - 1) * this.radial * 6);
    this.geometry.computeBoundingSphere(); // keeps hover picking accurate
  }
}
