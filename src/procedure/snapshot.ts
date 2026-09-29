import type { DeviceController } from '../tools/deviceController';
import type { ProcedureContext } from './stages';

/** Things that happened during the procedure (not derivable from device positions). */
export class ProcedureLog {
  fluoroInAorta = false;
  selectiveAngios = 0;
  aorticFlushes = 0;
  angiosAfterStent = 0;
  private readonly projectionsAfterStent = new Set<string>();
  stentDeployed = false;

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
    fluoroInAorta: log.fluoroInAorta,
    selectiveAngios: log.selectiveAngios,
    activeTool: d.activeTool,
    balloon: { positioned: false, inflatedOverLesion: false, deflatedAfterInflation: false },
    stent: { sized: false, positioned: false, deployed: log.stentDeployed },
    angiosAfterStent: log.angiosAfterStent,
    projectionsAfterStent: log.projectionCountAfterStent,
  };
}

