/**
 * ALL anatomy sizes, positions and simulation constants live here.
 *
 * Units: 1 scene unit = 1 millimetre. Sizes are typical adult values, simplified.
 *
 * World frame (patient lying supine, viewed from the front like an AP X-ray):
 *   +X = patient's LEFT   (appears on the viewer's right, as on a cath lab monitor)
 *   +Y = patient's HEAD   (superior)
 *   +Z = patient's FRONT  (anterior, towards the ceiling / X-ray detector)
 *
 * Heart-local frame (used for everything that sits on the beating heart):
 *   origin = centre of the heart's base, near where the aorta leaves the heart
 *   -Y     = towards the apex (the tip of the heart)
 *   +X     = patient's left, +Z = anterior (before the heart is tilted into place)
 */

export type Vec3 = [number, number, number];

/**
 * A point on the heart's surface.
 * az: angle around the heart's long axis in degrees
 *     0 = anterior (front), +90 = patient's left side, -90 = right side, ±180 = back.
 * t:  0 = the atrioventricular (AV) groove near the base, 1 = the apex.
 */
export interface SurfacePoint {
  az: number;
  t: number;
}

/** A point given explicitly in heart-local coordinates. */
export interface LocalPoint {
  local: Vec3;
}

/** Plain Vec3 = world coordinates. */
export type PathPoint = SurfacePoint | LocalPoint | Vec3;

export type VesselId =
  | 'access'
  | 'aorta'
  | 'lm'
  | 'lad'
  | 'd1'
  | 'd2'
  | 'lcx'
  | 'rca';

/** Which coronary system a vessel belongs to (decides what a selective injection fills). */
export type CoronarySystem = 'left' | 'right' | 'none';

export interface VesselSpec {
  id: VesselId;
  name: string;
  /** Learner-facing explanation shown in labels / tooltips. */
  description: string;
  /** Coronary arteries ride on the heart surface and move with each beat. */
  onHeart: boolean;
  system: CoronarySystem;
  /** Where this vessel connects to its parent (used for device paths and contrast flow). */
  joins?: { vessel: VesselId; at: number; end: 'start' | 'end' };
  /** Prepend the parent's point at `joins.at` so the branch grows out of the parent. */
  startAtParent?: boolean;
  points: PathPoint[];
  /** Lumen radius (mm) at each control point, or [start, end] for a linear taper. */
  radii: number[];
}

// ---------------------------------------------------------------------------
// Heart
// ---------------------------------------------------------------------------

export const HEART = {
  /** Where the heart's base sits in the chest (world). */
  position: [0, 0, 0] as Vec3,
  /**
   * The heart lies obliquely: its apex points to the patient's left, forwards and down.
   * We tilt a vertical heart 40° towards the left, then 25° forwards.
   */
  rotationDeg: { x: -25, z: 40 },
  /** Centre of the ventricular mass (heart-local). */
  center: [0, -50, 0] as Vec3,
  /** Half-widths of the ventricular ellipsoid: left-right, base-apex, front-back. */
  radii: [45, 55, 40] as Vec3,
  /** How much narrower the apex is than the base (0 = pure ellipsoid). */
  apexTaper: 0.35,
  /** The base (atria, valves) is flatter than an ellipsoid. */
  baseFlatten: 0.18,
  /** The right ventricle bulges forwards on the patient's right. */
  rvBulge: 6,
  /** Polar angle (deg from the base axis) of the AV groove, where t = 0. */
  grooveTheta: 30,
  /** Contraction per beat: fractional shortening of the ventricles. */
  pulse: { radial: 0.06, longitudinal: 0.05, systoleFraction: 0.38 },
  colors: { myocardium: [0.5, 0.13, 0.12] as Vec3, fat: [0.82, 0.68, 0.4] as Vec3 },
};

// ---------------------------------------------------------------------------
// The target lesion
// ---------------------------------------------------------------------------

