import { describe, expect, it } from 'vitest';
import { LESION } from '../src/config/anatomy';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { computeTransitTimes, NO_FLOW_TIME, sampleArray } from '../src/physics/flow';
import { timiGrade } from '../src/procedure/evaluation';

function setup() {
  const tree = buildVesselTree();
  const lad = tree.get('lad')!;
  const c = LESION.centerU * lad.length;
  return { tree, lad, start: c - LESION.lengthMm / 2, end: c + LESION.lengthMm / 2 };
}

const distalArrival = (tree: ReturnType<typeof buildVesselTree>) => sampleArray(tree.get('lad')!.transit, 0.95);

describe('contrast flow through the LAD', () => {
  it('fills slowly beyond the untreated 90% lesion (TIMI 2) while the circumflex is brisk', () => {
    const { tree, lad } = setup();
    computeTransitTimes(tree);
    expect(timiGrade(sampleArray(lad.flow, 0.95))).toBe(2);
    expect(timiGrade(sampleArray(tree.get('lcx')!.flow, 0.9))).toBe(3);
    // Proximal to the lesion the flow is normal.
    expect(sampleArray(lad.flow, 0.1)).toBe(1);
  });

  it('restores brisk flow after a well-sized stent', () => {
    const { tree, lad, start, end } = setup();
    computeTransitTimes(tree);
    const before = distalArrival(tree);
    lad.expansions.push({ startMm: start - 2, endMm: end + 2, radius: lad.referenceRadiusAtMm((start + end) / 2) });
    computeTransitTimes(tree);
    expect(timiGrade(sampleArray(lad.flow, 0.95))).toBe(3);
    expect(distalArrival(tree)).toBeLessThan(before * 0.6);
  });

  it('stops flow beyond an inflated balloon and in the branches downstream', () => {
    const { tree, lad, start } = setup();
    lad.occludedFromMm = start;
    computeTransitTimes(tree);
    expect(distalArrival(tree)).toBe(NO_FLOW_TIME);
    expect(sampleArray(tree.get('d2')!.transit, 0.5)).toBe(NO_FLOW_TIME);
    // D1 leaves the LAD before the lesion, so it still fills.
    expect(sampleArray(tree.get('d1')!.transit, 0.5)).toBeLessThan(NO_FLOW_TIME);
  });

  it('slows flow after an unsealed dissection, and recovers once it is sealed', () => {
    const { tree, lad, start, end } = setup();
    lad.expansions.push({ startMm: start - 2, endMm: end + 2, radius: lad.referenceRadiusAtMm((start + end) / 2) });
    lad.dissection = { mm: end, sealed: false };
    computeTransitTimes(tree);
    expect(timiGrade(sampleArray(lad.flow, 0.95))).toBe(2);
    lad.dissection.sealed = true;
    computeTransitTimes(tree);
    expect(timiGrade(sampleArray(lad.flow, 0.95))).toBe(3);
  });

  it('balloon angioplasty leaves recoil, so the lumen is better but not normal', () => {
    const { tree, lad, start, end } = setup();
    const mid = (start + end) / 2;
    const ref = lad.referenceRadiusAtMm(mid);
    const before = lad.radiusAtMm(mid);
    lad.expansions.push({ startMm: start, endMm: end, radius: (2.5 / 2) * 0.7 });
    computeTransitTimes(tree);
    const after = lad.radiusAtMm(mid);
    expect(after).toBeGreaterThan(before * 3);
    expect(after).toBeLessThan(ref * 0.75);
  });
});
