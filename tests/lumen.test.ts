import { describe, expect, it } from 'vitest';
import { diameterStenosis, stenosisFactor, taperRadius } from '../src/anatomy/lumen';

describe('stenosisFactor', () => {
  const lesion = { centerMm: 50, lengthMm: 14, severity: 0.9 };

  it('narrows to 10% of the reference diameter at the centre of a 90% lesion', () => {
    expect(stenosisFactor(50, lesion)).toBeCloseTo(0.1, 6);
  });

  it('leaves the vessel untouched outside the lesion', () => {
    expect(stenosisFactor(50 - 7, lesion)).toBe(1);
    expect(stenosisFactor(50 + 7.5, lesion)).toBe(1);
    expect(stenosisFactor(0, lesion)).toBe(1);
  });

  it('tapers monotonically from the centre to the edge', () => {
    let prev = stenosisFactor(50, lesion);
    for (let mm = 50; mm <= 57; mm += 0.25) {
      const f = stenosisFactor(mm, lesion);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f;
    }
  });

  it('is symmetric', () => {
    expect(stenosisFactor(46, lesion)).toBeCloseTo(stenosisFactor(54, lesion), 9);
  });
});

describe('taperRadius', () => {
  const knots = [
    { u: 0, r: 2 },
    { u: 0.5, r: 1.5 },
    { u: 1, r: 1 },
  ];
  it('interpolates between knots and clamps at the ends', () => {
    expect(taperRadius(0.25, knots)).toBeCloseTo(1.75);
    expect(taperRadius(-1, knots)).toBe(2);
    expect(taperRadius(2, knots)).toBe(1);
  });
});

describe('diameterStenosis', () => {
  it('computes percent diameter stenosis', () => {
    expect(diameterStenosis(0.3, 3)).toBeCloseTo(0.9);
    expect(diameterStenosis(3, 3)).toBe(0);
    expect(diameterStenosis(3.2, 3)).toBe(0);
  });
});