export const LESION = {
  vessel: 'lad' as VesselId,
  /** Position along the LAD (0 = left main bifurcation, 1 = apex): mid LAD, between D1 and D2. */
  centerU: 0.37,
  /** Lesion length in mm (what the measure tool should report). */
  lengthMm: 14,
  /** Diameter stenosis: 0.9 = the narrowest point is only 10% of the normal diameter. */
  severity: 0.9,
};

// ---------------------------------------------------------------------------
// Vessels
// ---------------------------------------------------------------------------

/**
 * Ostia (openings) of the coronary arteries in the aortic root. The left main arises from
 * the LEFT coronary cusp, the RCA from the RIGHT (anterior) coronary cusp.
 */
const AORTIC_ROOT: LocalPoint = { local: [0, 8, 8] };
const LEFT_OSTIUM: LocalPoint = { local: [12, 10, 4] };
const RIGHT_OSTIUM: LocalPoint = { local: [-8, 10, 19] };

export const VESSELS: VesselSpec[] = [
  {
    id: 'aorta',
    name: 'Aorta',
    description:
      'The aorta carries blood from the left ventricle to the body. The coronary arteries start in its root, just above the aortic valve.',
    onHeart: false,
    system: 'none',
    points: [
      AORTIC_ROOT, // aortic root (sinuses of Valsalva)
      [-8, 35, 10], // ascending aorta
      [-10, 65, 0],
      [-2, 80, -18], // top of the arch
      [12, 72, -38],
      [18, 45, -42], // descending thoracic aorta
      [18, -40, -42],
      [16, -140, -38],
    ],
    radii: [14, 13.5, 12.5, 12, 11.5, 11, 10.5, 10],
  },
  {
    id: 'access',
    name: 'Radial access path',
    description:
      'Right radial access: the catheter enters at the wrist and travels up the radial, brachial, axillary and subclavian arteries, then the brachiocephalic trunk into the aortic arch.',
    onHeart: false,
    system: 'none',
    // `at` is recomputed from geometry (nearest aortic point to this vessel's end).
    joins: { vessel: 'aorta', at: 0.34, end: 'end' },
    points: [
      [-235, -75, 38], // right radial artery at the wrist (puncture site)
      [-210, -25, 32], // forearm
      [-185, 22, 26], // elbow: radial joins the brachial artery
      [-152, 68, 16], // brachial artery
      [-112, 100, 6], // axillary artery
      [-72, 112, -2], // subclavian artery
      [-42, 108, -5],
      [-22, 94, -5], // brachiocephalic trunk
      [-10, 72, -4], // enters the aortic arch
    ],
    radii: [1.3, 1.4, 1.8, 2.2, 3.0, 4.0, 4.6, 6.0, 6.5],
  },
  {
    id: 'lm',
    name: 'Left main (LM)',
    description:
      'The left main coronary artery is short (about 1–2 cm). It passes behind the pulmonary trunk and splits into the LAD and circumflex.',
    onHeart: true,
    system: 'left',
    joins: { vessel: 'aorta', at: 0.0, end: 'start' },
    points: [LEFT_OSTIUM, { local: [20, 4, 12] }, { az: 55, t: 0 }],
    radii: [2.3, 2.2],
  },
  {
    id: 'lad',
    name: 'Left anterior descending (LAD)',
    description:
      'The LAD runs down the front of the heart in the anterior interventricular groove to the apex. It supplies the front wall and most of the septum, so it is often called the most important coronary artery.',
    onHeart: true,
    system: 'left',
    joins: { vessel: 'lm', at: 1, end: 'start' },
    startAtParent: true,
    points: [
      { az: 40, t: 0.08 },
      { az: 25, t: 0.2 },
      { az: 18, t: 0.35 },
      { az: 14, t: 0.5 },
      { az: 10, t: 0.65 },
      { az: 6, t: 0.8 },
      { az: 0, t: 0.93 },
    ],
    radii: [1.75, 1.0],
  },
  {
    id: 'd1',
    name: 'First diagonal (D1)',
    description: 'Diagonal branches leave the LAD and run over the front-left (anterolateral) wall.',
    onHeart: true,
    system: 'left',
    joins: { vessel: 'lad', at: 0.22, end: 'start' },
    startAtParent: true,
    points: [
      { az: 40, t: 0.3 },
      { az: 60, t: 0.42 },
      { az: 75, t: 0.55 },
    ],
    radii: [1.25, 0.8],
  },
  {
    id: 'd2',
    name: 'Second diagonal (D2)',
    description: 'A smaller, more distal diagonal branch of the LAD.',
    onHeart: true,
    system: 'left',
    joins: { vessel: 'lad', at: 0.52, end: 'start' },
    startAtParent: true,
    points: [
      { az: 30, t: 0.6 },
      { az: 48, t: 0.72 },
      { az: 60, t: 0.82 },
    ],
    radii: [1.1, 0.7],
  },
  {
    id: 'lcx',
    name: 'Left circumflex (LCx)',
    description:
      'The circumflex curls around the left side of the heart in the AV groove and supplies the lateral and back wall.',
    onHeart: true,
    system: 'left',
    joins: { vessel: 'lm', at: 1, end: 'start' },
    startAtParent: true,
    points: [
      { az: 75, t: 0.02 },
      { az: 100, t: 0.04 },
      { az: 130, t: 0.07 },
      { az: 155, t: 0.12 },
      { az: 170, t: 0.24 },
    ],
    radii: [1.6, 1.0],
  },
  {
    id: 'rca',
    name: 'Right coronary artery (RCA)',
    description:
      'The RCA runs in the right AV groove around to the back of the heart and usually gives off the posterior descending artery (PDA).',
    onHeart: true,
    system: 'right',
    joins: { vessel: 'aorta', at: 0.0, end: 'start' },
    points: [
      RIGHT_OSTIUM,
      { az: -35, t: 0.02 },
      { az: -70, t: 0.03 },
      { az: -110, t: 0.06 },
      { az: -150, t: 0.1 },
      { az: -180, t: 0.18 },
      { az: -185, t: 0.35 },
      { az: -188, t: 0.55 },
    ],
    radii: [1.8, 1.1],
  },
];

