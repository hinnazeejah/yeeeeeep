import { AddEquation, CustomBlending, DstColorFactor, FrontSide, ShaderMaterial, ZeroFactor } from 'three';
import { FLUORO } from '../config/anatomy';

/**
 * X-ray image formation, simplified.
 *
 * Every object multiplies the image by its transmittance exp(-mu * thickness), so overlapping
 * structures add their attenuation just like on a real radiograph. Depth testing is off because
 * X-rays pass through everything. The framebuffer starts bright (lung field) and objects darken it.
 */
function multiplyBlend(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = DstColorFactor;
  m.blendDst = ZeroFactor;
  m.depthTest = false;
  m.depthWrite = false;
  m.side = FrontSide;
  return m;
}

const commonVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * A solid body of roughly uniform density. Path length through it is approximated from how
 * face-on the surface is: thickest through the middle, thinnest at the silhouette edge.
 * `rim` > 0 darkens the edges instead (cortical bone looks like a bright tube with dark walls).
 */
export function createBodyMaterial(mu: number, size: number, rim = 0): ShaderMaterial {
  return multiplyBlend(
    new ShaderMaterial({
      uniforms: { uMu: { value: mu }, uSize: { value: size }, uRim: { value: rim } },
      vertexShader: commonVertex,
      fragmentShader: /* glsl */ `
        uniform float uMu, uSize, uRim;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float th = mix(pow(facing, 0.6), 1.0 - facing * 0.7, uRim);
          gl_FragColor = vec4(vec3(exp(-uMu * uSize * th)), 1.0);
        }
      `,
    }),
  );
}

/**
 * Vessel material: almost invisible when filled with blood, dark when filled with contrast.
 * Darkness depends on the local lumen diameter (aR), so a tight stenosis looks thin AND faint,
 * exactly as it does on a real angiogram.
 */
export function createVesselFluoroMaterial(gain = 1): ShaderMaterial {
  return multiplyBlend(
    new ShaderMaterial({
      uniforms: {
        uFront: { value: -1 },
        uTail: { value: -10 },
        uDensity: { value: 0 },
        uGain: { value: gain },
        uMaxT: { value: 1e6 },
        uMuContrast: { value: FLUORO.mu.contrast },
        uMuBlood: { value: FLUORO.mu.unopacifiedBlood },
      },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aR;
        varying vec3 vN;
        varying vec3 vV;
        varying float vT;
        varying float vR;
        void main() {
          vT = aT;
          vR = aR;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFront, uTail, uDensity, uGain, uMaxT, uMuContrast, uMuBlood;
        varying vec3 vN;
        varying vec3 vV;
        varying float vT;
        varying float vR;
        void main() {
          // Chord length through a cylinder of radius vR seen at this pixel.
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float chord = 2.0 * vR * facing;
          // Soft-edged dye front and washout tail (in arrival-time seconds).
          float filled = smoothstep(vT - 0.06, vT + 0.02, uFront) * (1.0 - smoothstep(vT - 0.1, vT + 0.2, uTail));
          filled *= 1.0 - smoothstep(uMaxT * 0.6, uMaxT, vT);
          float mu = uMuBlood + uMuContrast * filled * uDensity * uGain;
          gl_FragColor = vec4(vec3(exp(-mu * chord)), 1.0);
        }
      `,
    }),
  );
}

/**
 * Devices on X-ray. Each vertex carries its own attenuation (aMu) so one tube can have a
 * faint shaft and a strongly radiopaque tip (guidewires) or marker bands (balloons, stents).
 */
export function createDeviceFluoroMaterial(radius: number): ShaderMaterial {
  return multiplyBlend(
    new ShaderMaterial({
      uniforms: { uRadius: { value: radius } },
      vertexShader: /* glsl */ `
        attribute float aMu;
        varying vec3 vN;
        varying vec3 vV;
        varying float vMu;
        void main() {
          vMu = aMu;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uRadius;
        varying vec3 vN;
        varying vec3 vV;
        varying float vMu;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float chord = 2.0 * uRadius * mix(0.35, 1.0, facing);
          gl_FragColor = vec4(vec3(exp(-vMu * chord)), 1.0);
        }
      `,
    }),
  );
}
