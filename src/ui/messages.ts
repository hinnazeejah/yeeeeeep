import type { Feedback } from '../physics/guideCatheter';

/** Short rule / feedback messages shown above the toolbar. Repeats are suppressed. */
export class Messages {
  private readonly el: HTMLElement;
  private lastText = '';
  private lastAt = 0;
  private hideTimer = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'message';
    root.appendChild(this.el);
  }

  show(f: Feedback): void {
    const now = performance.now();
    if (f.text === this.lastText && now - this.lastAt < 2500) {
      this.lastAt = now;
      this.arm();
      return;
    }
    this.lastText = f.text;
    this.lastAt = now;
    this.el.textContent = f.text;
    this.el.className = `panel show ${f.level}`;
    this.arm();
  }

  private arm(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.el.classList.remove('show');
      this.lastText = '';
    }, 3500);
  }
}
