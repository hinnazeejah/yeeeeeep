import { describe, expect, it } from 'vitest';
import { DEVICES } from '../src/config/anatomy';
import { BalloonCatheter } from '../src/physics/balloon';
import { ecgSample, Physiology } from '../src/physics/physiology';

function run(b: BalloonCatheter, seconds: number, atmPerS = 0): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    if (atmPerS) b.inflate(atmPerS * dt);
    b.update(dt);
  }
}

describe('balloon catheter', () => {
  it('only changes size while inside the guide', () => {
    const b = new BalloonCatheter('balloon');
    expect(b.setSize(1, 2)).toBeNull();
    expect(b.label).toBe('2.5 × 20 mm');
    b.move(30, 100);
    expect(b.setSize(0, 0)?.level).toBe('warn');
    expect(b.nominal).toBe(2.5);
  });

  it('cannot be moved while inflated, and cannot pass the wire tip', () => {
    const b = new BalloonCatheter('balloon');
    b.move(500, 80);
    expect(b.adv).toBe(80);
    b.inflate(6);
    const f = b.move(-10, 80);
    expect(b.adv).toBe(80);
    expect(f?.text).toMatch(/Deflate/);
  });

  it('records one inflation from inflate to full deflation', () => {
    const b = new BalloonCatheter('balloon');
    b.move(40, 100);
    run(b, 4, 3); // ~12 atm
    expect(b.pressure).toBeGreaterThan(11);
    expect(b.occluding).toBe(true);
    b.deflate();
    let ended = false;
    for (let i = 0; i < 300 && !ended; i++) ended = b.update(1 / 60) === 'deflated';
    expect(ended).toBe(true);
    expect(b.pressure).toBe(0);
    expect(b.inflatedSeconds).toBeGreaterThan(3);
    expect(b.peakAtm).toBeGreaterThan(11);
  });

  it('ruptures well above rated burst pressure', () => {
    const b = new BalloonCatheter('balloon');
    b.move(40, 100);
    let ruptured = false;
    for (let i = 0; i < 40 && !ruptured; i++) ruptured = b.inflate(1).ruptured;
    expect(ruptured).toBe(true);
    expect(b.peakAtm).toBeGreaterThan(DEVICES.balloon.rbpAtm + DEVICES.inflation.ruptureOverRbp);
    expect(b.inflate(1).feedback?.text).toMatch(/ruptured/);
  });
});

describe('patient physiology', () => {
  it('develops ST elevation and chest pain during LAD occlusion, then recovers', () => {
    const p = new Physiology();
    const dt = 0.1;
    for (let t = 0; t < 20; t += dt) p.update(dt, true, 0, true);
    expect(p.stMm).toBeGreaterThan(2);
    expect(p.chestPain).toBe(true);
    for (let t = 0; t < 40; t += dt) p.update(dt, false, 1, true);
    expect(p.stMm).toBeLessThan(0.2);
    expect(p.chestPain).toBe(false);
  });

  it('becomes unstable with prolonged occlusion', () => {
    const p = new Physiology();
    for (let t = 0; t < 70; t += 0.1) p.update(0.1, true, 0, true);
    expect(p.unstable).toBe(true);
    expect(p.sys).toBeLessThan(100);
    expect(p.ectopyRate).toBeGreaterThan(0);
  });

  it('has no ischaemia at rest with the untreated lesion, and ACT rises after heparin', () => {
    const p = new Physiology();
    for (let t = 0; t < 120; t += 0.1) p.update(0.1, false, 0.35, true);
    expect(p.stMm).toBe(0);
    expect(p.act).toBeGreaterThan(250);
  });

  it('draws an elevated ST segment on the ECG', () => {
    const j = 0.12; // phase in the ST segment
    expect(ecgSample(j, 3) - ecgSample(j, 0)).toBeCloseTo(0.3, 1);
    expect(ecgSample(0, 0)).toBeGreaterThan(1); // R wave peak
  });
});
