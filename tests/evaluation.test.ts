import { describe, expect, it } from 'vitest';
import { DEVICES } from '../src/config/anatomy';
import {
  achievedDiameter,
  buildDebrief,
  coverage,
  flowFactor,
  residualStenosis,
  timiGrade,
  type ProcedureSummary,
} from '../src/procedure/evaluation';

describe('balloon and stent sizing', () => {
  it('reaches the labelled diameter at nominal pressure', () => {
    expect(achievedDiameter(3.0, DEVICES.stent.nominalAtm, DEVICES.stent)).toBeCloseTo(3.0, 6);
  });

  it('grows with pressure (semi-compliant) and is smaller while unfolding', () => {
    const s = DEVICES.balloon;
    expect(achievedDiameter(2.5, 14, s)).toBeGreaterThan(achievedDiameter(2.5, 8, s));
    expect(achievedDiameter(2.5, 14, s)).toBeCloseTo(2.5 * (1 + 0.015 * 6), 6);
    expect(achievedDiameter(2.5, 1, s)).toBeLessThan(2.5 * 0.8);
    expect(achievedDiameter(2.5, 0, s)).toBe(0);
  });

  it('computes residual stenosis', () => {
    expect(residualStenosis(2.7, 3.0)).toBeCloseTo(0.1);
    expect(residualStenosis(3.2, 3.0)).toBe(0);
  });

  it('reports coverage margins and geographic miss', () => {
    const lesion = { start: 40, end: 54 };
    const ok = coverage({ start: 38, end: 56 }, lesion);
    expect(ok.covers).toBe(true);
    expect(ok.proximalMargin).toBe(2);
    expect(ok.distalMargin).toBe(2);
    const miss = coverage({ start: 44, end: 56 }, lesion);
    expect(miss.covers).toBe(false);
    expect(miss.proximalMargin).toBe(-4);
    expect(miss.overlap).toBeCloseTo(10 / 14);
  });
});

describe('flow and TIMI grade', () => {
  it('is unaffected by mild-moderate narrowing', () => {
    expect(flowFactor(0)).toBe(1);
    expect(flowFactor(0.5)).toBe(1);
    expect(timiGrade(flowFactor(0.1))).toBe(3);
  });

  it('gives slow TIMI 2 flow through a 90% lesion and none through an occlusion', () => {
    expect(timiGrade(flowFactor(0.9))).toBe(2);
    expect(flowFactor(0.99)).toBe(0);
    expect(timiGrade(flowFactor(1))).toBe(0);
  });

  it('falls monotonically as the stenosis tightens', () => {
    let prev = 1;
    for (let ds = 0; ds <= 1; ds += 0.01) {
      const f = flowFactor(ds);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });
});

describe('debrief', () => {
  const good: ProcedureSummary = {
    finished: true,
    referenceDiameter: 2.95,
    residual: 0.02,
    finalFlow: 1,
    heparinGiven: true,
    measured: true,
    predilated: true,
    predilationBalloon: 2.5,
    stents: [{ nominal: 3.0, length: 18, achieved: 3.0, proximalMargin: 2.5, distalMargin: 2.5 }],
    longestInflation: 12,
    dissection: null,
    balloonRupture: false,
    wireForcingSeconds: 0,
    fluoroSeconds: 240,
    contrastMl: 60,
    totalSeconds: 600,
    finalViews: 2,
  };

  it('rates a textbook case as excellent', () => {
    const d = buildDebrief(good);
    expect(d.grade).toBe('Excellent');
    expect(d.score).toBe(100);
    expect(d.items.every((i) => i.status === 'ok')).toBe(true);
    expect(d.headline).toMatch(/TIMI 3/);
  });

  it('flags an undersized stent, a geographic miss and an unsealed dissection', () => {
    const d = buildDebrief({
      ...good,
      residual: 0.25,
      finalFlow: 0.45,
      stents: [{ nominal: 2.5, length: 12, achieved: 2.45, proximalMargin: -1, distalMargin: 1 }],
      dissection: { cause: 'Wire forced through the lesion', sealed: false },
    });
    const by = (label: string) => d.items.find((i) => i.label === label)!;
    expect(by('Stent diameter').status).toBe('bad');
    expect(by('Lesion coverage').status).toBe('bad');
    expect(by('Dissection').status).toBe('bad');
    expect(by('Final flow').value).toBe('TIMI 2');
    expect(d.score).toBeLessThan(55);
    expect(d.grade).toBe('Needs work');
  });

  it('penalises missing heparin and long inflations, and marks unfinished cases', () => {
    const d = buildDebrief({ ...good, heparinGiven: false, longestInflation: 75, finished: false });
    expect(d.items.find((i) => i.label === 'Anticoagulation')!.status).toBe('bad');
    expect(d.items.find((i) => i.label === 'Longest inflation')!.status).toBe('bad');
    expect(d.grade).toBe('Incomplete');
  });

  it('never goes below zero', () => {
    const d = buildDebrief({
      ...good,
      residual: 0.9,
      finalFlow: 0,
      stents: [],
      heparinGiven: false,
      measured: false,
      predilated: false,
      dissection: { cause: 'x', sealed: false },
      balloonRupture: true,
      longestInflation: 120,
      contrastMl: 400,
      fluoroSeconds: 3000,
      finalViews: 0,
      wireForcingSeconds: 10,
    });
    expect(d.score).toBe(0);
  });
});
