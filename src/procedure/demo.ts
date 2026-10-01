import type { VesselTree } from '../anatomy/vesselTree';
import { angleDiff } from '../physics/guideCatheter';
import { branchAngle } from '../physics/guidewire';
import type { BalloonCatheter } from '../physics/balloon';
import type { DeviceController } from '../tools/deviceController';
import type { ToolId } from '../tools/tools';
import type { AutoInput } from '../ui/input';

/** What the autopilot can do: the same actions a learner has. */
export interface DemoHost {
  devices: DeviceController;
  vessels: VesselTree;
  selectTool(id: ToolId): void;
  inject(): void;
  bolusActive(): boolean;
  setPedal(down: boolean): void;
  setProjection(index: number): void;
  setView(view: '3d' | 'fluoro'): void;
  giveHeparin(): void;
  setSize(kind: 'balloon' | 'stent', d: number, l: number): void;
  requestDeflate(): void;
}

interface Step {
  say: string;
  /** Called every frame; returns true when the step is finished. */
  run(h: DemoHost, a: AutoInput, t: number): boolean;
  enter?(h: DemoHost): void;
}

const idle = (a: AutoInput) => Object.assign(a, { advance: 0, rotate: 0, fine: false, inflate: false });

/** Turn towards a target angle; returns true once within `tol` degrees. */
function steer(a: AutoInput, current: number, target: number, tol = 4): boolean {
  const e = angleDiff(current, target);
  if (Math.abs(e) <= tol) {
    a.rotate = 0;
    return true;
  }
  a.rotate = e > 0 ? -1 : 1;
  a.fine = Math.abs(e) < 20;
  return false;
}

/** Slide a balloon catheter so its working length is centred on the lesion. */
function centreOnLesion(h: DemoHost, c: BalloonCatheter, a: AutoInput): boolean {
  const d = h.devices;
  const span = d.span(c);
  const les = d.lesionSpan;
  const target = (les.start + les.end) / 2;
  if (!span) {
    a.advance = 1;
    return false;
  }
  const err = target - (span.start + span.end) / 2;
  if (Math.abs(err) < 0.4) {
    a.advance = 0;
    return true;
  }
  a.advance = Math.sign(err);
  a.fine = Math.abs(err) < 4;
  return false;
}

const wait = (seconds: number) => (_h: DemoHost, _a: AutoInput, t: number) => t >= seconds;

/** Index of the size closest to a wanted value. */
const nearest = (vals: number[], want: number) => vals.reduce((best, v, i) => (Math.abs(v - want) < Math.abs(vals[best] - want) ? i : best), 0);

