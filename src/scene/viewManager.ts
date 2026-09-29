import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { FLUORO, type CArmAngle } from '../config/anatomy';
import { heartCenterWorld } from '../anatomy/heartShape';
import type { ViewMode } from '../state/store';
import { FluoroRenderer } from './fluoroRenderer';

const DEG = Math.PI / 180;

/**
 * Owns the renderer, both scenes and both cameras.
 *  - 3D view: free orbit camera, lit anatomy.
 *  - Fluoro view: a virtual C-arm pointed at the heart; angle set in LAO/RAO and cranial/caudal.
 */
export class ViewManager {
  readonly renderer: WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene3d = new Scene();
  readonly sceneFluoro = new Scene();
  readonly camera3d: PerspectiveCamera;
  readonly cameraFluoro: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly fluoro: FluoroRenderer;
  readonly isocenter: Vector3;
  /** Hook to update label styling just before labels are drawn. */
  onBeforeLabels?: (camera: PerspectiveCamera) => void;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(0x06080b, 1);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.isocenter = heartCenterWorld();

    this.camera3d = new PerspectiveCamera(40, 1, 1, 5000);
    this.camera3d.position.copy(this.isocenter).add(new Vector3(90, 70, 320));
    this.controls = new OrbitControls(this.camera3d, this.renderer.domElement);
    this.controls.target.copy(this.isocenter);
    this.controls.enableDamping = true;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 1200;

    this.cameraFluoro = new PerspectiveCamera(FLUORO.fovDeg, 1, 10, 3000);

    this.scene3d.background = new Color(0x06080b);
    this.scene3d.add(new HemisphereLight(0xd8e0ea, 0x2a0c0c, 0.55));
    this.scene3d.add(new AmbientLight(0xffffff, 0.15));
    const key = new DirectionalLight(0xfff2e0, 2.2);
    key.position.set(150, 250, 300);
    this.scene3d.add(key);
    const rim = new DirectionalLight(0x9ab0d0, 0.6);
    rim.position.set(-250, 50, -200);
    this.scene3d.add(rim);

    this.fluoro = new FluoroRenderer(1, 1);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera3d.aspect = w / h;
    this.camera3d.updateProjectionMatrix();
    this.cameraFluoro.aspect = w / h;
    this.cameraFluoro.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fluoro.setSize(w * pr, h * pr);
  }

  /** Point the virtual C-arm. The camera sits where the X-ray detector is (above the patient). */
  setCArm(a: CArmAngle): void {
    const dir = new Vector3(
      Math.sin(a.lao * DEG) * Math.cos(a.cra * DEG),
      Math.sin(a.cra * DEG),
      Math.cos(a.lao * DEG) * Math.cos(a.cra * DEG),
    );
    this.cameraFluoro.position.copy(this.isocenter).addScaledVector(dir, FLUORO.distance);
    this.cameraFluoro.up.set(0, 1, 0);
    this.cameraFluoro.lookAt(this.isocenter);
  }

  render(view: ViewMode, dt: number, xrayOn: boolean): void {
    if (view === '3d') {
      this.controls.update();
      this.renderer.render(this.scene3d, this.camera3d);
      this.labelRenderer.domElement.style.display = '';
      this.onBeforeLabels?.(this.camera3d);
      this.labelRenderer.render(this.scene3d, this.camera3d);
    } else {
      this.labelRenderer.domElement.style.display = 'none';
      this.fluoro.render(this.renderer, this.sceneFluoro, this.cameraFluoro, dt, xrayOn);
    }
  }
}
