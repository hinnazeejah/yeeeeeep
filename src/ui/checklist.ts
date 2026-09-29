import type { Procedure } from '../procedure/procedure';
import { formatTime } from './hud';

/** Left-hand procedure checklist: stage status and completion time. */
export class Checklist {
  private readonly el: HTMLElement;
  private readonly items: HTMLElement[] = [];
  private lastKey = '';

  constructor(root: HTMLElement, private readonly proc: Procedure) {
    this.el = document.createElement('div');
    this.el.id = 'checklist';
    this.el.className = 'panel';
    this.el.innerHTML = '<div class="panel-title">PROCEDURE</div>';
    const ol = document.createElement('ol');
    proc.stages.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="st-icon"></span><span class="st-text"><span class="st-num mono">${i + 1}</span>${s.title}</span><span class="st-time mono"></span>`;
      li.title = s.goal;
      ol.appendChild(li);
      this.items.push(li);
    });
    this.el.appendChild(ol);
    root.appendChild(this.el);
  }

  update(): void {
    const p = this.proc;
    const key = `${p.current}|${p.completedAt.join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.items.forEach((li, i) => {
      const state = i < p.current ? 'done' : i === p.current ? 'current' : 'locked';
      li.className = state;
      li.querySelector('.st-icon')!.textContent = state === 'done' ? '✓' : state === 'current' ? '●' : '○';
      const t = p.completedAt[i];
      li.querySelector('.st-time')!.textContent = t !== null ? formatTime(t) : '';
    });
  }

  /** Brief highlight when a stage completes. */
  flash(stage: number): void {
    const li = this.items[stage];
    if (!li) return;
    li.classList.remove('flash');
    void li.offsetWidth; // restart the CSS animation
    li.classList.add('flash');
  }
}
