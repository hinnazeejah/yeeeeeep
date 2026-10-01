import { FLOW } from '../config/anatomy';

/**
 * Pure functions that turn device choices and lumen measurements into outcomes.
 * No Three.js and no DOM: everything here is unit tested.
 */

// ---------------------------------------------------------------------------
// Balloons and stents
// ---------------------------------------------------------------------------

export interface ComplianceSpec {
  nominalAtm: number;
  compliancePerAtm: number;
}

/**
 * Diameter a balloon (or stent on its balloon) reaches at a given pressure.
 * Semi-compliant balloons grow roughly linearly with pressure around their nominal size.
 * Below ~2 atm the balloon is still unfolding, so it is smaller than nominal.
 */
export function achievedDiameter(nominal: number, atm: number, spec: ComplianceSpec): number {
  if (atm <= 0) return 0;
  const unfold = Math.min(1, atm / 2);
  const grown = nominal * (1 + spec.compliancePerAtm * (atm - spec.nominalAtm));
  return Math.max(0, grown * (0.35 + 0.65 * unfold));
}

/** Percent diameter stenosis (0..1) from the minimal lumen diameter and the reference diameter. */
export function residualStenosis(mld: number, reference: number): number {
  if (reference <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - mld / reference));
}

/** How well a stent (or balloon) span covers the lesion. Positive margins = beyond the lesion edge. */
export function coverage(
  device: { start: number; end: number },
  lesion: { start: number; end: number },
): { covers: boolean; proximalMargin: number; distalMargin: number; overlap: number } {
  const proximalMargin = lesion.start - device.start;
  const distalMargin = device.end - lesion.end;
  const overlapMm = Math.max(0, Math.min(device.end, lesion.end) - Math.max(device.start, lesion.start));
  return {
    covers: proximalMargin >= 0 && distalMargin >= 0,
    proximalMargin,
    distalMargin,
    overlap: overlapMm / Math.max(1e-6, lesion.end - lesion.start),
  };
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/**
 * Resting flow through a narrowing, as a fraction of normal (1 = unobstructed).
 * Mild and moderate stenoses do not limit resting flow; above ~60% it falls steeply.
 */
export function flowFactor(ds: number): number {
  if (ds <= FLOW.freeDs) return 1;
  if (ds >= FLOW.occludedDs) return 0;
  const t = (ds - FLOW.freeDs) / (FLOW.occludedDs - FLOW.freeDs);
  return Math.max(0, 1 - 0.97 * Math.pow(t, 1.5));
}

/**
 * TIMI flow grade from the flow fraction.
 *   3 = normal, brisk filling and clearing
 *   2 = the whole vessel fills, but slowly
 *   1 = contrast gets past the lesion but does not fill the distal bed
 *   0 = no flow beyond the occlusion
 */
export function timiGrade(factor: number): 0 | 1 | 2 | 3 {
  if (factor >= 0.8) return 3;
  if (factor >= 0.25) return 2;
  if (factor > 0.02) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

export type Status = 'ok' | 'warn' | 'bad';

export interface ProcedureSummary {
  finished: boolean;
  /** Reference (healthy) vessel diameter at the lesion (mm): what the stent should match. */
  referenceDiameter: number;
  /** Final diameter stenosis in the treated segment (0..1, from QCA). */
  residual: number;
  /** Final flow fraction down the LAD (see flowFactor). */
  finalFlow: number;
  heparinGiven: boolean;
  measured: boolean;
  predilated: boolean;
  /** Largest pre-dilation balloon diameter used (nominal, mm), if any. */
  predilationBalloon: number | null;
  stents: { nominal: number; length: number; achieved: number; proximalMargin: number; distalMargin: number }[];
  /** Longest single continuous balloon occlusion of the LAD (s). */
  longestInflation: number;
  dissection: { cause: string; sealed: boolean } | null;
  balloonRupture: boolean;
  wireForcingSeconds: number;
  fluoroSeconds: number;
  contrastMl: number;
  totalSeconds: number;
  finalViews: number;
}

export interface DebriefItem {
  label: string;
  value: string;
  status: Status;
  /** One or two sentences on why this matters. */
  teach: string;
}

export interface Debrief {
  score: number;
  grade: 'Excellent' | 'Good' | 'Acceptable' | 'Needs work' | 'Incomplete';
  headline: string;
  items: DebriefItem[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mm = (x: number) => `${x.toFixed(1)} mm`;

export function buildDebrief(s: ProcedureSummary): Debrief {
  const items: DebriefItem[] = [];
  let score = 100;
  const penalise = (n: number) => (score -= n);

  // --- Result --------------------------------------------------------------
  const rs = Math.max(0, Math.min(1, s.residual));
  const rsStatus: Status = rs <= 0.1 ? 'ok' : rs <= 0.3 ? 'warn' : 'bad';
  if (rsStatus === 'warn') penalise(10);
  if (rsStatus === 'bad') penalise(30);
  items.push({
    label: 'Residual stenosis',
    value: pct(rs),
    status: rsStatus,
    teach:
      'After stenting, aim for less than 10–20% residual narrowing. A larger residual usually means an undersized or under-expanded stent, or part of the lesion left uncovered.',
  });

  const timi = timiGrade(s.finalFlow);
  const timiStatus: Status = timi === 3 ? 'ok' : timi === 2 ? 'warn' : 'bad';
  if (timiStatus === 'warn') penalise(10);
  if (timiStatus === 'bad') penalise(25);
  items.push({
    label: 'Final flow',
    value: `TIMI ${timi}`,
    status: timiStatus,
    teach:
      'TIMI 3 means contrast fills and clears the distal vessel briskly. TIMI 2 or less after PCI points to a problem: residual narrowing, a dissection, or distal embolisation (no-reflow).',
  });

  // --- Stent sizing ---------------------------------------------------------
  if (s.stents.length === 0) {
    items.push({
      label: 'Stent',
      value: 'Not deployed',
      status: 'bad',
      teach: 'Balloon angioplasty alone recoils and re-narrows. Drug-eluting stents are the standard for a lesion like this.',
    });
    penalise(25);
  } else {
    const st = s.stents[0];
    const ratio = st.achieved / s.referenceDiameter;
    const sizeStatus: Status = ratio >= 0.95 && ratio <= 1.15 ? 'ok' : ratio >= 0.85 && ratio <= 1.25 ? 'warn' : 'bad';
    if (sizeStatus === 'warn') penalise(8);
    if (sizeStatus === 'bad') penalise(18);
    items.push({
      label: 'Stent diameter',
      value: `${st.nominal.toFixed(2)} mm nominal → ${mm(st.achieved)} (${Math.round(ratio * 100)}% of reference ${mm(s.referenceDiameter)})`,
      status: sizeStatus,
      teach:
        ratio < 0.95
          ? 'Undersized: the stent is smaller than the vessel. Struts may not touch the wall (malapposition), which raises the risk of stent thrombosis and restenosis. Size 1:1 to the reference diameter or post-dilate.'
          : ratio > 1.15
            ? 'Oversized: stretching the artery well beyond its reference diameter risks edge dissection and, rarely, perforation.'
            : 'Well sized: the stent matches the reference vessel diameter (about 1:1).',
    });
    const minMargin = Math.min(...s.stents.map((x) => Math.min(x.proximalMargin, x.distalMargin)));
    const miss = s.stents.every((x) => x.proximalMargin < 0 || x.distalMargin < 0);
    const covStatus: Status = miss ? 'bad' : minMargin >= 1.5 ? 'ok' : 'warn';
    if (covStatus === 'warn') penalise(5);
    if (covStatus === 'bad') penalise(20);
    items.push({
      label: 'Lesion coverage',
      value: `Proximal ${st.proximalMargin >= 0 ? '+' : ''}${mm(st.proximalMargin)}, distal ${st.distalMargin >= 0 ? '+' : ''}${mm(st.distalMargin)}`,
      status: covStatus,
      teach:
        'Cover the lesion from healthy segment to healthy segment, about 2–3 mm beyond each edge. Leaving diseased edges uncovered ("geographic miss") increases restenosis at the stent edges.',
    });
    if (s.stents.length > 1) {
      items.push({
        label: 'Stents used',
        value: String(s.stents.length),
        status: 'warn',
        teach: 'A second stent was needed. Careful sizing and positioning of the first stent usually avoids this.',
      });
      penalise(5);
    }
  }

  // --- Preparation -----------------------------------------------------------
  items.push({
    label: 'Anticoagulation',
    value: s.heparinGiven ? 'Heparin given before wiring' : 'Not given',
    status: s.heparinGiven ? 'ok' : 'bad',
    teach: 'Unfractionated heparin (70–100 U/kg, target ACT 250–300 s) prevents thrombus forming on the wire and devices in the coronary artery.',
  });
  if (!s.heparinGiven) penalise(20);

  items.push({
    label: 'Pre-dilation',
    value: s.predilated ? `Yes, ${s.predilationBalloon?.toFixed(1)} mm balloon` : 'No',
    status: s.predilated ? 'ok' : 'warn',
    teach:
      'Pre-dilating a tight lesion with a balloon slightly smaller than the vessel (about 0.8–1.0 : 1) makes room for the stent to cross and expand fully.',
  });

  items.push({
    label: 'Sizing with QCA',
    value: s.measured ? 'Vessel measured before choosing the stent' : 'Stent chosen by eye',
    status: s.measured ? 'ok' : 'warn',
    teach: 'Quantitative coronary angiography (or intravascular imaging) gives the reference diameter and lesion length. Visual estimates are often off by 0.5 mm or more.',
  });
  if (!s.measured) penalise(3);

  // --- Complications and safety --------------------------------------------
  if (s.dissection) {
    items.push({
      label: 'Dissection',
      value: `${s.dissection.cause}; ${s.dissection.sealed ? 'sealed with a stent' : 'NOT covered'}`,
      status: s.dissection.sealed ? 'warn' : 'bad',
      teach:
        'A dissection is a tear in the vessel wall. On angiography it shows as a linear filling defect or contrast staining. A flow-limiting dissection must be covered with a stent to prevent abrupt vessel closure.',
    });
    penalise(s.dissection.sealed ? 8 : 25);
  }
  if (s.wireForcingSeconds > 1) {
    items.push({
      label: 'Wire handling',
      value: `Wire forced against resistance for ${s.wireForcingSeconds.toFixed(0)} s`,
      status: 'warn',
      teach: 'When a wire buckles, stop pushing. Pull back slightly, re-torque the tip and advance gently; forcing it can enter the vessel wall and cause a dissection.',
    });
    penalise(4);
  }
  if (s.balloonRupture) {
    items.push({
      label: 'Balloon rupture',
      value: 'Inflated beyond rated burst pressure',
      status: 'bad',
      teach: 'Stay at or below the rated burst pressure (RBP) printed on the balloon. A rupture can tear the artery.',
    });
    penalise(10);
  }
  const inflStatus: Status = s.longestInflation <= 30 ? 'ok' : s.longestInflation <= 60 ? 'warn' : 'bad';
  if (inflStatus === 'warn') penalise(5);
  if (inflStatus === 'bad') penalise(12);
  items.push({
    label: 'Longest inflation',
    value: `${s.longestInflation.toFixed(0)} s`,
    status: inflStatus,
    teach:
      'A balloon inflated in the LAD blocks all flow to the front wall. ST elevation and chest pain within seconds are expected. Keep inflations short (typically 10–30 s) and deflate if the patient becomes unstable.',
  });

  const ctStatus: Status = s.contrastMl <= 120 ? 'ok' : s.contrastMl <= 200 ? 'warn' : 'bad';
  if (ctStatus === 'warn') penalise(3);
  if (ctStatus === 'bad') penalise(8);
  items.push({
    label: 'Contrast',
    value: `${s.contrastMl} ml`,
    status: ctStatus,
    teach: 'Iodinated contrast can injure the kidneys (contrast-associated AKI). Use as little as needed, especially if kidney function is reduced.',
  });

  const flStatus: Status = s.fluoroSeconds <= 600 ? 'ok' : s.fluoroSeconds <= 1200 ? 'warn' : 'bad';
  if (flStatus !== 'ok') penalise(flStatus === 'warn' ? 3 : 6);
  items.push({
    label: 'Fluoroscopy time',
    value: `${Math.floor(s.fluoroSeconds / 60)} min ${Math.round(s.fluoroSeconds % 60)} s`,
    status: flStatus,
    teach: 'X-ray dose to the patient and the team rises with fluoro time. Step on the pedal only when you need to see (ALARA: as low as reasonably achievable).',
  });

  items.push({
    label: 'Final angiogram',
    value: s.finalViews >= 2 ? `${s.finalViews} projections` : s.finalViews === 1 ? 'One projection only' : 'Not taken',
    status: s.finalViews >= 2 ? 'ok' : 'warn',
    teach: 'Check the result in at least two different projections. A single view can hide an edge dissection or residual narrowing.',
  });
  if (s.finalViews < 2) penalise(4);

  score = Math.max(0, Math.min(100, Math.round(score)));
  let grade: Debrief['grade'] = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 55 ? 'Acceptable' : 'Needs work';
  if (!s.finished) grade = 'Incomplete';

  let headline: string;
  if (!s.finished) headline = 'The procedure was ended before all steps were completed.';
  else if (rsStatus === 'ok' && timi === 3) headline = `Successful PCI of the mid LAD: ${pct(rs)} residual stenosis with TIMI 3 flow.`;
  else headline = `PCI completed with a suboptimal result: ${pct(rs)} residual stenosis, TIMI ${timi} flow.`;

  return { score, grade, headline, items };
}
