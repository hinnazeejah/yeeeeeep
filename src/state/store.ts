import { FLUORO, PHYSIOLOGY, type CArmAngle } from '../config/anatomy';

export type ViewMode = '3d' | 'fluoro';

/** All simulation state lives in memory in this one object. */
export interface SimState {
  started: boolean;
  view: ViewMode;
  /** Heart rate (beats per minute). */
  hr: number;
  /** Cardiac cycle phase 0..1 (0 = R wave). */
  beatPhase: number;
  /** Seconds since the procedure started. */
  elapsed: number;
  carm: CArmAngle;
  carmPreset: number;
  labelsVisible: boolean;
  /** X-rays currently on (fluoro pedal or cine). */
  xrayOn: boolean;
}

type Listener = (s: SimState) => void;

class Store {
  readonly state: SimState = {
    started: false,
    view: '3d',
    hr: PHYSIOLOGY.baselineHR,
    beatPhase: 0,
    elapsed: 0,
    carm: { lao: FLUORO.presets[0].lao, cra: FLUORO.presets[0].cra },
    carmPreset: 0,
    labelsVisible: true,
    xrayOn: false,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Merge a partial update and notify UI listeners (not called per-frame). */
  set(patch: Partial<SimState>): void {
    Object.assign(this.state, patch);
    for (const fn of this.listeners) fn(this.state);
  }
}

export const store = new Store();
