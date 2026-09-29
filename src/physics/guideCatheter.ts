import { Vector3 } from 'three';
import { DEVICES } from '../config/anatomy';
import type { VesselTree } from '../anatomy/vesselTree';
import { heartLocalToWorld } from '../anatomy/heartShape';
import { Route, type ToWorld } from './route';

export type Level = 'info' | 'ok' | 'warn' | 'danger';
export interface Feedback {
  text: string;
  level: Level;
}

const DEG = Math.PI / 180;
const G = DEVICES.guide;

/** Signed angle difference a-b wrapped to [-180, 180). */
export function angleDiff(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

/**
 * The guide catheter: a pre-shaped tube pushed from the wrist up the arm, round the arch and
 * down to the aortic root. Its curved tip has to be rotated towards the left coronary cusp,
 * then gently advanced to "engage" (seat in) the left main ostium.
 */
export class GuideCatheter {
  /** Length inserted through the radial sheath (mm). */
  inserted = 0;
  /** Tip rotation (deg). 0 = facing the left coronary cusp. */
  rotation: number = G.initialRotationDeg;
  engaged = false;

  readonly baseRoute: Route;
  private readonly engagedRoute: Route;
  /** Insertion length at which the tip reaches the aortic root. */
  readonly rootLength: number;
  /** Insertion length at which the tip enters the aorta. */
  readonly aortaEntry: number;
  /** Angle (deg, same convention as rotation) of the right coronary ostium. */
  readonly rightCuspAngle: number;

  constructor(
    private readonly tree: VesselTree,
    toWorld: ToWorld,
  ) {
    const access = tree.get('access')!;
    const aorta = tree.get('aorta')!;
    const lm = tree.get('lm')!;
    const join = access.spec.joins!.at;
    const segs = [
      { vessel: access, u0: 0, u1: 1 },
      { vessel: aorta, u0: join, u1: G.rootStopU },
    ];
    this.baseRoute = new Route(segs, toWorld);
    this.engagedRoute = new Route(
      [...segs, { vessel: lm, u0: 0, u1: G.seatDepthMm / lm.length }],
      toWorld,
    );
    this.rootLength = this.baseRoute.length;
    this.aortaEntry = access.length;

    const lmOstium = this.worldPoint('lm', 0);
    const rcaOstium = this.worldPoint('rca', 0);
    const ref = this.perpendicular(lmOstium);
    const rca = this.perpendicular(rcaOstium);
    const t = this.rootTangent();
    this.rightCuspAngle = Math.atan2(t.dot(new Vector3().crossVectors(ref, rca)), ref.dot(rca)) / DEG;
  }

  get route(): Route {
    return this.engaged ? this.engagedRoute : this.baseRoute;
  }

  get maxInsertion(): number {
    return this.engaged ? this.rootLength + G.seatDepthMm : this.rootLength;
  }

  /** How far the guide tip sits inside the left main (u), when engaged. */
  get lmTipU(): number {
    const lm = this.tree.get('lm')!;
    return Math.max(0, (this.inserted - this.rootLength) / lm.length);
  }

  get inAorta(): boolean {
    return this.inserted > this.aortaEntry + 5;
  }

  /** True when the tip is down at the sinuses, ready to be rotated into the ostium. */
  get atRoot(): boolean {
    return this.inserted >= this.rootLength - 2;
  }

  /** Angle between the tip and the left coronary cusp. */
  get tipError(): number {
    return angleDiff(this.rotation, 0);
  }

  advance(mm: number, wireOut: boolean): Feedback | null {
    if (mm === 0) return null;
    if (wireOut) return { text: 'Pull the guidewire back into the guide before moving the guide.', level: 'warn' };
    const before = this.inserted;
    if (mm > 0 && !this.engaged && this.atRoot && before >= this.rootLength - 0.01) {
      if (Math.abs(this.tipError) <= G.engageToleranceDeg) {
        this.engaged = true;
        this.inserted = Math.min(this.rootLength + G.seatDepthMm, this.rootLength + mm);
        return { text: 'Left main engaged. Pressure trace is stable: the guide is seated coaxially.', level: 'ok' };
      }
      if (Math.abs(angleDiff(this.rotation, this.rightCuspAngle)) <= G.engageToleranceDeg) {
        return { text: 'The tip is facing the RIGHT coronary cusp. This procedure targets the left main.', level: 'warn' };
      }
      return {
        text: 'The tip is at the aortic root but not facing the left coronary ostium. Rotate (A/D) and watch the tip on fluoro.',
        level: 'info',
      };
    }
    this.inserted = Math.min(this.maxInsertion, Math.max(0, this.inserted + mm));
    if (this.engaged && this.inserted < this.rootLength) {
      this.engaged = false;
      return { text: 'Guide backed out of the left main.', level: 'info' };
    }
    if (mm > 0 && this.engaged && this.inserted >= this.maxInsertion - 0.01 && before >= this.maxInsertion - 0.01) {
      return { text: 'The guide is already seated. Pushing further risks deep intubation of the left main.', level: 'warn' };
    }
    return null;
  }

  rotate(deg: number, wireOut: boolean): Feedback | null {
    if (deg === 0) return null;
    if (wireOut) return { text: 'Rotation is locked while the wire is out in the coronary.', level: 'warn' };
    this.rotation = (this.rotation + deg + 360) % 360;
    if (this.engaged && Math.abs(this.tipError) > G.disengageDeg) {
      this.engaged = false;
      this.inserted = this.rootLength;
      return { text: 'Too much torque: the tip flipped out of the left main.', level: 'warn' };
    }
    return null;
  }

  /** Unit direction the curved tip points (world), perpendicular to the aortic root axis. */
  tipDirection(out = new Vector3()): Vector3 {
    const t = this.rootTangent();
    const ref = this.perpendicular(this.worldPoint('lm', 0));
    return out.copy(ref).applyAxisAngle(t, this.rotation * DEG);
  }

  /** Human-readable location of the tip. */
  location(): string {
    if (this.engaged) return 'Left main ostium (engaged)';
    if (this.inserted < 2) return 'Radial sheath';
    const { seg, u } = this.baseRoute.locate(this.inserted);
    if (seg.vessel.spec.id === 'access') {
      if (u < 0.3) return 'Radial artery';
      if (u < 0.55) return 'Brachial artery';
      if (u < 0.66) return 'Axillary artery';
      if (u < 0.86) return 'Subclavian artery';
      return 'Brachiocephalic trunk';
    }
    if (u > 0.25) return 'Aortic arch';
    if (u > 0.12) return 'Ascending aorta';
    return 'Aortic root (sinus of Valsalva)';
  }

  /** Where the tip is facing, in words. */
  facing(): string {
    if (!this.inAorta) return '—';
    const e = Math.abs(this.tipError);
    if (e <= G.engageToleranceDeg) return 'Left coronary cusp';
    if (Math.abs(angleDiff(this.rotation, this.rightCuspAngle)) <= G.engageToleranceDeg) return 'Right coronary cusp';
    return 'Aortic wall';
  }

  /** Resting-pose world position of a coronary point (heartbeat ignored for reference directions). */
  private worldPoint(id: 'lm' | 'rca', u: number): Vector3 {
    return heartLocalToWorld(this.tree.get(id)!.pointAt(u));
  }

  private rootTangent(): Vector3 {
    const aorta = this.tree.get('aorta')!;
    // Pointing from the arch down towards the valve (direction of travel).
    return aorta.frameAt(G.rootStopU).t.clone().negate().normalize();
  }

  /** Component of (p - root point) perpendicular to the root axis, normalised. */
  private perpendicular(p: Vector3): Vector3 {
    const aorta = this.tree.get('aorta')!;
    const c = aorta.pointAt(G.rootStopU);
    const t = this.rootTangent();
    const d = p.clone().sub(c);
    d.addScaledVector(t, -d.dot(t));
    return d.normalize();
  }
}