/** Labels shown in the 3D view (toggle with L). */
export const LABELS: { vessel: VesselId; u: number; text: string }[] = [
  { vessel: 'aorta', u: 0.22, text: 'Aorta' },
  { vessel: 'lm', u: 0.5, text: 'LM' },
  { vessel: 'lad', u: 0.75, text: 'LAD' },
  { vessel: 'd1', u: 0.8, text: 'D1' },
  { vessel: 'd2', u: 0.8, text: 'D2' },
  { vessel: 'lcx', u: 0.55, text: 'LCx' },
  { vessel: 'rca', u: 0.45, text: 'RCA' },
  { vessel: 'access', u: 0.02, text: 'R radial a. (access)' },
  { vessel: 'access', u: 0.36, text: 'Brachial a.' },
  { vessel: 'access', u: 0.72, text: 'Subclavian a.' },
  { vessel: 'access', u: 0.93, text: 'Brachiocephalic' },
];

// ---------------------------------------------------------------------------
// Fluoroscopy (X-ray) settings
// ---------------------------------------------------------------------------

export interface CArmAngle {
  /** + = LAO (detector towards patient's left), - = RAO. Degrees. */
  lao: number;
  /** + = cranial (detector tilted towards the head), - = caudal. Degrees. */
  cra: number;
}

