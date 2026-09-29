/**
 * Continuous device input: held keys, on-screen hold buttons and the mouse wheel.
 * The device controller asks for "how far to push / twist this frame".
 */
export class DeviceInput {
  private readonly keys = new Set<string>();
  /** On-screen pad: -1, 0, +1 for each axis. */
  padAdvance = 0;
  padRotate = 0;
  /** Wheel travel waiting to be applied (mm). */
  private wheelPending = 0;
  /** Set true to ignore input (e.g. demo mode driving). */
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.padAdvance = 0;
      this.padRotate = 0;
    });
  }

  get fine(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Called from the canvas wheel handler; positive = advance. */
  addWheel(mm: number): void {
    this.wheelPending = Math.max(-40, Math.min(40, this.wheelPending + mm));
  }

  /** -1..1 push/pull axis from keys and pad. */
  advanceAxis(): number {
    if (!this.enabled) return 0;
    const k = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.padAdvance));
  }

  rotateAxis(): number {
    if (!this.enabled) return 0;
    const k = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.padRotate));
  }

  /** Wheel travel to apply this frame, drained at up to `maxSpeed` mm/s. */
  drainWheel(dt: number, maxSpeed: number): number {
    if (!this.enabled) {
      this.wheelPending = 0;
      return 0;
    }
    const max = maxSpeed * dt;
    const d = Math.max(-max, Math.min(max, this.wheelPending));
    this.wheelPending -= d;
    return d;
  }
}
