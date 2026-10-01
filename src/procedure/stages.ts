import type { VesselId } from '../config/anatomy';

/**
 * Everything the stage system needs to know about the procedure, captured once per frame.
 * Kept as plain data (no Three.js) so stage logic is easy to unit test.
 */
export interface ProcedureContext {
  guide: {
    /** sheath → arm → aorta → root → engaged */
    zone: 'sheath' | 'arm' | 'aorta' | 'root' | 'engaged';
    /** Past the elbow (in the brachial artery or beyond). */
    pastElbow: boolean;
    facing: 'left' | 'right' | 'wall' | 'none';
    engaged: boolean;
  };
  wire: {
    out: boolean;
    vessel: VesselId | null;
    inLesion: boolean;
    crossed: boolean;
    distal: boolean;
    /** Next branch hint from the wire model, if any. */
    upcoming: { name: string; pointing: boolean } | null;
  };
  /** Heparin given (anticoagulation for coronary instrumentation). */
  heparin: boolean;
  /** Fluoro used while the guide was in the aorta. */
  fluoroInAorta: boolean;
  selectiveAngios: number;
  activeTool: string;
  balloon: {
    out: boolean;
    positioned: boolean;
    /** Distal marker beyond the distal lesion edge (mm); negative = not far enough. */
    margin: number | null;
    pressure: number;
    inflatedOverLesion: boolean;
    deflatedAfterInflation: boolean;
  };
  stent: {
    out: boolean;
    measured: boolean;
    sized: boolean;
    positioned: boolean;
    proximalMargin: number | null;
    distalMargin: number | null;
    pressure: number;
    deployed: boolean;
  };
  angiosAfterStent: number;
  projectionsAfterStent: number;
}

export interface SubTask {
  id: string;
  label: string;
  check: (c: ProcedureContext) => boolean;
}

export interface StageDef {
  id: string;
  title: string;
  /** One calm sentence describing the goal of the stage. */
  goal: string;
  subtasks: SubTask[];
  /** Short, situation-specific guidance for the mentor panel. */
  hint: (c: ProcedureContext) => string;
  /** Why this step matters (shown under "Why?" in the mentor). */
  teach: string;
}

