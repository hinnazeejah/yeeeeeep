import {
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type Scene,
  type ShaderMaterial,
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CONTRAST, FLUORO, HEART, LABELS, LESION, type CoronarySystem, type VesselId } from '../config/anatomy';
import { createBodyMaterial, createVesselFluoroMaterial } from '../scene/fluoroMaterials';
import { buildHeartGeometry } from './heart';
import { contraction, HEART_POSITION, HEART_QUATERNION } from './heartShape';
import { buildFluoroSkeleton } from './skeleton';
import { buildVesselTree, type VesselTree } from './vesselTree';
import { computeTransitTimes, type ContrastBolus } from '../physics/flow';

/** A heart "rig": `frame` holds the resting pose, `pulse` scales with each heartbeat. */
interface HeartRig {
  frame: Group;
  pulse: Group;
}

function createRig(): HeartRig {
  const frame = new Group();
  frame.position.copy(HEART_POSITION);
  frame.quaternion.copy(HEART_QUATERNION);
  const pulse = new Group();
  frame.add(pulse);
  return { frame, pulse };
}

/**
 * Everything anatomical, built once and added to both scenes:
 *   scene3d     - lit, coloured anatomy for the 3D view
 *   sceneFluoro - X-ray attenuation materials for the fluoroscopy view
 * Both share the same geometry, so a change to a vessel lumen shows in both views.
 */
export class AnatomyModel {
  readonly vessels: VesselTree;
  readonly rig3d = createRig();
  readonly rigFluoro = createRig();
  readonly labels = new Group();
  private readonly fluoroVesselMats = new Map<VesselId, ShaderMaterial>();
  /** Which coronary system the current injection fills. */
  injectedSystem: CoronarySystem = 'left';
  private labelsVisible = true;

  constructor(scene3d: Scene, sceneFluoro: Scene) {
    this.vessels = buildVesselTree();
    computeTransitTimes(this.vessels);

    scene3d.add(this.rig3d.frame);
    scene3d.add(this.labels);
    sceneFluoro.add(this.rigFluoro.frame);

    // Heart.
    const heartGeo = buildHeartGeometry();
    const heart3d = new Mesh(
      heartGeo,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0 }),
    );
    heart3d.name = 'heart';
    this.rig3d.pulse.add(heart3d);
    const heartSize = HEART.radii[0] + HEART.radii[2];
    this.rigFluoro.pulse.add(new Mesh(heartGeo, createBodyMaterial(FLUORO.mu.softTissue * 2.0, heartSize)));

    // Vessels.
    for (const v of this.vessels.values()) {
      const coronary = v.spec.onHeart;
      const mat3d = new MeshStandardMaterial({
        color: coronary ? 0xc4221c : 0xc8504a,
        emissive: coronary ? 0x2a0403 : 0x1a0404,
        roughness: 0.6,
        metalness: 0.05,
        transparent: true,
        opacity: coronary ? 0.9 : 0.35,
        depthWrite: coronary,
        side: coronary ? FrontSide : DoubleSide,
      });
      const m3d = new Mesh(v.geometry, mat3d);
      m3d.name = v.spec.id;
      m3d.renderOrder = coronary ? 1 : 2;
      const fmat = createVesselFluoroMaterial(v.spec.id === 'access' ? 0 : 1);
      this.fluoroVesselMats.set(v.spec.id, fmat);
      const mF = new Mesh(v.geometry, fmat);
      if (coronary) {
        this.rig3d.pulse.add(m3d);
        this.rigFluoro.pulse.add(mF);
      } else {
        scene3d.add(m3d);
        sceneFluoro.add(mF);
      }
    }

    // Close the aortic root (the aortic valve sits here).
    const aorta = this.vessels.get('aorta')!;
    const rootR = aorta.radiusAt(0);
    const cap = new Mesh(
      new SphereGeometry(rootR, 24, 16),
      new MeshStandardMaterial({ color: 0xc8504a, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    cap.position.copy(aorta.pointAt(0));
    scene3d.add(cap);

    // Bones only matter on X-ray.
    sceneFluoro.add(buildFluoroSkeleton());

    this.buildLabels();
  }

  private buildLabels(): void {
    for (const l of LABELS) this.addLabel(l.vessel, l.u, l.text, 'label');
    this.addLabel(LESION.vessel, LESION.centerU, `${Math.round(LESION.severity * 100)}% stenosis`, 'label lesion');
  }

  private addLabel(id: VesselId, u: number, text: string, cls: string): void {
    const v = this.vessels.get(id)!;
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    el.title = v.spec.description;
    const obj = new CSS2DObject(el);
    obj.position.copy(v.pointAt(u));
    (v.spec.onHeart ? this.rig3d.pulse : this.labels).add(obj);
  }

  /** Apply the heartbeat. phase 0..1 over one cardiac cycle (0 = R wave). */
  updateBeat(phase: number): void {
    const c = contraction(phase);
    const r = 1 - HEART.pulse.radial * c;
    const l = 1 - HEART.pulse.longitudinal * c;
    this.rig3d.pulse.scale.set(r, l, r);
    this.rigFluoro.pulse.scale.set(r, l, r);
  }

  /** Feed the current contrast bolus into the fluoro vessel shaders. */
  updateContrast(bolus: ContrastBolus): void {
    for (const [id, mat] of this.fluoroVesselMats) {
      const v = this.vessels.get(id)!;
      const u = mat.uniforms;
      u.uFront.value = bolus.front;
      u.uTail.value = bolus.tail;
      let gain = 0;
      if (v.spec.system === this.injectedSystem) gain = 1;
      if (id === 'aorta') {
        // Some dye refluxes back into the aortic root during a selective injection.
        gain = CONTRAST.aorticReflux;
        u.uMaxT.value = 0.35;
      }
      u.uGain.value = gain;
      u.uDensity.value = bolus.density;
    }
  }

  /**
   * Dim labels on the far side of the heart so it is clear which vessels are behind it.
   * A coronary label is "behind" when its surface normal points away from the camera.
   */
  updateLabels(camera: Camera): void {
    if (!this.labelsVisible) return;
    const center = new Vector3(...HEART.center);
    const p = new Vector3();
    const n = new Vector3();
    const toCam = new Vector3();
    const camLocal = this.rig3d.pulse.worldToLocal(camera.position.clone());
    this.rig3d.pulse.traverse((o) => {
      if (!(o instanceof CSS2DObject)) return;
      p.copy(o.position);
      n.copy(p).sub(center).normalize();
      toCam.copy(camLocal).sub(p).normalize();
      o.element.classList.toggle('behind', n.dot(toCam) < -0.05);
    });
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    // CSS2DRenderer ignores parent visibility, so toggle each label itself.
    for (const root of [this.labels, this.rig3d.pulse]) {
      root.traverse((o) => {
        if (o instanceof CSS2DObject) o.visible = visible;
      });
    }
  }
}
