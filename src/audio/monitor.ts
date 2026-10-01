/**
 * Cath lab monitor sounds via the Web Audio API: a short beep on every QRS whose pitch follows
 * the oxygen saturation (lower SpO2 = lower pitch, as on real monitors), and a two-tone alarm.
 * Browsers only allow audio after a user gesture, so `unlock()` is called from the start button.
 */
export class MonitorAudio {
  private ctx: AudioContext | null = null;
  muted = false;
  private nextAlarm = 0;

  unlock(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  /** One QRS beep. */
  beat(spo2: number): void {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const freq = 880 * Math.pow(2, (spo2 - 99) / 12);
    this.tone(freq, this.ctx.currentTime, 0.09, 0.05);
  }

  /** Call every frame; sounds a medium-priority alarm every 2 s while `active`. */
  alarm(active: boolean): void {
    if (!this.ctx || this.muted || !active || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now < this.nextAlarm) return;
    this.nextAlarm = now + 2;
    this.tone(660, now, 0.16, 0.06, 'triangle');
    this.tone(523, now + 0.2, 0.16, 0.06, 'triangle');
    this.tone(660, now + 0.4, 0.16, 0.06, 'triangle');
  }
}