const STEPS: Step[] = [
  {
    say: 'Demo: the 6F guide catheter goes in through the right radial sheath and up the arm.',
    enter: (h) => {
      h.selectTool('guide');
      h.setView('3d');
    },
    run: (h, a) => {
      a.advance = 1;
      return h.devices.guide.inAorta;
    },
  },
  {
    say: 'Into the aorta. Short fluoro taps confirm where the tip is as it comes down to the aortic root.',
    run: (h, a, t) => {
      a.advance = 1;
      h.setPedal(t % 1.5 < 0.6);
      if (h.devices.guide.atRoot) {
        h.setPedal(false);
        return true;
      }
      return false;
    },
  },
  {
    say: 'At the root, the curved tip is rotated until it faces the left coronary cusp.',
    run: (h, a) => {
      a.advance = 0;
      return steer(a, h.devices.guide.rotation, 0, 3);
    },
  },
  {
    say: 'A gentle push seats the guide in the left main ostium.',
    run: (h, a) => {
      a.rotate = 0;
      a.advance = 1;
      a.fine = true;
      return h.devices.guide.engaged;
    },
  },
  {
    say: 'Diagnostic angiogram in RAO 30° cranial 30°: the tight mid-LAD lesion appears as a narrow waist.',
    enter: (h) => {
      h.setProjection(0);
      h.inject();
    },
    run: (h, _a, t) => t > 1 && !h.bolusActive(),
  },
  {
    say: 'Heparin goes in before any wire enters the coronary artery (target ACT 250–300 s).',
    enter: (h) => h.giveHeparin(),
    run: wait(2),
  },
  {
    say: 'The 0.014" wire is steered into the LAD, away from the circumflex and the diagonals, and crosses the lesion slowly.',
    enter: (h) => {
      h.selectTool('wire');
      h.setView('3d');
    },
    run: (h, a) => {
      const w = h.devices.wire;
      const tip = w.tip;
      const lm = h.vessels.get('lm')!;
      const lad = h.vessels.get('lad')!;
      if (tip && tip.vessel.spec.id !== 'lm' && tip.vessel.spec.id !== 'lad') {
        a.advance = -1; // wrong branch: back out and try again
        return false;
      }
      let target = w.rotation;
      if (!tip || tip.vessel === lm) target = branchAngle(lm, lad);
      else {
        const next = lad.children.find((c) => {
          const dist = (c.spec.joins!.at - tip.u) * lad.length;
          return dist > -1 && dist < 15;
        });
        if (next) target = branchAngle(lad, next) + 180;
      }
      if (!steer(a, w.rotation, target, 8)) {
        a.advance = 0;
        return false;
      }
      a.advance = w.inLesion ? 0.2 : 1;
      a.fine = w.inLesion;
      return w.distal && tip !== null && tip.u > 0.8;
    },
  },
  {
    say: 'A 2.5 × 15 mm balloon is advanced over the wire until its markers straddle the lesion.',
    enter: (h) => {
      h.selectTool('balloon');
      h.setSize('balloon', nearest(h.devices.balloon.spec.diameters, 2.5), nearest(h.devices.balloon.spec.lengths, 15));
      h.setView('fluoro');
      h.setPedal(true);
    },
    run: (h, a) => centreOnLesion(h, h.devices.balloon, a),
  },
  {
    say: 'Inflating to 10 atm. The LAD is blocked: watch ST elevation develop on the monitor.',
    enter: (h) => h.setView('3d'),
    run: (h, a, t) => {
      h.setPedal(false);
      a.advance = 0;
      a.fine = false;
      a.inflate = h.devices.balloon.pressure < 10;
      return t > 12;
    },
  },
  {
    say: 'Deflate. Flow returns and the ST segments settle back to baseline.',
    enter: (h) => h.requestDeflate(),
    run: (h, _a, t) => t > 3 && h.devices.balloon.pressure === 0,
  },
  {
    say: 'The balloon comes back into the guide.',
    run: (h, a) => {
      a.advance = -1;
      return !h.devices.balloon.out;
    },
  },
  {
    say: 'QCA: the reference diameter is about 2.9 mm and the lesion about 13 mm long, so a 3.0 × 18 mm stent fits.',
    enter: (h) => h.selectTool('measure'),
    run: wait(4),
  },
  {
    say: 'The 3.0 × 18 mm drug-eluting stent is positioned to cover the lesion with healthy vessel at both ends.',
    enter: (h) => {
      h.selectTool('stent');
      h.setSize('stent', nearest(h.devices.stentSys.spec.diameters, 3.0), nearest(h.devices.stentSys.spec.lengths, 18));
      h.setView('fluoro');
      h.setPedal(true);
    },
    run: (h, a) => centreOnLesion(h, h.devices.stentSys, a),
  },
  {
    say: 'Deploying at 12 atm, just above nominal pressure, for a few seconds.',
    enter: (h) => h.setView('3d'),
    run: (h, a, t) => {
      h.setPedal(false);
      a.advance = 0;
      a.fine = false;
      a.inflate = h.devices.stentSys.pressure < 12;
      return t > 8;
    },
  },
  {
    say: 'Deflate and withdraw the delivery balloon. The stent stays behind, holding the artery open.',
    enter: (h) => h.requestDeflate(),
    run: (h, a, t) => {
      if (t < 2.5 || h.devices.stentSys.pressure > 0) return false;
      a.advance = -1;
      return !h.devices.stentSys.out;
    },
  },
  {
    say: 'Final angiogram: brisk TIMI 3 flow through the stented segment.',
    enter: (h) => h.inject(),
    run: (h, _a, t) => t > 1 && !h.bolusActive(),
  },
  {
    say: 'A second, orthogonal projection (LAO 45° cranial 30°) checks the stent edges.',
    enter: (h) => {
      h.setProjection(2);
      h.inject();
    },
    run: (h, _a, t) => t > 1 && !h.bolusActive(),
  },
];

/**
 * Scripted autopilot for the whole case. It drives the devices through the same input path as the
 * learner, so everything it does obeys the simulator's rules. Any user input hands control back.
 */
export class DemoPilot {
  active = false;
  private index = 0;
  private t = 0;
  private entered = -1;
  readonly auto: AutoInput = { advance: 0, rotate: 0, fine: false, inflate: false };

  get text(): string | null {
    return this.active ? STEPS[this.index]?.say ?? null : null;
  }

  get finished(): boolean {
    return this.index >= STEPS.length;
  }

  start(): void {
    this.active = true;
    this.index = 0;
    this.t = 0;
    this.entered = -1;
  }

  stop(): void {
    this.active = false;
    idle(this.auto);
  }

  /** Advance the script. Returns the step text when a new step begins. */
  update(dt: number, h: DemoHost): string | null {
    if (!this.active) return null;
    const step = STEPS[this.index];
    if (!step) {
      this.stop();
      return null;
    }
    let said: string | null = null;
    if (this.entered !== this.index) {
      this.entered = this.index;
      this.t = 0;
      idle(this.auto);
      step.enter?.(h);
      said = step.say;
    }
    this.t += dt;
    if (step.run(h, this.auto, this.t)) {
      idle(this.auto);
      this.index++;
    }
    return said;
  }
}
