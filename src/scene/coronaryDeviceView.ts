import {
  CanvasTexture,
  DoubleSide,
  MeshStandardMaterial,
  RepeatWrapping,
  type Group,
  type ShaderMaterial,
  type Vector3,
} from 'three';
import { DEVICES } from '../config/anatomy';
import { createTubeFluoroMaterial } from './fluoroMaterials';
import { VarTube, type RingSpec } from './varTube';

const INF = DEVICES.inflation;

/** Stent strut pattern: a zig-zag mesh drawn once onto a canvas, used as an alpha map. */
function strutTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.beginPath();
  // Two sinusoidal rings joined by short links: the classic open-cell stent look.
  for (const x0 of [8, 40]) {
    for (let y = 0; y <= 64; y += 16) {
      g.moveTo(x0 - 6, y);
      g.lineTo(x0 + 6, y + 8);
      g.lineTo(x0 - 6, y + 16);
    }
  }
  g.moveTo(14, 8);
  g.lineTo(34, 8);
  g.moveTo(46, 40);
  g.lineTo(66, 40);
  g.moveTo(-18, 40);
  g.lineTo(2, 40);
  g.stroke();
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

export interface BalloonDraw {
  /** Local-space centreline from the guide tip to the catheter tip, 0.5 mm spacing. */
  points: Vector3[];
  /** Distance (mm, from the start of `points`) of the proximal and distal balloon markers. */
  prox: number;
  dist: number;
  radius: number;
  /** Balloon filled with contrast (inflated). */
  inflated: boolean;
  /** A crimped (undeployed) stent sits on this balloon. */
  crimpedStent: boolean;
}

/**
 * Draws the balloon / stent catheters, deployed stents and dissection staining.
 * Everything lives in the heart's pulse groups, so it beats with the coronaries.
 */
export class CoronaryDeviceView {
  private readonly balloonTube: VarTube;
  private readonly crimpTube: VarTube;
  private readonly stentTubes: VarTube[] = [];
  private readonly stainTube: VarTube;
  private readonly stainMat: ShaderMaterial;
  private readonly balloonMat: MeshStandardMaterial;
  private readonly stentMat: MeshStandardMaterial;

  constructor(
    private readonly pulse3d: Group,
    private readonly pulseFluoro: Group,
  ) {
    this.balloonMat = new MeshStandardMaterial({
      color: 0xf0c060,
      roughness: 0.3,
      metalness: 0.05,
      transparent: true,
      opacity: 0.8,
      emissive: 0x2a1d05,
    });
    const tex = strutTexture();
    tex.repeat.set(1 / 3, 6); // one strut cell every 3 mm, six around
    this.stentMat = new MeshStandardMaterial({
      color: 0xd8dee4,
      roughness: 0.25,
      metalness: 0.9,
      alphaMap: tex,
      alphaTest: 0.5,
      side: DoubleSide,
      emissive: 0x202428,
    });
    this.balloonTube = this.add(new VarTube(200, 16, this.balloonMat, createTubeFluoroMaterial()));
    this.crimpTube = this.add(new VarTube(80, 16, this.stentMat, createTubeFluoroMaterial(true)));
    this.stainMat = createTubeFluoroMaterial();
    const stain3d = new MeshStandardMaterial({ color: 0x3a0806, roughness: 0.9, transparent: true, opacity: 0.85 });
    this.stainTube = this.add(new VarTube(40, 8, stain3d, this.stainMat));
  }

  private add(t: VarTube): VarTube {
    this.pulse3d.add(t.mesh3d);
    this.pulseFluoro.add(t.meshFluoro);
    return t;
  }

  /** The balloon catheter currently out of the guide, or null to hide it. */
  setBalloon(d: BalloonDraw | null): void {
    if (!d) {
      this.balloonTube.hide();
      this.crimpTube.hide();
      return;
    }
    const body = d.dist - d.prox;
    const taper = Math.min(2.5, body / 4);
    this.balloonMat.opacity = d.inflated ? 0.55 : 0.85;
    this.balloonTube.setPath(d.points, (_i, mm): RingSpec => {
      // Radiopaque marker bands at both ends of the working length.
      const marker = Math.abs(mm - d.prox) < 0.6 || Math.abs(mm - d.dist) < 0.6;
      if (mm < d.prox - taper || mm > d.dist + taper) {
        const tip = mm > d.dist;
        return { r: tip ? INF.shaftRadius * 0.9 : INF.shaftRadius, mu: marker ? 5 : 0.3 };
      }
      let k = 1;
      if (mm < d.prox) k = 1 - (d.prox - mm) / taper;
      if (mm > d.dist) k = 1 - (mm - d.dist) / taper;
      const r = INF.shaftRadius + (d.radius - INF.shaftRadius) * Math.max(0, k);
      // An inflated balloon is filled with diluted contrast, so it shows as a dark sausage.
      return { r, mu: marker ? 5 : d.inflated ? 0.45 : 0.35 };
    });
    if (d.crimpedStent) {
      const pts: Vector3[] = [];
      let mm = 0;
      d.points.forEach((p, i) => {
        if (i > 0) mm += p.distanceTo(d.points[i - 1]);
        if (mm >= d.prox - 0.25 && mm <= d.dist + 0.25) pts.push(p);
      });
      this.crimpTube.setPath(pts, () => ({
        r: Math.max(DEVICES.stent.crimpedRadius, d.radius + 0.04),
        mu: 1.2,
      }));
    } else {
      this.crimpTube.hide();
    }
  }

  /** Deployed stents: each is a centreline through its span with a fixed radius. */
  setStents(stents: { points: Vector3[]; radius: number }[]): void {
    while (this.stentTubes.length < stents.length) {
      this.stentTubes.push(this.add(new VarTube(120, 18, this.stentMat, createTubeFluoroMaterial(true))));
    }
    this.stentTubes.forEach((t, i) => {
      const s = stents[i];
      if (!s) return t.hide();
      t.setPath(s.points, () => ({ r: s.radius + 0.03, mu: 1.2 }));
    });
  }

  /**
   * Dissection flap / contrast staining: a thin streak just outside the lumen.
   * `stain` (0..1) is how much contrast is trapped in the vessel wall right now.
   */
  setStain(points: Vector3[] | null, stain: number): void {
    if (!points) {
      this.stainTube.hide();
      return;
    }
    const n = points.length;
    this.stainTube.setPath(points, (i) => ({ r: 0.9 * Math.sin((Math.PI * (i + 0.5)) / n), mu: 1.4 }));
    this.stainMat.uniforms.uGain.value = stain;
    this.stainTube.mesh3d.visible = true;
  }
}
