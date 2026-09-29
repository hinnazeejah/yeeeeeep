import { describe, expect, it } from 'vitest';
import type { Vector3 } from 'three';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { heartLocalToWorld } from '../src/anatomy/heartShape';
import type { Vessel } from '../src/anatomy/vessel';
import { GuideCatheter } from '../src/physics/guideCatheter';
import { Guidewire, branchAngle } from '../src/physics/guidewire';

const tree = buildVesselTree();
const toWorld = (v: Vessel, p: Vector3, out: Vector3) => out.copy(v.spec.onHeart ? heartLocalToWorld(p) : p);

function engagedGuide(): GuideCatheter {
  const g = new GuideCatheter(tree, toWorld);
  g.inserted = g.rootLength;
  g.rotation = 0;
  g.advance(1, false);
  return g;
}

/** Push the wire at a steady speed (mm/s) for a distance. */
function push(w: Guidewire, g: GuideCatheter, mm: number, speed: number): void {
  const dt = 1 / 60;
  for (let done = 0; done < mm; done += speed * dt) w.advance(speed * dt, dt, g.lmTipU);
}

describe('guide catheter', () => {
  it('stops at the aortic root and will not engage while facing the wrong way', () => {
    const g = new GuideCatheter(tree, toWorld);
    g.advance(10000, false);
    expect(g.inserted).toBeCloseTo(g.rootLength, 5);
    expect(g.atRoot).toBe(true);
    g.rotation = 120;
    g.advance(2, false);
    expect(g.engaged).toBe(false);
  });

  it('starts facing neither coronary cusp, so the learner has to find the ostium', () => {
    const g = new GuideCatheter(tree, toWorld);
    g.inserted = g.rootLength;
    expect(g.facing()).toBe('Aortic wall');
  });

  it('engages the left main when the tip faces the left cusp', () => {
    const g = engagedGuide();
    expect(g.engaged).toBe(true);
    expect(g.location()).toMatch(/Left main/);
  });

  it('pops out of the ostium with excessive torque', () => {
    const g = engagedGuide();
    g.rotate(60, false);
    expect(g.engaged).toBe(false);
  });

  it('cannot be moved while the wire is out', () => {
    const g = engagedGuide();
    const before = g.inserted;
    const f = g.advance(-20, true);
    expect(g.inserted).toBe(before);
    expect(f?.level).toBe('warn');
  });
});

describe('guidewire steering', () => {
  const lm = tree.get('lm')!;
  const lad = tree.get('lad')!;
  const lcx = tree.get('lcx')!;
  const d1 = tree.get('d1')!;

  it('enters the LAD or LCx depending on tip rotation at the LM bifurcation', () => {
    const g = engagedGuide();
    const toLad = new Guidewire(tree);
    toLad.rotation = (branchAngle(lm, lad) + 360) % 360;
    push(toLad, g, 30, 20);
    expect(toLad.tip?.vessel.spec.id).toBe('lad');

    const toLcx = new Guidewire(tree);
    toLcx.rotation = (branchAngle(lm, lcx) + 360) % 360;
    push(toLcx, g, 30, 20);
    expect(toLcx.tip?.vessel.spec.id).toBe('lcx');
  });

  it('is captured by a diagonal when the tip points into it', () => {
    const g = engagedGuide();
    const w = new Guidewire(tree);
    w.rotation = (branchAngle(lm, lad) + 360) % 360;
    push(w, g, 27, 20); // into the proximal LAD
    expect(w.tip?.vessel.spec.id).toBe('lad');
    w.rotation = (branchAngle(lad, d1) + 360) % 360;
    push(w, g, 30, 20);
    expect(w.tip?.vessel.spec.id).toBe('d1');
  });

  function wireToLesion(): { w: Guidewire; g: GuideCatheter } {
    const g = engagedGuide();
    const w = new Guidewire(tree);
    w.rotation = (branchAngle(lm, lad) + 360) % 360;
    push(w, g, 27, 20);
    // Point away from both diagonals.
    w.rotation = (branchAngle(lad, d1) + 180 + 360) % 360;
    while (!w.inLesion) w.advance(0.2, 1 / 60, g.lmTipU);
    return { w, g };
  }

  it('crosses the lesion without risk when advanced gently', () => {
    const { w, g } = wireToLesion();
    push(w, g, 25, 5);
    expect(w.crossed).toBe(true);
    expect(w.dissectionRisk).toBe(0);
  });

  it('accumulates hidden dissection risk when forced through the lesion', () => {
    const { w, g } = wireToLesion();
    push(w, g, 25, 40);
    expect(w.dissectionRisk).toBeGreaterThan(0);
    expect(w.forcingSeconds).toBeGreaterThan(0);
  });

  it('retracts back into the guide', () => {
    const g = engagedGuide();
    const w = new Guidewire(tree);
    push(w, g, 20, 20);
    w.advance(-100, 1, g.lmTipU);
    expect(w.out).toBe(0);
    expect(w.tip).toBeNull();
  });
});
