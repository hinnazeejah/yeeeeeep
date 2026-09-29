import type { GuideCatheter } from '../physics/guideCatheter';
import type { Guidewire } from '../physics/guidewire';

export type ToolId = 'guide' | 'wire' | 'balloon' | 'stent' | 'contrast' | 'fluoro' | 'measure';

/**
 * modal:  selecting it makes it the active tool (the one W/S/A/D and the wheel drive)
 * action: fires once (contrast injection)
 * hold:   active only while held (fluoro pedal)
 */
export type ToolKind = 'modal' | 'action' | 'hold';

export interface ToolDef {
  id: ToolId;
  key: string;
  name: string;
  /** Label on the toolbar button. */
  short: string;
  kind: ToolKind;
  cursor: string;
  icon: string;
  rules: string[];
}

export interface ToolContext {
  guide: GuideCatheter;
  wire: Guidewire;
}

const svgCursor = (body: string, hx = 12, hy = 12, fallback = 'crosshair'): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round'>${body}</svg>`,
  )}") ${hx} ${hy}, ${fallback}`;

const ring = (color: string) =>
  `<circle cx='12' cy='12' r='5' stroke='black' stroke-width='3'/><circle cx='12' cy='12' r='5' stroke='${color}' stroke-width='1.5'/>`;

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const TOOLS: ToolDef[] = [
  {
    id: 'guide',
    key: '1',
    name: 'Guide catheter',
    short: 'Guide',
    kind: 'modal',
    cursor: svgCursor(ring('#4fd1c5') + `<path d='M12 2v5M12 17v5' stroke='#4fd1c5' stroke-width='1.5'/>`),
    icon: icon('<path d="M3 20c6 0 8-4 9-8s2-7 6-8c2-.5 3 1 2 2.5"/>'),
    rules: [
      'W/S or wheel: advance / retract. A/D: rotate. Shift: fine control.',
      'Advance up the arm to the aortic root, then rotate the curved tip to face the left coronary cusp.',
      'Advance gently to engage the left main. Too much torque pops it back out.',
      'The guide cannot move while the wire is out in the coronary.',
    ],
  },
  {
    id: 'wire',
    key: '2',
    name: 'Guidewire',
    short: 'Wire',
    kind: 'modal',
    cursor: svgCursor(ring('#e6edf2') + `<path d='M12 7l3-3' stroke='#e6edf2' stroke-width='1.5'/>`),
    icon: icon('<path d="M3 21c5-2 7-6 9-10s4-7 7-7"/><path d="M19 4l2-1"/>'),
    rules: [
      'Requires the guide engaged in the left main.',
      'W/S or wheel: advance / retract. A/D: rotate the shaped tip.',
      'At each branch the tip direction picks the vessel. Watch the panel hint and the fluoro image.',
      'Cross the lesion slowly (Shift). Forcing a buckling wire can dissect the artery.',
    ],
  },
  {
    id: 'balloon',
    key: '3',
    name: 'Balloon',
    short: 'Balloon',
    kind: 'modal',
    cursor: svgCursor(ring('#f0b429')),
    icon: icon('<path d="M2 12h4"/><rect x="6" y="9" width="11" height="6" rx="3"/><path d="M17 12h5"/>'),
    rules: ['Requires the wire across the lesion into the distal LAD.', 'Position over the lesion, then inflate with the pressure dial (atm).'],
  },
  {
    id: 'stent',
    key: '4',
    name: 'Stent',
    short: 'Stent',
    kind: 'modal',
    cursor: svgCursor(ring('#9fb4c7')),
    icon: icon('<path d="M2 12h3"/><path d="M5 9l3 6 3-6 3 6 3-6 2 3-2 3"/><path d="M19 12h3"/>'),
    rules: ['Requires the lesion to be pre-dilated.', 'Choose a size, position across the lesion, deploy with pressure.'],
  },
  {
    id: 'contrast',
    key: '5',
    name: 'Contrast (cine)',
    short: 'Contrast',
    kind: 'action',
    cursor: 'copy',
    icon: icon('<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>'),
    rules: [
      'Press 5 or C to inject and record a cine run.',
      'With the guide engaged the dye fills the left coronary tree (selective).',
      'With the guide in the aortic root it is an aortic flush (uses more contrast).',
    ],
  },
  {
    id: 'fluoro',
    key: '6',
    name: 'Fluoro pedal',
    short: 'Fluoro',
    kind: 'hold',
    cursor: 'default',
    icon: icon('<rect x="5" y="14" width="14" height="6" rx="1.5"/><path d="M8 14l2-8h4l2 8"/>'),
    rules: ['Hold 6 or Space for live X-ray. Fluoro time counts while held.', 'Release to keep the last image on screen (LIH).'],
  },
  {
    id: 'measure',
    key: '7',
    name: 'Measure',
    short: 'Measure',
    kind: 'modal',
    cursor: svgCursor(`<path d='M4 20L20 4M7 17l2 2M10 14l2 2M13 11l2 2M16 8l2 2' stroke='black' stroke-width='3'/><path d='M4 20L20 4M7 17l2 2M10 14l2 2M13 11l2 2M16 8l2 2' stroke='#5ee27a' stroke-width='1.3'/>`, 4, 20),
    icon: icon('<path d="M4 20L20 4"/><path d="M7 17l2 2M10 14l2 2M13 11l2 2M16 8l2 2"/>'),
    rules: ['Shows reference vessel diameter and lesion length (QCA).'],
  },
];

export const TOOL_BY_KEY = new Map(TOOLS.map((t) => [t.key, t]));

/** Whether a tool can be used right now, and if not, why. */
export function toolAvailability(id: ToolId, ctx: ToolContext): { ok: boolean; reason?: string } {
  switch (id) {
    case 'guide':
    case 'fluoro':
      return { ok: true };
    case 'wire':
      return ctx.guide.engaged ? { ok: true } : { ok: false, reason: 'Engage the left main with the guide catheter first.' };
    case 'contrast':
      return ctx.guide.inAorta ? { ok: true } : { ok: false, reason: 'The guide tip must be in the aorta to inject.' };
    case 'balloon':
    case 'stent':
    case 'measure':
      return { ok: false, reason: 'Coming in milestone 4.' };
  }
}
