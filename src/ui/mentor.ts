import type { Procedure } from '../procedure/procedure';
import type { ProcedureContext } from '../procedure/stages';

/**
 * Mentor panel (bottom right): a calm instruction for the current step, its sub-task
 * checkboxes and overall progress. Collapsible (click the header or press M).
 */
export class MentorPanel {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly list: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly bar: HTMLElement;
  private lastKey = '';
  private lastHint = '';

  constructor(root: HTMLElement, private readonly proc: Procedure) {
    this.el = document.createElement('div');
    this.el.id = 'mentor';
    this.el.className = 'panel';
    this.el.innerHTML = `
      <div class="mentor-head" role="button" tabindex="0">
        <span class="panel-title">MENTOR</span>
        <span class="mono mentor-pct" data-pct>0%</span>
        <span class="mentor-caret">▾</span>
      </div>
      <div class="mentor-bar"><div data-bar></div></div>
      <div class="mentor-body">
        <div class="mentor-stage" data-title></div>
        <div class="mentor-goal" data-goal></div>
        <ul class="mentor-tasks" data-list></ul>
        <div class="mentor-hint" data-hint></div>
      </div>`;
    root.appendChild(this.el);
    this.title = this.el.querySelector('[data-title]')!;
    this.goal = this.el.querySelector('[data-goal]')!;
    this.hint = this.el.querySelector('[data-hint]')!;
    this.list = this.el.querySelector('[data-list]')!;
    this.pct = this.el.querySelector('[data-pct]')!;
    this.bar = this.el.querySelector('[data-bar]')!;
    const head = this.el.querySelector<HTMLElement>('.mentor-head')!;
    head.addEventListener('click', () => this.toggle());
  }

  toggle(): void {
    this.el.classList.toggle('collapsed');
  }

  update(ctx: ProcedureContext): void {
    const p = this.proc;
    const pct = Math.round(p.progress * 100);
    const key = `${p.current}|${p.done.size}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.pct.textContent = `${pct}%`;
      this.bar.style.width = `${pct}%`;
      if (p.finished) {
        this.title.textContent = 'Procedure complete';
        this.goal.textContent = 'All stages are done. Well done.';
        this.list.innerHTML = '';
      } else {
        const s = p.stages[p.current];
        this.title.textContent = `Step ${p.current + 1} of ${p.stages.length} · ${s.title}`;
        this.goal.textContent = s.goal;
        this.list.innerHTML = s.subtasks
          .map((t) => {
            const done = p.isDone(p.current, t.id);
            return `<li class="${done ? 'done' : ''}"><span class="box">${done ? '✓' : ''}</span>${t.label}</li>`;
          })
          .join('');
      }
    }
    const hint = p.finished ? '' : p.stages[p.current].hint(ctx);
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.hint.textContent = hint;
      this.hint.classList.remove('fresh');
      void this.hint.offsetWidth;
      this.hint.classList.add('fresh');
    }
  }
}
