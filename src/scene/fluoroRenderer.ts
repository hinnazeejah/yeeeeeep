import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { FLUORO } from '../config/anatomy';

/**
 * Turns the attenuation image into something that looks like a cath lab monitor:
 * pulsed frames (15 fps), quantum noise ("mottle"), slight blur, a square collimated field and
 * vignetting. When the pedal is released the last frame is held (LIH, "last image hold").
 */
export class FluoroRenderer {
  private readonly target: WebGLRenderTarget;
  private readonly post: Scene;
  private readonly postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: ShaderMaterial;
  private sinceFrame = Infinity;
  private readonly clear = new Color();
  /** True once at least one frame has been acquired (otherwise the monitor is black). */
  hasImage = false;

  constructor(width: number, height: number) {
    this.target = new WebGLRenderTarget(1, 1);
    this.mat = new ShaderMaterial({
      uniforms: {
        tImage: { value: this.target.texture },
        uRes: { value: [1, 1] },
        uSeed: { value: 0 },
        uNoise: { value: FLUORO.noise },
        uAspect: { value: 1 },
        uHasImage: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tImage;
        uniform vec2 uRes;
        uniform float uSeed, uNoise, uAspect, uHasImage;
        varying vec2 vUv;
        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21) + uSeed);
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        void main() {
          vec2 px = 1.0 / uRes;
          // Slight softness of the imaging chain.
          float v = texture2D(tImage, vUv).r * 0.4
            + (texture2D(tImage, vUv + vec2(px.x, 0.0)).r + texture2D(tImage, vUv - vec2(px.x, 0.0)).r
            +  texture2D(tImage, vUv + vec2(0.0, px.y)).r + texture2D(tImage, vUv - vec2(0.0, px.y)).r) * 0.15;
          // Quantum mottle: grain is stronger where fewer photons arrive.
          vec2 g = floor(gl_FragCoord.xy / 1.6);
          float n = hash(g) + hash(g + 17.31) - 1.0;
          v += n * uNoise * (0.55 + 0.6 * v);
          v = pow(clamp(v, 0.0, 1.0), 1.3);
          // Square collimated field with soft edges, plus vignetting.
          vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
          float half_ = 0.47;
          float edge = max(abs(c.x), abs(c.y));
          float field = 1.0 - smoothstep(half_ - 0.004, half_, edge);
          float vig = 1.0 - 0.4 * smoothstep(0.15, 0.62, length(c));
          v *= vig * field * uHasImage;
          gl_FragColor = vec4(vec3(v), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.post = new Scene();
    this.post.add(new Mesh(new PlaneGeometry(2, 2), this.mat));
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width * FLUORO.resolutionScale));
    const h = Math.max(1, Math.floor(height * FLUORO.resolutionScale));
    this.target.setSize(w, h);
    this.mat.uniforms.uRes.value = [w, h];
    this.mat.uniforms.uAspect.value = width / height;
    this.sinceFrame = Infinity; // force a fresh acquisition
  }

  /**
   * @param live true while X-rays are on (pedal held or cine); false shows the last image hold.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, dt: number, live: boolean): void {
    this.sinceFrame += dt;
    if (live && this.sinceFrame >= 1 / FLUORO.fps) {
      this.sinceFrame = 0;
      renderer.getClearColor(this.clear);
      const alpha = renderer.getClearAlpha();
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(new Color(FLUORO.background, FLUORO.background, FLUORO.background), 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(this.clear, alpha);
      this.mat.uniforms.uSeed.value = Math.random() * 100;
      this.hasImage = true;
    }
    this.mat.uniforms.uHasImage.value = this.hasImage ? 1 : 0;
    renderer.render(this.post, this.postCam);
  }
}