export const STAGES: StageDef[] = [
  {
    id: 'access',
    title: 'Advance the guide to the aortic root',
    goal: 'Bring the 6F guide catheter from the right radial artery up the arm and down to the aortic root.',
    subtasks: [
      { id: 'arm', label: 'Advance up the radial and brachial arteries', check: (c) => c.guide.pastElbow },
      { id: 'aorta', label: 'Enter the aorta through the brachiocephalic trunk', check: (c) => ['aorta', 'root', 'engaged'].includes(c.guide.zone) },
      { id: 'fluoro', label: 'Watch the tip on fluoroscopy (hold Space)', check: (c) => c.fluoroInAorta },
      { id: 'root', label: 'Bring the tip down to the aortic root', check: (c) => c.guide.zone === 'root' || c.guide.zone === 'engaged' },
    ],
    hint: (c) => {
      if (c.activeTool !== 'guide') return 'Select the guide catheter (1).';
      switch (c.guide.zone) {
        case 'sheath':
          return 'The radial sheath is in place. Advance the guide with W or the mouse wheel.';
        case 'arm':
          return 'Keep advancing. The catheter follows the brachial and subclavian arteries towards the chest.';
        case 'aorta':
          return c.fluoroInAorta
            ? 'You are in the aorta. Continue down the ascending aorta to the root.'
            : 'You are in the aorta. Tap the fluoro pedal (Space) to see where the tip is.';
        default:
          return c.fluoroInAorta ? 'The tip is at the root.' : 'The tip is at the root. Take a look on fluoro (Space).';
      }
    },
    teach:
      'Radial access (the wrist) causes fewer bleeding complications than femoral access and lets the patient sit up straight away. The guide catheter is the highway every other device travels through, so its position matters for the whole case.',
  },
  {
    id: 'engage',
    title: 'Engage the left main',
    goal: 'Turn the curved tip towards the left coronary cusp, seat it in the left main, then take a diagnostic angiogram.',
    subtasks: [
      { id: 'face', label: 'Rotate the tip to face the left coronary cusp', check: (c) => c.guide.facing === 'left' || c.guide.engaged },
      { id: 'engage', label: 'Advance gently to seat the guide', check: (c) => c.guide.engaged },
      { id: 'angio', label: 'Take a diagnostic angiogram (5) to see the lesion', check: (c) => c.guide.engaged && c.selectiveAngios > 0 },
    ],
    hint: (c) => {
      if (c.guide.engaged) {
        return c.selectiveAngios > 0
          ? 'Nicely done. The lesion is in the mid LAD, between the first and second diagonals.'
          : 'Seated. Inject contrast (5) to see the coronary anatomy. RAO cranial lays out the mid LAD well.';
      }
      if (c.activeTool !== 'guide') return 'Select the guide catheter (1).';
      if (c.guide.zone !== 'root') return 'Bring the tip back down to the aortic root first.';
      if (c.guide.facing === 'left') return 'Good alignment. Advance gently to engage the ostium.';
      if (c.guide.facing === 'right') return 'That is the right coronary cusp. Keep rotating towards the left cusp.';
      return 'Rotate slowly with A/D. The green mark on the dial is the left cusp; watch the tip swing on fluoro.';
    },
    teach:
      'The left main arises from the left coronary sinus of the aortic root. A coaxial (well aligned) guide gives support for pushing devices and safe contrast injections. The diagnostic angiogram shows where the lesion is and how tight it is before anything enters the artery.',
  },
  {
    id: 'wire',
    title: 'Cross the LAD lesion with the guidewire',
    goal: 'Steer the 0.014" wire into the LAD, cross the tight lesion gently and park the tip in the distal LAD.',
    subtasks: [
      { id: 'heparin', label: 'Give heparin before wiring (G)', check: (c) => c.heparin },
      { id: 'lm', label: 'Advance the wire out of the guide', check: (c) => c.wire.out },
      { id: 'lad', label: 'Steer into the LAD (not the circumflex)', check: (c) => c.wire.vessel === 'lad' },
      { id: 'cross', label: 'Cross the lesion gently', check: (c) => c.wire.crossed },
      { id: 'distal', label: 'Park the tip in the distal LAD', check: (c) => c.wire.distal },
    ],
    hint: (c) => {
      if (!c.heparin) return 'Before any wire enters the coronary, anticoagulate: press G (or the Heparin button) to give 70–100 U/kg of heparin.';
      if (c.activeTool !== 'wire') return 'Switch to the guidewire (2).';
      const w = c.wire;
      if (!w.out) return 'Advance the wire out of the guide into the left main.';
      if (w.vessel === 'lcx' || w.vessel === 'd1' || w.vessel === 'd2') {
        return 'The wire has gone into a side branch. Pull back (S) past the junction, rotate, and try again.';
      }
      if (w.inLesion) return 'Slow down. Hold Shift and advance gently; a little torque (A/D) helps.';
      if (w.upcoming) {
        const lad = /anterior descending/.test(w.upcoming.name);
        if (lad) return 'The LM bifurcation is ahead. The tip is lined up for the LAD. Advance.';
        if (/circumflex/.test(w.upcoming.name)) return 'The tip is aimed at the circumflex. Rotate before you reach the bifurcation.';
        return w.upcoming.pointing
          ? `The tip is pointing into ${w.upcoming.name}. Rotate away before advancing.`
          : `Passing ${w.upcoming.name}. The tip is pointing away from it. Keep going.`;
      }
      if (w.crossed && !w.distal) return 'Across the lesion. Keep advancing into the distal LAD for good support.';
      if (w.distal) return 'Wire position is stable in the distal LAD.';
      return 'Advance steadily down the LAD towards the lesion.';
    },
    teach:
      'Heparin comes first: a wire in a coronary artery is a surface for clot to form on (target ACT 250–300 s). The soft 0.014" wire is steered with small twists of its bent tip. Parking it far down the LAD gives a stable rail for the balloon and stent.',
  },
  {
    id: 'predilate',
    title: 'Pre-dilate with the balloon',
    goal: 'Prepare the lesion with a balloon slightly smaller than the vessel so the stent can expand fully.',
    subtasks: [
      { id: 'bpos', label: 'Position the balloon markers across the lesion', check: (c) => c.balloon.positioned },
      { id: 'binf', label: 'Inflate over the lesion (6 atm or more)', check: (c) => c.balloon.inflatedOverLesion },
      { id: 'bdef', label: 'Deflate and check the result', check: (c) => c.balloon.deflatedAfterInflation },
    ],
    hint: (c) => {
      const b = c.balloon;
      if (b.inflatedOverLesion) {
        return b.pressure > 0.3 ? 'Deflate now (Q). Watch the ST segments return to baseline.' : 'Deflated.';
      }
      if (c.activeTool !== 'balloon') return 'Select the balloon (3). For a vessel of about 3 mm, a 2.0–2.5 mm balloon is a sensible pre-dilation size.';
      if (!b.out) return 'Choose a balloon size in the panel, then advance it over the wire (W).';
      if (b.pressure > 0.3) return 'Inflating: take it to about 8–12 atm (hold E), watch the gauge and the ECG, then deflate (Q) after 10–20 s.';
      if (!b.positioned) {
        if (b.margin !== null && b.margin < 0) return 'Keep advancing. The two radiopaque markers should straddle the lesion.';
        return 'Too far: pull back (S) until the markers straddle the lesion.';
      }
      return 'The markers straddle the lesion. Hold E to inflate; Shift gives fine pressure control.';
    },
    teach:
      'A 90% lesion is too tight for a stent to expand evenly. Pre-dilating with a balloon at about 0.8–1.0 times the vessel diameter cracks the plaque and makes room. While the balloon is up it blocks the LAD completely: chest pain and ST elevation in the anterior leads are expected and should settle after deflation.',
  },
  {
    id: 'stent',
    title: 'Deploy the stent',
    goal: 'Measure the vessel, size the stent to it, cover the whole lesion and deploy at adequate pressure.',
    subtasks: [
      { id: 'ssize', label: 'Measure the vessel (7) and load a stent', check: (c) => c.stent.sized },
      { id: 'spos', label: 'Cover the whole lesion with the stent', check: (c) => c.stent.positioned },
      { id: 'sdep', label: 'Deploy with pressure, then deflate', check: (c) => c.stent.deployed },
    ],
    hint: (c) => {
      const s = c.stent;
      if (!s.measured) return 'Measure the vessel first: select Measure (7) and read the reference diameter and lesion length.';
      if (c.activeTool !== 'stent') return 'Select the stent (4). Diameter about equal to the reference; length covering the lesion plus 2–3 mm each side.';
      if (!s.out && !s.positioned) return 'Choose the stent size in the panel, then advance it over the wire (W).';
      if (s.positioned && s.pressure > 0.3) return 'Stent expanding. Hold at pressure for a few seconds, then deflate (Q).';
      if (s.positioned && s.deployed) return 'Deployed.';
      if (s.positioned) return 'The lesion is covered. Hold E to deploy: at least nominal pressure (10 atm), no more than RBP (16 atm).';
      const p = s.proximalMargin;
      const d = s.distalMargin;
      if (p !== null && d !== null) {
        if (p < 0 && d < 0) return 'The stent is shorter than the lesion. Pull it back into the guide (S) and choose a longer one.';
        if (d < 0) return `Advance ${(-d).toFixed(1)} mm more: the distal end of the lesion is not covered yet.`;
        if (p < 0) return `Pull back ${(-p).toFixed(1)} mm: the proximal end of the lesion is not covered.`;
      }
      return 'Advance the stent towards the lesion.';
    },
    teach:
      'Size the stent 1:1 with the reference (healthy) vessel diameter and choose a length that covers the lesion with 2–3 mm of healthy vessel at each end. Deploy at nominal pressure or higher: under-expansion is a leading cause of stent thrombosis and restenosis. Modern stents are drug-eluting (DES), which greatly reduces re-narrowing.',
  },
  {
    id: 'final',
    title: 'Final angiogram',
    goal: 'Confirm brisk flow down the LAD and a good stent result in two projections.',
    subtasks: [
      { id: 'fangio', label: 'Inject contrast and check the flow', check: (c) => c.angiosAfterStent > 0 },
      { id: 'fview', label: 'Confirm in a second projection (V)', check: (c) => c.projectionsAfterStent > 1 },
    ],
    hint: (c) => {
      if (c.stent.out || c.balloon.out) return 'Pull the balloon back into the guide (S), then inject contrast (5).';
      if (c.angiosAfterStent === 0) return 'Inject contrast (5) and watch how quickly the LAD fills now.';
      return 'Change the projection (V) and inject again. Look for edge dissections and residual narrowing.';
    },
    teach:
      'Check for TIMI 3 flow, less than 10–20% residual narrowing and no dissection at the stent edges, in at least two views. A single projection can hide problems.',
  },
];
