import {
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { FLUORO, SKELETON } from '../config/anatomy';
import { createBodyMaterial } from '../scene/fluoroMaterials';

/**
 * Bones and diaphragm, shown only in the fluoroscopy view. They are the landmarks a cardiologist
 * uses to orient an X-ray image: the spine in the middle, ribs, and the dense diaphragm/liver
 * shadow below the heart. They stay still while the heart beats, and shift with the C-arm angle.
 */
export function buildFluoroSkeleton(): Group {
  const g = new Group();
  g.name = 'skeleton';

  // Vertebral bodies.
  const s = SKELETON.spine;
  const vertebraMat = createBodyMaterial(FLUORO.mu.bone, s.bodyRadius * 0.75, 0.25);
  const vertebra = new CylinderGeometry(s.bodyRadius, s.bodyRadius, s.bodyHeight, 24);
  for (let y = s.yFrom; y <= s.yTo; y += s.bodyHeight + s.gap) {
    const m = new Mesh(vertebra, vertebraMat);
    m.position.set(s.x, y, s.z);
    g.add(m);
  }

  // Ribs: arcs from the spine around to the front, sloping downwards anteriorly.
  const r = SKELETON.ribs;
  const ribMat = createBodyMaterial(FLUORO.mu.bone, r.tube * 1.1, 0.6);
  for (let i = 0; i < r.count; i++) {
    const y0 = r.topY - i * r.spacing;
    const widen = 0.65 + 0.35 * Math.min(1, i / 4); // upper ribs are shorter
    for (const side of [-1, 1]) {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * Math.PI * 0.85; // 0 = at the spine (back), towards the front
        const x = side * Math.sin(a) * r.radiusX * widen;
        const z = r.centerZ - Math.cos(a) * r.radiusZ * widen;
        const y = y0 - (k / 16) * r.drop;
        pts.push(new Vector3(x, y, z));
      }
      const tube = new TubeGeometry(new CatmullRomCurve3(pts), 48, r.tube, 8, false);
      g.add(new Mesh(tube, ribMat));
    }
  }

  // Diaphragm with the liver beneath: a large soft-tissue dome.
  const d = SKELETON.diaphragm;
  const dome = new Mesh(new SphereGeometry(1, 48, 32), createBodyMaterial(FLUORO.mu.softTissue * 1.4, 170));
  dome.scale.set(...d.radii);
  dome.position.set(...d.center);
  g.add(dome);

  return g;
}
