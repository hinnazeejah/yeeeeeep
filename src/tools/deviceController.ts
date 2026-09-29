import { MeshStandardMaterial, Vector3, type Scene } from 'three';
import { DEVICES } from '../config/anatomy';
import type { AnatomyModel } from '../anatomy/anatomyModel';
import { GuideCatheter, type Feedback } from '../physics/guideCatheter';
import { Guidewire } from '../physics/guidewire';
import { Route } from '../physics/route';
import type { ContrastBolus } from '../physics/flow';
import { DeviceTube } from '../scene/deviceTube';
import type { DeviceInput } from '../ui/input';
import { toolAvailability, type ToolId } from './tools';

const G = DEVICES.guide;
const W = DEVICES.wire;

/**
 * Owns the physical devices, applies user input to the active one each frame and keeps their
 * meshes (3D and fluoro) in sync with the beating anatomy.
 */
export class DeviceController {
  readonly guide: GuideCatheter;
  readonly wire: Guidewire;
  activeTool: ToolId = 'guide';
  /** Current procedure stage, set by the app each frame (used for tool rules). */
  stageIndex = 0;
  onFeedback: (f: Feedback) => void = () => {};

  private readonly guideTube: DeviceTube;
  private readonly wireTube: DeviceTube;
  private readonly guideMat: MeshStandardMaterial;

