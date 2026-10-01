import { MeshStandardMaterial, Vector3, type Scene } from 'three';
import { DEVICES, LESION } from '../config/anatomy';
import type { AnatomyModel } from '../anatomy/anatomyModel';
import type { Expansion } from '../anatomy/lumen';
import type { Vessel } from '../anatomy/vessel';
import { BalloonCatheter } from '../physics/balloon';
import { computeTransitTimes, NO_FLOW_TIME, sampleArray, type ContrastBolus } from '../physics/flow';
import { GuideCatheter, type Feedback } from '../physics/guideCatheter';
import { Guidewire } from '../physics/guidewire';
import { Route, type ToWorld } from '../physics/route';
import { achievedDiameter, coverage, residualStenosis } from '../procedure/evaluation';
import type { ProcedureLog } from '../procedure/snapshot';
import { CoronaryDeviceView } from '../scene/coronaryDeviceView';
import { DeviceTube } from '../scene/deviceTube';
import type { DeviceInput } from '../ui/input';
import { toolAvailability, type ToolContext, type ToolId } from './tools';

const G = DEVICES.guide;
const W = DEVICES.wire;
const INF = DEVICES.inflation;

/** Vessel-space points stay in vessel space (used for devices drawn inside the heart's groups). */
const identity: ToWorld = (_v, local, out) => out.copy(local);

export interface DeployedStent {
  nominal: number;
  length: number;
  startMm: number;
  endMm: number;
  /** Lumen held open by the stent (its radius grows if post-dilated). */
  expansion: Expansion;
}

/** Quantitative coronary angiography of the target lesion segment. */
export interface Qca {
  referenceDiameter: number;
  mld: number;
  ds: number;
  lesionLength: number;
}

/**
 * Owns the physical devices, applies user input to the active one each frame and keeps their
 * meshes (3D and fluoro) in sync with the beating anatomy. Balloon inflations change the LAD
 * lumen, which in turn changes the contrast flow model.
 */
export class DeviceController implements ToolContext {
  readonly guide: GuideCatheter;
  readonly wire: Guidewire;
  readonly balloon = new BalloonCatheter('balloon');
  readonly stentSys = new BalloonCatheter('stent');
  readonly stents: DeployedStent[] = [];
  activeTool: ToolId = 'guide';
  /** Current procedure stage, set by the app each frame (used for tool rules). */
  stageIndex = 0;
  onFeedback: (f: Feedback) => void = () => {};
  /** Random source for complications (replaceable in tests). */
  rng: () => number = Math.random;
  /** Latest contrast arrival time in the left system (s), for cine run length. */
  maxTransit: number;
  /** Contrast trapped in a dissected wall (0..1). */
  stain = 0;

  private readonly lad: Vessel;
  private readonly lesion: { start: number; end: number };
  private readonly guideTube: DeviceTube;
  private readonly wireTube: DeviceTube;
  private readonly guideMat: MeshStandardMaterial;
  private readonly coronaryView: CoronaryDeviceView;
  private lumenDirty = false;
  private wasCrossed = false;

