import type { Debrief } from '../procedure/evaluation';
import { formatTime } from './hud';

/** End-of-case debrief: overall grade, then each item with a short teaching point. */
export class DebriefScreen {
  private readonly el: HTMLElement;
  onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'debrief';
    this.el.hidden = true;
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(d: Debrief, totalSeconds: number): void {
    const row = (it: Debrief['items'][number]) => `
      <li class="db-item ${it.status}">
        <span class="db-dot" aria-label="${it.status}"></span>
        <div class="db-main">
          <div class="db-line"><span class="db-label">${it.label}</span><span class="db-value mono">${it.value}</span></div>
          <div class="db-teach">${it.teach}</div>
        </div>
      </li>`;
    this.el.innerHTML = `
      <div class="card panel">
        <div class="db-top">
          <div>
            <div class="panel-title">DEBRIEF · PCI OF THE MID LAD</div>
            <h2>${d.grade}</h2>
            <div class="db-headline">${d.headline}</div>
          </div>
          <div class="db-score"><span class="mono">${d.score}</span><span class="dim">/ 100</span></div>
        </div>
        <div class="dim db-time mono">Procedure time ${formatTime(totalSeconds)}</div>
        <ul class="db-list">${d.items.map(row).join('')}</ul>
        <div class="db-foot">
          <span class="dim">Scores reflect this simplified model, not clinical competence.</span>
          <span class="db-buttons">
            <button class="ghost" data-close>Keep exploring</button>
            <button class="primary" data-restart>New case</button>
          </span>
        </div>
      </div>`;
    this.el.hidden = false;
    this.el.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    this.el.querySelector('[data-restart]')!.addEventListener('click', () => location.reload());
    this.el.querySelector<HTMLButtonElement>('[data-restart]')!.focus();
  }

  hide(): void {
    this.el.hidden = true;
    this.onClose();
  }
}
