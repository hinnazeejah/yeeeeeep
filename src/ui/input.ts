/** What the demo autopilot (or any script) wants the active device to do this frame. */
export interface AutoInput {
  advance: number;
  rotate: number;
  fine: boolean;
  inflate: boolean;
}

/**
 * Continuous device input: held keys, on-screen hold buttons and the mouse wheel.
 * The device controller asks for "how far to push / twist this frame".
 */
export class DeviceInput {
  private readonly keys = new Set<string>();
  /** On-screen pad: -1, 0, +1 for each axis. */
  padAdvance = 0;
  padRotate = 0;
  /** On-screen inflate button held. */
  padInflate = false;
  /** Wheel travel waiting to be applied (mm). */
  private wheelPending = 0;
  private deflatePending = false;
  /** Set false to ignore input (before the start screen is dismissed, paused). */
  enabled = true;
  /** When set, replaces the user's input (demo autopilot). */
  auto: AutoInput | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ' && !e.repeat) this.deflatePending = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.padAdvance = 0;
      this.padRotate = 0;
      this.padInflate = false;
    });
  }

  get fine(): boolean {
    if (this.auto) return this.auto.fine;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Called from the canvas wheel handler; positive = advance. */
  addWheel(mm: number): void {
    this.wheelPending = Math.max(-40, Math.min(40, this.wheelPending + mm));
  }

  /** -1..1 push/pull axis from keys and pad. */
  advanceAxis(): number {
    if (!this.enabled) return 0;
    if (this.auto) return this.auto.advance;
    const k = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.padAdvance));
  }

  rotateAxis(): number {
    if (!this.enabled) return 0;
    if (this.auto) return this.auto.rotate;
    const k = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.padRotate));
  }

  /** Inflation device being screwed in (E held or the on-screen button). */
  inflating(): boolean {
    if (!this.enabled) return false;
    if (this.auto) return this.auto.inflate;
    return this.keys.has('KeyE') || this.padInflate;
  }

  /** Deflate requested since the last call (Q pressed or the on-screen button). */
  takeDeflate(): boolean {
    const d = this.deflatePending && this.enabled;
    this.deflatePending = false;
    return d;
  }

  requestDeflate(): void {
    this.deflatePending = true;
  }

  /** Wheel travel to apply this frame, drained at up to `maxSpeed` mm/s. */
  drainWheel(dt: number, maxSpeed: number): number {
    if (!this.enabled || this.auto) {
      this.wheelPending = 0;
      return 0;
    }
    const max = maxSpeed * dt;
    const d = Math.max(-max, Math.min(max, this.wheelPending));
    this.wheelPending -= d;
    return d;
  }
}