  constructor(
    private readonly anatomy: AnatomyModel,
    scene3d: Scene,
    sceneFluoro: Scene,
    private readonly log: ProcedureLog,
  ) {
    this.guide = new GuideCatheter(anatomy.vessels, anatomy.toWorld);
    this.wire = new Guidewire(anatomy.vessels);
    this.lad = anatomy.vessels.get(LESION.vessel)!;
    const c = LESION.centerU * this.lad.length;
    this.lesion = { start: c - LESION.lengthMm / 2, end: c + LESION.lengthMm / 2 };
    this.maxTransit = computeTransitTimes(anatomy.vessels);

    this.guideMat = new MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.35, metalness: 0.1, emissive: 0x0c1a1f });
    this.guideTube = new DeviceTube(320, 10, G.radius, this.guideMat);
    this.wireTube = new DeviceTube(
      520,
      6,
      W.visualRadius,
      new MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.25, metalness: 0.8, emissive: 0x303438 }),
    );
    this.guideTube.mesh3d.name = 'guide';
    this.wireTube.mesh3d.name = 'wire';
    for (const t of [this.guideTube, this.wireTube]) {
      scene3d.add(t.mesh3d);
      sceneFluoro.add(t.meshFluoro);
    }
    this.coronaryView = new CoronaryDeviceView(anatomy.rig3d.pulse, anatomy.rigFluoro.pulse);
  }

  get wireOut(): boolean {
    return this.wire.out > 0;
  }

  get heparin(): boolean {
    return this.log.heparinGiven;
  }

  get angioTaken(): boolean {
    return this.log.selectiveAngios > 0;
  }

  /** The balloon catheter (plain or stent) that is the active tool, if any. */
  get activeCatheter(): BalloonCatheter | null {
    return this.activeTool === 'balloon' ? this.balloon : this.activeTool === 'stent' ? this.stentSys : null;
  }

  /** Lesion span along the LAD (mm). */
  get lesionSpan(): { start: number; end: number } {
    return this.lesion;
  }

  /** Meshes the hover picker can hit. */
  get pickables() {
    return [this.guideTube.mesh3d, this.wireTube.mesh3d];
  }

  setGuideHighlight(on: boolean): void {
    this.guideMat.emissive.setHex(on ? 0x1f5a60 : 0x0c1a1f);
  }

  selectTool(id: ToolId): Feedback | null {
    const a = toolAvailability(id, this);
    if (!a.ok) return { text: a.reason!, level: 'warn' };
    this.activeTool = id;
    return null;
  }

  giveHeparin(weightKg = 80): Feedback {
    if (this.log.heparinGiven) return { text: 'Heparin has already been given. ACT is in range.', level: 'info' };
    this.log.heparinGiven = true;
    const units = Math.round((weightKg * 80) / 500) * 500;
    return { text: `Heparin ${units} U IV given (about 80 U/kg for ${weightKg} kg). ACT will rise to 250–300 s.`, level: 'ok' };
  }

  update(dt: number, input: DeviceInput): void {
    const axis = input.advanceAxis();
    const rot = input.rotateAxis();
    let fb: Feedback | null = null;
    const cath = this.activeCatheter;

    if (this.activeTool === 'guide') {
      const speed = input.fine ? G.fineSpeedMmPerS : G.speedMmPerS;
      const mm = axis * speed * dt + input.drainWheel(dt, speed * 1.5);
      fb = this.guide.advance(mm, this.wireOut) ?? this.guide.rotate(rot * G.rotateDegPerS * (input.fine ? 0.3 : 1) * dt, this.wireOut);
    } else if (this.activeTool === 'wire') {
      const speed = input.fine ? W.fineSpeedMmPerS : W.speedMmPerS;
      let mm = axis * speed * dt + input.drainWheel(dt, speed * 1.5);
      if (mm < 0 && (this.balloon.out || this.stentSys.out)) {
        fb = { text: 'Keep the wire in place while a balloon is on it. Pull the balloon back into the guide first.', level: 'warn' };
        mm = 0;
      }
      this.wire.rotate(rot * W.rotateDegPerS * (input.fine ? 0.4 : 1) * dt);
      fb = this.wire.advance(mm, dt, this.guide.lmTipU) ?? fb;
    } else if (cath) {
      const speed = input.fine ? INF.fineSpeedMmPerS : INF.speedMmPerS;
      const mm = axis * speed * dt + input.drainWheel(dt, speed * 1.5);
      fb = cath.move(mm, this.wireOut ? this.wire.out - 6 : 0);
      if (input.inflating()) {
        const r = cath.inflate((input.fine ? INF.fineAtmPerS : INF.atmPerS) * dt);
        fb = r.feedback ?? fb;
        if (r.ruptured) {
          this.log.balloonRupture = true;
          const span = this.span(cath);
          if (span) this.makeDissection((span.start + span.end) / 2, 'Balloon rupture');
        }
      }
      if (input.takeDeflate()) cath.deflate();
    } else {
      input.drainWheel(dt, 1000);
      this.wire.advance(0, dt, this.guide.lmTipU);
    }
    if (!cath && input.takeDeflate()) {
      // Q deflates whichever balloon is up, even when another tool is selected.
      this.balloon.deflate();
      this.stentSys.deflate();
    }
    if (fb) this.onFeedback(fb);

    // If the guide lost engagement, a wire tool selection is no longer valid.
    if (this.activeTool === 'wire' && !this.guide.engaged) this.activeTool = 'guide';

    this.checkWireCrossing();
    for (const c of [this.balloon, this.stentSys]) this.updateCatheter(c, dt);

    if (this.lumenDirty) {
      this.lumenDirty = false;
      this.lad.updateGeometry();
      this.maxTransit = computeTransitTimes(this.anatomy.vessels);
    }

    this.anatomy.setCoronaryOpacity(this.wireOut ? 0.45 : 0.9);
    this.updateMeshes();
  }

  /** Start a contrast injection if the rules allow. Returns contrast volume used (ml). */
  inject(bolus: ContrastBolus): { ok: boolean; ml: number; feedback?: Feedback } {
    const a = toolAvailability('contrast', this);
    if (!a.ok) return { ok: false, ml: 0, feedback: { text: a.reason!, level: 'warn' } };
    if (this.guide.engaged) {
      this.anatomy.injectedSystem = 'left';
      bolus.start(undefined, this.maxTransit);
      return { ok: true, ml: DEVICES.contrastMl.selective };
    }
    this.anatomy.injectedSystem = 'aortic';
    bolus.start(1.6, this.maxTransit);
    return {
      ok: true,
      ml: DEVICES.contrastMl.aortic,
      feedback: { text: 'Aortic root flush: the dye outlines the root and faintly fills both coronaries.', level: 'info' },
    };
  }

  /** Contrast staining of a dissected wall: builds up as dye passes and lingers after washout. */
  updateStain(dt: number, bolus: ContrastBolus): void {
    const d = this.lad.dissection;
    if (!d) return;
    const arrival = sampleArray(this.lad.transit, d.mm / this.lad.length);
    const passing = bolus.active && this.anatomy.injectedSystem === 'left' && arrival < NO_FLOW_TIME && bolus.front > arrival;
    if (passing && !d.sealed) this.stain = Math.min(1, this.stain + dt * 1.5);
    else this.stain *= Math.exp(-dt / (d.sealed ? 1 : 5));
  }

  // -------------------------------------------------------------------------
  // Positions along the wire
  // -------------------------------------------------------------------------

  /** Distance along the LAD (mm) of a point `d` mm beyond the guide tip along the wire; null if not on the wire. */
  ladMmAt(d: number): number | null {
    if (!this.wireOut) return null;
    const route = new Route(this.wire.segs, identity);
    const { seg, u } = route.locate(Math.max(0, d));
    const id = seg.vessel.spec.id;
    if (id === 'lad') return u * seg.vessel.length;
    if (id === 'lm') return -(1 - u) * seg.vessel.length;
    return null;
  }

  /** Working-length span of a balloon along the LAD (mm), or null when not in the LM/LAD. */
  span(c: BalloonCatheter): { start: number; end: number } | null {
    if (!c.out) return null;
    const end = this.ladMmAt(c.adv);
    if (end === null) return null;
    return { start: end - c.length, end };
  }

  lesionCoverage(c: BalloonCatheter): ReturnType<typeof coverage> | null {
    const s = this.span(c);
    return s ? coverage(s, this.lesion) : null;
  }

  /** QCA of the lesion segment as it looks now (includes any treatment). */
  qca(): Qca {
    const lad = this.lad;
    let worst = -1;
    let mld = 0;
    let ref = 0;
    let first = -1;
    let last = -1;
    for (let mm = this.lesion.start - 4; mm <= this.lesion.end + 4; mm += 0.25) {
      const r = lad.radiusAtMm(mm);
      const rr = lad.referenceRadiusAtMm(mm);
      const ds = 1 - r / rr;
      if (ds > worst) {
        worst = ds;
        mld = 2 * r;
        ref = 2 * rr;
      }
      if (ds > 0.03) {
        if (first < 0) first = mm;
        last = mm;
      }
    }
    return {
      referenceDiameter: ref,
      mld,
      ds: residualStenosis(mld, ref),
      lesionLength: first < 0 ? 0 : last - first,
    };
  }

  /** Healthy (reference) diameter at the centre of the lesion: what the stent should be sized to. */
  get lesionReferenceDiameter(): number {
    return 2 * this.lad.referenceRadiusAtMm((this.lesion.start + this.lesion.end) / 2);
  }

  /** Flow fraction in the distal LAD (1 = normal). */
  get distalFlow(): number {
    return sampleArray(this.lad.flow, 0.95);
  }

  /** LAD is blocked by an inflated balloon. */
  get ladOccluded(): boolean {
    return this.lad.occludedFromMm !== null;
  }

  get dissection(): { mm: number; sealed: boolean } | null {
    return this.lad.dissection;
  }

  // -------------------------------------------------------------------------
  // Balloon / stent mechanics
  // -------------------------------------------------------------------------

  private updateCatheter(c: BalloonCatheter, dt: number): void {
    const ended = c.update(dt);
    const span = this.span(c);
    const lad = this.lad;

    if (c.inflated && span) {
      const r = c.diameter() / 2;
      lad.live = { startMm: Math.max(0, span.start), endMm: span.end, radius: r };
      const occ = c.occluding ? Math.max(0, span.start) : null;
      if (occ !== lad.occludedFromMm) lad.occludedFromMm = occ;
      this.lumenDirty = true;

      // Stretching the artery well beyond its size tears the wall.
      const centre = (span.start + span.end) / 2;
      const refD = 2 * lad.referenceRadiusAtMm(Math.max(0, centre));
      const ratio = c.diameter() / refD;
      if (ratio > INF.dissectionRatio && !lad.dissection) {
        const cause = `Oversized ${c.kind === 'stent' ? 'stent' : 'balloon'} (${c.diameter().toFixed(1)} mm in a ${refD.toFixed(1)} mm vessel)`;
        this.makeDissection(c.kind === 'stent' ? span.end + 1.5 : span.end - 1, cause);
      }

      // Stent: plastically expanded once the balloon passes its expansion pressure.
      if (c.kind === 'stent' && !c.deployed && c.pressure >= DEVICES.stent.expandAtm) {
        c.deployed = true;
        const exp: Expansion = { startMm: Math.max(0, span.start), endMm: span.end, radius: 0 };
        lad.expansions.push(exp);
        this.stents.push({ nominal: c.nominal, length: c.length, startMm: exp.startMm, endMm: exp.endMm, expansion: exp });
        this.log.stentDeployed = true;
        this.onFeedback({ text: `Stent ${c.label} expanding. It stays in the artery once deployed.`, level: 'ok' });
      }
      // Any balloon inflated inside a stent expands it further (post-dilation).
      for (const s of this.stents) {
        const overlap = Math.min(span.end, s.endMm) - Math.max(span.start, s.startMm);
        if (overlap >= 0.5 * (s.endMm - s.startMm)) {
          const target = r * (1 - DEVICES.stent.recoil);
          if (target > s.expansion.radius) s.expansion.radius = target;
        }
      }
      this.updateSealing();
    } else if (!this.balloon.inflated && !this.stentSys.inflated && (lad.live || lad.occludedFromMm !== null)) {
      lad.live = null;
      lad.occludedFromMm = null;
      this.lumenDirty = true;
    }

    if (ended === 'deflated') {
      const peakD = achievedDiameter(c.nominal, c.peakAtm, c.spec);
      const cov = span ? coverage(span, this.lesion) : null;
      this.log.recordInflation({
        kind: c.kind,
        nominal: c.nominal,
        peakAtm: c.peakAtm,
        peakDiameter: peakD,
        seconds: c.inflatedSeconds,
        lesionOverlap: cov ? cov.overlap : 0,
      });
      if (c.kind === 'balloon' && span && !c.ruptured && c.peakAtm >= 2) {
        // Plain balloon angioplasty: the lumen stays open, minus elastic recoil.
        lad.expansions.push({ startMm: Math.max(0, span.start), endMm: span.end, radius: (peakD / 2) * (1 - DEVICES.balloon.recoil) });
        this.lumenDirty = true;
      }
      c.resetInflation();
    }

    // Back in the guide: exchange a ruptured balloon, or load a fresh stent after deployment.
    if (!c.out && (c.ruptured || c.deployed)) {
      const msg = c.ruptured ? 'A new balloon has been prepared.' : 'Stent delivery balloon removed. A new stent is ready if you need one.';
      c.exchange();
      this.onFeedback({ text: msg, level: 'info' });
    }
  }

  private makeDissection(mm: number, cause: string): void {
    if (this.lad.dissection) return;
    this.lad.dissection = { mm: Math.max(1, Math.min(this.lad.length - 1, mm)), sealed: false };
    this.log.dissectionCause = cause;
    this.updateSealing();
    this.lumenDirty = true;
    this.onFeedback({
      text: 'Dissection! A tear in the LAD wall is limiting flow. Inject contrast to see it; cover it with a stent.',
      level: 'danger',
    });
  }

  private updateSealing(): void {
    const d = this.lad.dissection;
    if (!d) return;
    const sealed = this.stents.some((s) => s.expansion.radius > 0.8 && d.mm >= s.startMm - 0.5 && d.mm <= s.endMm + 0.5);
    if (sealed !== d.sealed) {
      d.sealed = sealed;
      this.lumenDirty = true;
    }
  }

  /** Forcing the wire through the lesion may have raised a dissection; check once it is across. */
  private checkWireCrossing(): void {
    const crossed = this.wire.crossed;
    if (crossed && !this.wasCrossed && this.wire.dissectionRisk > 0 && this.rng() < this.wire.dissectionRisk) {
      this.makeDissection(this.lesion.end - 2, 'Wire forced through the lesion');
    }
    this.wasCrossed = this.wasCrossed || crossed;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /** World position of the tip of whatever device is being driven (for camera follow). */
  activeTip(out = new Vector3()): Vector3 {
    const cath = this.activeCatheter;
    if (cath && cath.out) return this.wireRoute().pointAt(this.guide.inserted + cath.adv, out);
    if ((this.activeTool === 'wire' || cath) && this.wireOut) return this.wireRoute().pointAt(this.guide.inserted + this.wire.out, out);
    return this.guide.route.pointAt(this.guide.inserted, out);
  }

  private wireRoute(): Route {
    return new Route([...this.guide.route.segs, ...this.wire.segs], this.anatomy.toWorld);
  }

  private updateMeshes(): void {
    // --- Guide catheter ---------------------------------------------------
    const ins = this.guide.inserted;
    const pts = this.guide.route.sample(0, ins, 2.5);
    if (!this.guide.engaged && pts.length > 1) {
      // Pre-shaped tip: bend the last few cm towards the direction the tip faces.
      // The curve only opens up once it is in the wide aorta.
      const intoAorta = ins - this.guide.aortaEntry;
      const scale = Math.min(1, Math.max(0, intoAorta / 60));
      if (scale > 0) {
        const dir = this.guide.tipDirection();
        for (let i = 0; i < pts.length; i++) {
          const fromTip = (pts.length - 1 - i) * (ins / (pts.length - 1));
          if (fromTip > G.hookLength) continue;
          const k = 1 - fromTip / G.hookLength;
          pts[i].addScaledVector(dir, G.hookSize * k * k * scale);
        }
      }
    }
    // Short external segment outside the wrist, with the sheath hub.
    if (pts.length > 1) {
      const out = pts[0].clone().sub(pts[1]).normalize();
      pts.unshift(pts[0].clone().addScaledVector(out, 25));
    }
    this.guideTube.setPath(pts, (fromTip) => (fromTip < 2 ? 1.2 : 0.35));

    // --- Guidewire (only drawn once it leaves the guide) -------------------
    if (!this.wireOut) {
      this.wireTube.setPath([], () => 0);
    } else {
      const route = this.wireRoute();
      const end = ins + this.wire.out;
      const wpts = route.sample(Math.max(0, ins - 30), end, 1);
      // Shaped tip: a small bend in the direction the wire is torqued.
      const tip = this.wire.tip!;
      const bend = this.wire.tipBendDirection();
      if (tip.vessel.spec.onHeart) bend.transformDirection(this.anatomy.rig3d.pulse.matrixWorld);
      const nBend = Math.min(wpts.length - 1, Math.ceil(W.tipBendMm));
      for (let i = 0; i < nBend; i++) {
        const k = (nBend - i) / nBend; // 1 at the tip
        wpts[wpts.length - 1 - i].addScaledVector(bend, 0.9 * k * k);
      }
      this.wireTube.setPath(wpts, (fromTip) => (fromTip < W.tipOpaqueMm ? 4.0 : 1.1));
    }

    // --- Balloon / stent catheter (heart-local: rides on the beating LAD) ---
    const cath = this.balloon.out ? this.balloon : this.stentSys.out ? this.stentSys : null;
    if (cath && this.wireOut) {
      const local = new Route(this.wire.segs, identity);
      const tipExt = 2.5;
      const to = Math.min(this.wire.out, cath.adv + tipExt);
      const points = local.sample(0, to, 0.5);
      this.coronaryView.setBalloon({
        points,
        prox: cath.adv - cath.length,
        dist: cath.adv,
        radius: cath.drawRadius(),
        inflated: cath.inflated,
        crimpedStent: cath.kind === 'stent' && !cath.deployed,
      });
    } else {
      this.coronaryView.setBalloon(null);
    }

    // --- Deployed stents ---------------------------------------------------
    this.coronaryView.setStents(
      this.stents.map((s) => ({ points: this.ladPoints(s.startMm, s.endMm, 0.5), radius: Math.max(DEVICES.stent.crimpedRadius, s.expansion.radius) })),
    );

    // --- Dissection flap / staining ----------------------------------------
    const d = this.lad.dissection;
    if (d) {
      const pts2: Vector3[] = [];
      for (let mm = d.mm - 5; mm <= d.mm + 5; mm += 0.5) {
        const u = Math.max(0, Math.min(1, mm / this.lad.length));
        const p = this.lad.pointAt(u);
        const { n } = this.lad.frameAt(u);
        pts2.push(p.addScaledVector(n, this.lad.radiusAt(u) + 0.5));
      }
      this.coronaryView.setStain(pts2, d.sealed ? this.stain * 0.3 : this.stain);
    } else {
      this.coronaryView.setStain(null, 0);
    }
  }

  private ladPoints(fromMm: number, toMm: number, step: number): Vector3[] {
    const pts: Vector3[] = [];
    for (let mm = fromMm; mm <= toMm + 1e-6; mm += step) pts.push(this.lad.pointAt(mm / this.lad.length));
    return pts;
  }
}
