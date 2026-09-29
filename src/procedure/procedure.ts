import { STAGES, type ProcedureContext, type StageDef } from './stages';

export type ProcedureEvent =
  | { type: 'subtask'; stage: number; id: string; label: string }
  | { type: 'stage'; stage: number; title: string }
  | { type: 'complete' };

/**
 * Stage progression. Only the current stage's sub-tasks are evaluated; once a sub-task's goal
 * is met it stays ticked. When every sub-task is ticked the stage completes and the next unlocks.
 */
export class Procedure {
  readonly stages: StageDef[];
  /** Index of the current (first incomplete) stage; equals stages.length when finished. */
  current = 0;
  readonly done = new Set<string>();
  /** Procedure time (s) at which each stage was completed. */
  readonly completedAt: (number | null)[];

  constructor(stages: StageDef[] = STAGES) {
    this.stages = stages;
    this.completedAt = stages.map(() => null);
  }

  get finished(): boolean {
    return this.current >= this.stages.length;
  }

  static key(stage: number, id: string): string {
    return `${stage}:${id}`;
  }

  isDone(stage: number, id: string): boolean {
    return this.done.has(Procedure.key(stage, id));
  }

  /** Fraction (0..1) of all sub-tasks completed. */
  get progress(): number {
    const total = this.stages.reduce((n, s) => n + s.subtasks.length, 0);
    return total ? this.done.size / total : 0;
  }

  /** Fraction of the current stage's sub-tasks completed. */
  stageProgress(stage = this.current): number {
    const s = this.stages[stage];
    if (!s) return 1;
    return s.subtasks.filter((t) => this.isDone(stage, t.id)).length / s.subtasks.length;
  }

  update(ctx: ProcedureContext, time: number): ProcedureEvent[] {
    const events: ProcedureEvent[] = [];
    // A single frame can complete several stages if goals were met early (e.g. demo jumps).
    while (!this.finished) {
      const i = this.current;
      const stage = this.stages[i];
      for (const t of stage.subtasks) {
        const k = Procedure.key(i, t.id);
        if (!this.done.has(k) && t.check(ctx)) {
          this.done.add(k);
          events.push({ type: 'subtask', stage: i, id: t.id, label: t.label });
        }
      }
      if (!stage.subtasks.every((t) => this.done.has(Procedure.key(i, t.id)))) break;
      this.completedAt[i] = time;
      this.current++;
      events.push({ type: 'stage', stage: i, title: stage.title });
      if (this.finished) events.push({ type: 'complete' });
    }
    return events;
  }
}
