import type { DeviceController } from '../tools/deviceController';
import type { ProcedureContext } from './stages';

export interface InflationRecord {
  kind: 'balloon' | 'stent';
  nominal: number;
  peakAtm: number;
  peakDiameter: number;
  seconds: number;
  /** Fraction of the lesion covered by the balloon's working length. */
  lesionOverlap: number;
}

/** Things that happened during the procedure (not derivable from device positions). */
export class ProcedureLog {
  fluoroInAorta = false;
  selectiveAngios = 0;
  aorticFlushes = 0;
  angiosAfterStent = 0;
  private readonly projectionsAfterStent = new Set<string>();
  stentDeployed = false;
  heparinGiven = false;
  /** QCA used on the lesion after a diagnostic angiogram. */
  measured = false;
  predilated = false;
  predilationBalloon: number | null = null;
  readonly inflations: InflationRecord[] = [];
  dissectionCause: string | null = null;
  balloonRupture = false;

  recordFluoro(devices: DeviceController): void {
    if (devices.guide.inAorta) this.fluoroInAorta = true;
  }

  recordInjection(selective: boolean, projection: string): void {
    if (!selective) {
      this.aorticFlushes++;
      return;
    }
    this.selectiveAngios++;
    if (this.stentDeployed) {
      this.angiosAfterStent++;
      this.projectionsAfterStent.add(projection);
    }
  }

  recordInflation(r: InflationRecord): void {
    this.inflations.push(r);
    if (r.kind === 'balloon' && r.lesionOverlap >= 0.5 && r.peakAtm >= 6) {
      this.predilated = true;
      this.predilationBalloon = Math.max(this.predilationBalloon ?? 0, r.nominal);
    }
  }

  get longestInflation(): number {
    return this.inflations.reduce((m, r) => Math.max(m, r.seconds), 0);
  }

  get projectionCountAfterStent(): number {
    return this.projectionsAfterStent.size;
  }
}

/** Capture the current procedure state for the stage system. */
export function buildContext(d: DeviceController, log: ProcedureLog): ProcedureContext {
  const g = d.guide;
  const w = d.wire;
  let zone: ProcedureContext['guide']['zone'] = 'sheath';
  if (g.engaged) zone = 'engaged';
  else if (g.atRoot) zone = 'root';
  else if (g.inAorta) zone = 'aorta';
  else if (g.inserted > 2) zone = 'arm';

  const facingText = g.facing();
  const facing = !g.inAorta
    ? 'none'
    : facingText === 'Left coronary cusp'
      ? 'left'
      : facingText === 'Right coronary cusp'
        ? 'right'
        : 'wall';

  const access = d.guide.baseRoute.segs[0].vessel;
  const up = w.upcomingBranch();
  const b = d.balloon;
  const s = d.stentSys;
  const bCov = d.lesionCoverage(b);
  const sCov = d.lesionCoverage(s);
  return {
    guide: {
      zone,
      // The elbow is roughly 30% of the way along the access path.
      pastElbow: g.inserted > access.length * 0.3,
      facing,
      engaged: g.engaged,
    },
    wire: {
      out: w.out > 0,
      vessel: w.tip?.vessel.spec.id ?? null,
      inLesion: w.inLesion,
      crossed: w.crossed,
      distal: w.distal,
      upcoming: up ? { name: up.name, pointing: up.pointing } : null,
    },
    heparin: log.heparinGiven,
    fluoroInAorta: log.fluoroInAorta,
    selectiveAngios: log.selectiveAngios,
    activeTool: d.activeTool,
    balloon: {
      out: b.out,
      positioned: b.out && !!bCov && bCov.overlap >= 0.6,
      margin: bCov ? bCov.distalMargin : null,
      pressure: b.pressure,
      inflatedOverLesion: log.predilated,
      deflatedAfterInflation: log.predilated && !b.inflated,
    },
    stent: {
      out: s.out,
      sized: log.measured && (s.out || log.stentDeployed),
      measured: log.measured,
      positioned: log.stentDeployed || (s.out && !!sCov && sCov.covers),
      proximalMargin: sCov ? sCov.proximalMargin : null,
      distalMargin: sCov ? sCov.distalMargin : null,
      pressure: s.pressure,
      deployed: log.stentDeployed && !s.inflated,
    },
    angiosAfterStent: log.angiosAfterStent,
    projectionsAfterStent: log.projectionCountAfterStent,
  };
}
