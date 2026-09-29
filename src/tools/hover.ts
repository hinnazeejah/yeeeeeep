import { Raycaster, Vector2, type Camera, type Mesh } from 'three';
import type { VesselId } from '../config/anatomy';
import type { AnatomyModel } from '../anatomy/anatomyModel';
import type { DeviceController } from './deviceController';
import type { ToolId } from './tools';

/** Which vessels each tool can act on (these light up under the cursor). */
const TARGETS: Partial<Record<ToolId, (id: VesselId, onHeart: boolean) => boolean>> = {
  guide: (id) => id === 'access' || id === 'aorta',
  wire: (_id, onHeart) => onHeart,
  balloon: (id) => id === 'lad',
  stent: (id) => id === 'lad',
  measure: (_id, onHeart) => onHeart,
};

/** Hover highlight + name tooltip in the 3D view for whatever the active tool can act on. */
export class HoverPicker {
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly label: HTMLElement;
  private pending: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly anatomy: AnatomyModel,
    private readonly devices: DeviceController,
  ) {
    this.label = document.createElement('div');
    this.label.id = 'hover-label';
    document.body.appendChild(this.label);
    canvas.addEventListener('pointermove', (e) => (this.pending = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerleave', () => {
      this.pending = null;
      this.clear();
    });
  }

  clear(): void {
    this.anatomy.setHighlight(null);
    this.devices.setGuideHighlight(false);
    this.label.style.display = 'none';
  }

  /** Call once per frame in the 3D view. */
  update(camera: Camera, enabled: boolean): void {
    if (!enabled || !this.pending) {
      if (!enabled) this.clear();
      return;
    }
    const { x, y } = this.pending;
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    const tool = this.devices.activeTool;
    const meshes: Mesh[] = [...this.devices.pickables.filter((m) => m.visible), ...this.anatomy.pickables];
    const hit = this.ray.intersectObjects(meshes, false)[0];

    let text = '';
    let vessel: VesselId | null = null;
    let guideHit = false;
    if (hit) {
      const name = hit.object.name;
      if (name === 'guide') {
        guideHit = tool === 'guide';
        text = 'Guide catheter';
      } else if (name === 'wire') {
        text = 'Guidewire';
      } else if (name === 'heart') {
        text = '';
      } else {
        const id = hit.object.userData.vessel as VesselId;
        const v = this.anatomy.vessels.get(id)!;
        const accept = TARGETS[tool];
        if (accept && accept(id, v.spec.onHeart)) vessel = id;
        text = v.spec.name;
      }
    }
    this.anatomy.setHighlight(vessel);
    this.devices.setGuideHighlight(guideHit);
    if (text) {
      this.label.textContent = text;
      this.label.style.display = 'block';
      this.label.style.left = `${x + 14}px`;
      this.label.style.top = `${y + 10}px`;
      this.label.classList.toggle('target', !!vessel || guideHit);
    } else {
      this.label.style.display = 'none';
    }
  }
}
