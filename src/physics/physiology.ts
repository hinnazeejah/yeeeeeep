import { PHYSIOLOGY as P } from '../config/anatomy';

/**
 * A deliberately simple patient model: enough to show the consequences of blocking the LAD.
 *
 * `ischemia` (0..1) rises while the LAD is occluded (balloon up) or flow is very poor, and falls
 * after reperfusion. It drives ST elevation in the anterior leads, heart rate, blood pressure and,
 * with prolonged occlusion, ventricular ectopy.
 */
export class Physiology {
  hr: number = P.baselineHR;
  sys: number = P.baselineSys;
  dia: number = P.baselineDia;
  spo2: number = P.spo2;
  act: number = P.actBaseline;
  ischemia = 0;
  /** Current continuous occlusion (s). */
  occlusionSeconds = 0;
  /** Premature ventricular beats per minute (0 = none). */
  ectopyRate = 0;
  /** True while the patient is haemodynamically compromised. */
  unstable = false;
  /** Patient is complaining of chest pain. */
  chestPain = false;
  private t = 0;

  /** ST elevation in V2 (mm), proportional to ischaemia. */
  get stMm(): number {
    return P.maxStMm * this.ischemia;
  }

  /**
   * @param occluded the LAD is blocked right now (an inflated balloon)
   * @param distalFlow flow fraction reaching the distal LAD (1 = normal)
   * @param heparin heparin has been given
   */
  update(dt: number, occluded: boolean, distalFlow: number, heparin: boolean): void {
    this.t += dt;
    this.occlusionSeconds = occluded ? this.occlusionSeconds + dt : 0;

    // Resting flow above ~25% of normal does not cause ischaemia at rest (stable angina).
    let target = 0;
    if (occluded) target = Math.min(1, this.occlusionSeconds / P.ischemiaRiseSeconds);
    else if (distalFlow < 0.25) target = 0.6 * (1 - distalFlow / 0.25);
    const tau = target > this.ischemia ? 3 : P.ischemiaRecoverySeconds;
    this.ischemia += (target - this.ischemia) * (1 - Math.exp(-dt / tau));
    this.chestPain = this.ischemia > 0.35;

    const prolonged = this.occlusionSeconds > P.ectopySeconds;
    const danger = this.occlusionSeconds > P.dangerSeconds;
    this.ectopyRate = danger ? 18 : prolonged ? 8 : this.ischemia > 0.8 ? 2 : 0;
    this.unstable = danger || (prolonged && this.sys < 95);

    const jitter = Math.sin(this.t * 0.37) * 1.5 + Math.sin(this.t * 1.13) * 0.8;
    const hrTarget = P.baselineHR + 14 * this.ischemia + (danger ? 18 : 0) + jitter;
    const sysTarget = P.baselineSys - (prolonged ? 22 : 0) - (danger ? 20 : 0) - 8 * this.ischemia + jitter * 1.4;
    const diaTarget = P.baselineDia - (prolonged ? 12 : 0) - (danger ? 10 : 0) + jitter * 0.6;
    const k = 1 - Math.exp(-dt / 2.5);
    this.hr += (hrTarget - this.hr) * k;
    this.sys += (sysTarget - this.sys) * k;
    this.dia += (diaTarget - this.dia) * k;
    this.spo2 += ((danger ? 94 : P.spo2) - this.spo2) * k;

    const actTarget = heparin ? P.actHeparin : P.actBaseline;
    this.act += (actTarget - this.act) * (1 - Math.exp(-dt / 20));
  }
}

/**
 * Synthetic chest lead (V2) ECG, in mV, at cardiac phase `phase` (0 = R wave peak).
 * `stMm` lifts the ST segment and the T wave (1 mm = 0.1 mV). A premature ventricular beat is
 * wide, tall and has no P wave.
 */
export function ecgSample(phase: number, stMm: number, pvc = false): number {
  const g = (x: number, mu: number, sd: number) => Math.exp(-(((x - mu) / sd) ** 2) / 2);
  // Work in a centred phase so the QRS straddles 0.
  const x = phase > 0.75 ? phase - 1 : phase;
  const st = stMm * 0.1;
  if (pvc) {
    return 1.4 * g(x, 0.0, 0.035) - 0.9 * g(x, 0.07, 0.04) - 0.5 * g(x, 0.28, 0.07);
  }
  const p = 0.12 * g(x, -0.17, 0.025);
  const q = -0.12 * g(x, -0.025, 0.008);
  const r = 1.1 * g(x, 0, 0.011);
  const s = -0.35 * g(x, 0.028, 0.01);
  // ST segment: from the J point to the T wave. Elevation merges into a tall, broad T.
  const stSeg = st * smooth(x, 0.04, 0.07) * (1 - smooth(x, 0.3, 0.42));
  const t = (0.3 + st * 0.6) * g(x, 0.26, 0.05);
  return p + q + r + s + stSeg + t;
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