  constructor(
    private readonly anatomy: AnatomyModel,
    scene3d: Scene,
    sceneFluoro: Scene,
  ) {
    this.guide = new GuideCatheter(anatomy.vessels, anatomy.toWorld);
    this.wire = new Guidewire(anatomy.vessels);

    this.guideMat = new MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.35, metalness: 0.1, emissive: 0x0c1a1f });
    this.guideTube = new DeviceTube(320, 10, G.radius, this.guideMat);
    this.wireTube = new DeviceTube(
      520,
      6,
      W.visualRadius,
      new MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.25, metalness: 0.8, emissive: 0x303438 }),
    );
    this.guideTube.mesh3d.name = 'guide';
    this.wireTube.mesh3d.name = 'wire';
    for (const t of [this.guideTube, this.wireTube]) {
      scene3d.add(t.mesh3d);
      sceneFluoro.add(t.meshFluoro);
    }
  }

  get wireOut(): boolean {
    return this.wire.out > 0;
  }

  /** Meshes the hover picker can hit. */
  get pickables() {
    return [this.guideTube.mesh3d, this.wireTube.mesh3d];
  }

  setGuideHighlight(on: boolean): void {
    this.guideMat.emissive.setHex(on ? 0x1f5a60 : 0x0c1a1f);
  }

  selectTool(id: ToolId): Feedback | null {
    const a = toolAvailability(id, this);
    if (!a.ok) return { text: a.reason!, level: 'warn' };
    this.activeTool = id;
    return null;
  }

  update(dt: number, input: DeviceInput): void {
    const axis = input.advanceAxis();
    const rot = input.rotateAxis();
    let fb: Feedback | null = null;

    if (this.activeTool === 'guide') {
      const speed = input.fine ? G.fineSpeedMmPerS : G.speedMmPerS;
      const mm = axis * speed * dt + input.drainWheel(dt, speed * 1.5);
      fb = this.guide.advance(mm, this.wireOut) ?? this.guide.rotate(rot * G.rotateDegPerS * (input.fine ? 0.3 : 1) * dt, this.wireOut);
    } else if (this.activeTool === 'wire') {
      const speed = input.fine ? W.fineSpeedMmPerS : W.speedMmPerS;
      const mm = axis * speed * dt + input.drainWheel(dt, speed * 1.5);
      this.wire.rotate(rot * W.rotateDegPerS * (input.fine ? 0.4 : 1) * dt);
      fb = this.wire.advance(mm, dt, this.guide.lmTipU);
    } else {
      input.drainWheel(dt, 1000);
      this.wire.advance(0, dt, this.guide.lmTipU);
    }
    if (fb) this.onFeedback(fb);

    // If the guide lost engagement, a wire tool selection is no longer valid.
    if (this.activeTool === 'wire' && !this.guide.engaged) this.activeTool = 'guide';

    this.anatomy.setCoronaryOpacity(this.wireOut ? 0.45 : 0.9);
    this.updateMeshes();
  }

  /** Start a contrast injection if the rules allow. Returns contrast volume used (ml). */
  inject(bolus: ContrastBolus): { ok: boolean; ml: number; feedback?: Feedback } {
    const a = toolAvailability('contrast', this);
    if (!a.ok) return { ok: false, ml: 0, feedback: { text: a.reason!, level: 'warn' } };
    if (this.guide.engaged) {
      this.anatomy.injectedSystem = 'left';
      bolus.start();
      return { ok: true, ml: DEVICES.contrastMl.selective };
    }
    this.anatomy.injectedSystem = 'aortic';
    bolus.start(1.6);
    return {
      ok: true,
      ml: DEVICES.contrastMl.aortic,
      feedback: { text: 'Aortic root flush: the dye outlines the root and faintly fills both coronaries.', level: 'info' },
    };
  }

  /** World position of the tip of whatever device is being driven (for camera follow). */
  activeTip(out = new Vector3()): Vector3 {
    if (this.activeTool === 'wire' && this.wireOut) return this.wireRoute().pointAt(this.guide.inserted + this.wire.out, out);
    return this.guide.route.pointAt(this.guide.inserted, out);
  }

  private wireRoute(): Route {
    return new Route([...this.guide.route.segs, ...this.wire.segs], this.anatomy.toWorld);
  }

  private updateMeshes(): void {
    // --- Guide catheter ---------------------------------------------------
    const ins = this.guide.inserted;
    const pts = this.guide.route.sample(0, ins, 2.5);
    if (!this.guide.engaged && pts.length > 1) {
      // Pre-shaped tip: bend the last few cm towards the direction the tip faces.
      // The curve only opens up once it is in the wide aorta.
      const intoAorta = ins - this.guide.aortaEntry;
      const scale = Math.min(1, Math.max(0, intoAorta / 60));
      if (scale > 0) {
        const dir = this.guide.tipDirection();
        for (let i = 0; i < pts.length; i++) {
          const fromTip = (pts.length - 1 - i) * (ins / (pts.length - 1));
          if (fromTip > G.hookLength) continue;
          const k = 1 - fromTip / G.hookLength;
          pts[i].addScaledVector(dir, G.hookSize * k * k * scale);
        }
      }
    }
    // Short external segment outside the wrist, with the sheath hub.
    if (pts.length > 1) {
      const out = pts[0].clone().sub(pts[1]).normalize();
      pts.unshift(pts[0].clone().addScaledVector(out, 25));
    }
    this.guideTube.setPath(pts, (fromTip) => (fromTip < 2 ? 1.2 : 0.35));

    // --- Guidewire (only drawn once it leaves the guide) -------------------
    if (!this.wireOut) {
      this.wireTube.setPath([], () => 0);
      return;
    }
    const route = this.wireRoute();
    const end = ins + this.wire.out;
    const wpts = route.sample(Math.max(0, ins - 30), end, 1);
    // Shaped tip: a small bend in the direction the wire is torqued.
    const tip = this.wire.tip!;
    const bend = this.wire.tipBendDirection();
    if (tip.vessel.spec.onHeart) bend.transformDirection(this.anatomy.rig3d.pulse.matrixWorld);
    const nBend = Math.min(wpts.length - 1, Math.ceil(W.tipBendMm));
    for (let i = 0; i < nBend; i++) {
      const k = (nBend - i) / nBend; // 1 at the tip
      wpts[wpts.length - 1 - i].addScaledVector(bend, 0.9 * k * k);
    }
    this.wireTube.setPath(wpts, (fromTip) => (fromTip < W.tipOpaqueMm ? 4.0 : 1.1));
  }
}
