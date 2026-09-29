import { describe, expect, it } from 'vitest';
import { Procedure } from '../src/procedure/procedure';
import { STAGES, type ProcedureContext } from '../src/procedure/stages';
import { toolAvailability } from '../src/tools/tools';

function ctx(patch: Partial<ProcedureContext> = {}): ProcedureContext {
  return {
    guide: { zone: 'sheath', pastElbow: false, facing: 'none', engaged: false },
    wire: { out: false, vessel: null, inLesion: false, crossed: false, distal: false, upcoming: null },
    fluoroInAorta: false,
    selectiveAngios: 0,
    activeTool: 'guide',
    balloon: { positioned: false, inflatedOverLesion: false, deflatedAfterInflation: false },
    stent: { sized: false, positioned: false, deployed: false },
    angiosAfterStent: 0,
    projectionsAfterStent: 0,
    ...patch,
  };
}

const atRoot = ctx({ guide: { zone: 'root', pastElbow: true, facing: 'wall', engaged: false }, fluoroInAorta: true });
const engaged = ctx({ guide: { zone: 'engaged', pastElbow: true, facing: 'left', engaged: true }, fluoroInAorta: true });

describe('Procedure stages', () => {
  it('starts at stage 1 with no progress', () => {
    const p = new Procedure();
    expect(p.current).toBe(0);
    expect(p.progress).toBe(0);
  });

  it('latches sub-tasks: once done they stay done', () => {
    const p = new Procedure();
    p.update(ctx({ guide: { zone: 'arm', pastElbow: true, facing: 'none', engaged: false } }), 1);
    expect(p.isDone(0, 'arm')).toBe(true);
    p.update(ctx(), 2); // guide pulled back to the sheath
    expect(p.isDone(0, 'arm')).toBe(true);
    expect(p.current).toBe(0);
  });

  it('completes stage 1 only when every sub-task is met, and records the time', () => {
    const p = new Procedure();
    const noFluoro = ctx({ guide: { zone: 'root', pastElbow: true, facing: 'wall', engaged: false } });
    p.update(noFluoro, 10);
    expect(p.current).toBe(0);
    const ev = p.update(atRoot, 12);
    expect(p.current).toBe(1);
    expect(p.completedAt[0]).toBe(12);
    expect(ev.some((e) => e.type === 'stage' && e.stage === 0)).toBe(true);
  });

  it('does not tick future-stage goals early', () => {
    const p = new Procedure();
    // Engaged with an angiogram, but stage 1's fluoro task is still missing.
    p.update(ctx({ guide: { zone: 'engaged', pastElbow: true, facing: 'left', engaged: true }, selectiveAngios: 1 }), 5);
    expect(p.current).toBe(0);
    expect(p.isDone(1, 'engage')).toBe(false);
  });

  it('needs a diagnostic angiogram to finish engaging the left main', () => {
    const p = new Procedure();
    p.update(atRoot, 1);
    p.update(engaged, 2);
    expect(p.current).toBe(1);
    p.update({ ...engaged, selectiveAngios: 1 }, 3);
    expect(p.current).toBe(2);
  });

  it('requires the wire to be parked distally after crossing', () => {
    const p = new Procedure();
    p.update(atRoot, 1);
    p.update({ ...engaged, selectiveAngios: 1 }, 2);
    const wire = (w: Partial<ProcedureContext['wire']>) => ({
      ...engaged,
      selectiveAngios: 1,
      wire: { out: true, vessel: 'lad' as const, inLesion: false, crossed: false, distal: false, upcoming: null, ...w },
    });
    p.update(wire({ crossed: true }), 3);
    expect(p.current).toBe(2);
    p.update(wire({ crossed: true, distal: true }), 4);
    expect(p.current).toBe(3);
    expect(p.progress).toBeCloseTo(11 / STAGES.reduce((n, s) => n + s.subtasks.length, 0));
  });

  it('gives a calm hint for every stage without throwing', () => {
    for (const s of STAGES) expect(s.hint(ctx()).length).toBeGreaterThan(0);
  });
});

describe('tool unlocking', () => {
  const guide = { engaged: true, inAorta: true } as never;
  it('keeps the wire locked until the angiogram stage is done', () => {
    expect(toolAvailability('wire', { guide, wire: {} as never, stageIndex: 1 }).ok).toBe(false);
    expect(toolAvailability('wire', { guide, wire: {} as never, stageIndex: 2 }).ok).toBe(true);
  });
});