export const FLUORO = {
  /** Pulsed fluoroscopy frame rate (frames per second). */
  fps: 15,
  fovDeg: 18,
  /** Distance from the isocentre to the virtual X-ray camera (mm). */
  distance: 650,
  /** Render resolution relative to the screen (lower = softer, cheaper). */
  resolutionScale: 0.75,
  /** Quantum noise amplitude. */
  noise: 0.075,
  /** Brightness of an unobstructed (lung) field, 0–1. */
  background: 0.9,
  /** Standard C-arm projections. RAO cranial separates the LAD from its diagonals. */
  presets: [
    { name: 'RAO 30 CRA 30', lao: -30, cra: 30 },
    { name: 'AP CRA 35', lao: 0, cra: 35 },
    { name: 'LAO 45 CRA 30', lao: 45, cra: 30 },
    { name: 'LAO 45 CAU 30 (spider)', lao: 45, cra: -30 },
    { name: 'RAO 30 CAU 25', lao: -30, cra: -25 },
    { name: 'AP', lao: 0, cra: 0 },
  ] as ({ name: string } & CArmAngle)[],
  /** X-ray attenuation per mm (arbitrary teaching units, not physical constants). */
  mu: {
    softTissue: 0.0016,
    bone: 0.02,
    contrast: 0.5,
    unopacifiedBlood: 0.002,
  },
};

// ---------------------------------------------------------------------------
// Contrast and physiology
// ---------------------------------------------------------------------------

export const CONTRAST = {
  /** Speed of the contrast front in a normal coronary artery (mm/s). */
  speedMmPerS: 110,
  /** Duration of a hand injection (s). */
  injectSeconds: 2.2,
  /** Time for the dye to rise to full density at the start of an injection (s). */
  rampSeconds: 0.25,
  /** How much of the aortic root refluxes (fills) during a selective injection. */
  aorticReflux: 0.08,
};

export const PHYSIOLOGY = {
  baselineHR: 72,
};

/** Background (fluoro only) skeleton: gives the X-ray image its landmarks. */
export const SKELETON = {
  spine: { x: 0, z: -75, yFrom: -170, yTo: 170, bodyRadius: 18, bodyHeight: 22, gap: 5 },
  ribs: { count: 9, topY: 150, spacing: 32, radiusX: 140, radiusZ: 95, centerZ: -20, drop: 45, tube: 5 },
  diaphragm: { center: [10, -160, -10] as Vec3, radii: [185, 95, 140] as Vec3 },
};

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const DEVICES = {
  guide: {
    /** 6 French guide catheter: 6F = 2 mm outer diameter. */
    radius: 1.0,
    /** How far above the aortic root centre the guide can travel without engaging (fraction of aorta). */
    rootStopU: 0.03,
    /** Length of the pre-shaped curve at the tip (a Judkins/EBU-like hook), mm. */
    hookLength: 22,
    /** How far the hook swings the tip sideways, mm. */
    hookSize: 11,
    /** Engagement works when the tip points within this many degrees of the left coronary cusp. */
    engageToleranceDeg: 25,
    /** How far the guide seats into the left main once engaged, mm. */
    seatDepthMm: 4,
    /** Rotation error (deg) at which an engaged guide pops back out of the ostium. */
    disengageDeg: 40,
    /** Rotation angle when the tip first reaches the aortic root (deg; 0 = facing the left cusp). */
    initialRotationDeg: 250,
    speedMmPerS: 70,
    fineSpeedMmPerS: 15,
    rotateDegPerS: 90,
  },
  wire: {
    /** 0.014" coronary guidewire = 0.36 mm diameter (drawn slightly thicker so it stays visible). */
    radius: 0.18,
    visualRadius: 0.3,
    /** Radiopaque distal segment, mm. */
    tipOpaqueMm: 30,
    /** Small shaped bend at the tip used for steering, mm. */
    tipBendMm: 3,
    speedMmPerS: 25,
    fineSpeedMmPerS: 6,
    rotateDegPerS: 120,
    /** The wire enters a side branch when the tip points within this angle of it (deg). */
    branchCaptureDeg: 50,
    /** Safe advancing speed through the lesion (mm/s); faster = "forcing". */
    lesionSafeSpeed: 8,
    /** Hidden dissection risk added per mm/s of excess speed per second. */
    riskPerExcess: 0.004,
  },
  /** Contrast volume per injection (ml). */
  contrastMl: { selective: 8, aortic: 20 },
};
