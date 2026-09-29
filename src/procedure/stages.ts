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
  /** Fluoro used while the guide was in the aorta. */
  fluoroInAorta: boolean;
  selectiveAngios: number;
  activeTool: string;
  // Filled in by later milestones (balloon, stent, final angiography).
  balloon: { positioned: boolean; inflatedOverLesion: boolean; deflatedAfterInflation: boolean };
  stent: { sized: boolean; positioned: boolean; deployed: boolean };
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
  },
  {
    id: 'wire',
    title: 'Cross the LAD lesion with the guidewire',
    goal: 'Steer the 0.014" wire into the LAD, cross the tight lesion gently and park the tip in the distal LAD.',
    subtasks: [
      { id: 'lm', label: 'Advance the wire out of the guide', check: (c) => c.wire.out },
      { id: 'lad', label: 'Steer into the LAD (not the circumflex)', check: (c) => c.wire.vessel === 'lad' },
      { id: 'cross', label: 'Cross the lesion gently', check: (c) => c.wire.crossed },
      { id: 'distal', label: 'Park the tip in the distal LAD', check: (c) => c.wire.distal },
    ],
    hint: (c) => {
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
  },
  {
    id: 'predilate',
    title: 'Pre-dilate with the balloon',
    goal: 'Prepare the lesion so the stent can expand fully.',
    subtasks: [
      { id: 'bpos', label: 'Position the balloon across the lesion', check: (c) => c.balloon.positioned },
      { id: 'binf', label: 'Inflate over the lesion', check: (c) => c.balloon.inflatedOverLesion },
      { id: 'bdef', label: 'Deflate and check the result', check: (c) => c.balloon.deflatedAfterInflation },
    ],
    hint: () => 'Balloon tools arrive in milestone 4.',
  },
  {
    id: 'stent',
    title: 'Deploy the stent',
    goal: 'Size the stent to the vessel, cover the whole lesion and deploy at adequate pressure.',
    subtasks: [
      { id: 'ssize', label: 'Choose a stent size', check: (c) => c.stent.sized },
      { id: 'spos', label: 'Position the stent to cover the lesion', check: (c) => c.stent.positioned },
      { id: 'sdep', label: 'Deploy with pressure', check: (c) => c.stent.deployed },
    ],
    hint: () => 'Stent tools arrive in milestone 4.',
  },
  {
    id: 'final',
    title: 'Final angiogram',
    goal: 'Confirm brisk flow down the LAD and a good stent result.',
    subtasks: [
      { id: 'fangio', label: 'Inject contrast and check the flow', check: (c) => c.angiosAfterStent > 0 },
      { id: 'fview', label: 'Confirm in a second projection', check: (c) => c.projectionsAfterStent > 1 },
    ],
    hint: () => 'Final angiography arrives in milestone 4.',
  },
];
