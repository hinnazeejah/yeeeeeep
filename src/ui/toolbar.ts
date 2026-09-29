import { TOOLS, toolAvailability, type ToolContext, type ToolDef, type ToolId } from '../tools/tools';

export interface ToolbarHandlers {
  select(id: ToolId): void;
  action(id: ToolId): void;
  hold(id: ToolId, down: boolean): void;
}

/** Bottom toolbar: one button per tool (keys 1–7) with a rules tooltip. */
export class Toolbar {
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private readonly tip: HTMLElement;
  private lastState = '';

  constructor(root: HTMLElement, h: ToolbarHandlers) {
    const bar = document.createElement('div');
    bar.id = 'toolbar';
    bar.className = 'panel';
    this.tip = document.createElement('div');
    this.tip.id = 'tool-tip';
    this.tip.className = 'panel';
    root.appendChild(this.tip);

    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = `tool tool-${t.kind}`;
      b.innerHTML = `<span class="key mono">${t.key}</span>${t.icon}<span class="name">${t.short}</span>`;
      b.addEventListener('mouseenter', () => this.showTip(t, b));
      b.addEventListener('mouseleave', () => (this.tip.style.display = 'none'));
      if (t.kind === 'hold') {
        b.addEventListener('pointerdown', (e) => {
          b.setPointerCapture(e.pointerId);
          h.hold(t.id, true);
        });
        b.addEventListener('pointerup', () => h.hold(t.id, false));
        b.addEventListener('pointercancel', () => h.hold(t.id, false));
      } else {
        b.addEventListener('click', () => (t.kind === 'modal' ? h.select(t.id) : h.action(t.id)));
      }
      this.buttons.set(t.id, b);
      bar.appendChild(b);
    }
    root.appendChild(bar);
  }

  private showTip(t: ToolDef, b: HTMLButtonElement): void {
    const reason = b.dataset.reason;
    this.tip.innerHTML =
      `<div class="tt-title">${t.key} · ${t.name}</div><ul>${t.rules.map((r) => `<li>${r}</li>`).join('')}</ul>` +
      (reason ? `<div class="tt-lock">🔒 ${reason}</div>` : '');
    const r = b.getBoundingClientRect();
    this.tip.style.display = 'block';
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    this.tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }

  /** Refresh active / locked / pressed states (cheap: only touches the DOM when something changed). */
  update(active: ToolId, ctx: ToolContext, pressed: Partial<Record<ToolId, boolean>>): void {
    const states = TOOLS.map((t) => {
      const a = toolAvailability(t.id, ctx);
      return `${t.id}:${a.ok ? 1 : 0}:${active === t.id ? 1 : 0}:${pressed[t.id] ? 1 : 0}:${a.reason ?? ''}`;
    });
    const key = states.join('|');
    if (key === this.lastState) return;
    this.lastState = key;
    for (const t of TOOLS) {
      const b = this.buttons.get(t.id)!;
      const a = toolAvailability(t.id, ctx);
      b.classList.toggle('active', active === t.id);
      b.classList.toggle('locked', !a.ok);
      b.classList.toggle('pressed', !!pressed[t.id]);
      if (a.ok) delete b.dataset.reason;
      else b.dataset.reason = a.reason;
    }
  }
}
