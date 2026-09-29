import { BufferAttribute, BufferGeometry, IcosahedronGeometry, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HEART } from '../config/anatomy';
import { heartSurfaceRadius } from './heartShape';

const DEG = 180 / Math.PI;

/**
 * Procedural heart (ventricles plus a rounded base). Vertex colours show epicardial fat, which
 * collects in the grooves where the coronary arteries run: the AV groove (RCA and circumflex)
 * and the interventricular grooves (LAD at the front, PDA at the back).
 */
export function buildHeartGeometry(): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(1, 48);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const d = new Vector3();
  const center = new Vector3(...HEART.center);
  const [mr, mg, mb] = HEART.colors.myocardium;
  const [fr, fg, fb] = HEART.colors.fat;

  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = heartSurfaceRadius(d);
    pos.setXYZ(i, center.x + d.x * r, center.y + d.y * r, center.z + d.z * r);

    const theta = Math.acos(Math.max(-1, Math.min(1, d.y))) * DEG; // 0 at base, 180 at apex
    const az = Math.atan2(d.x, d.z) * DEG; // 0 anterior, +90 left
    const avGroove = Math.exp(-(((theta - HEART.grooveTheta) / 9) ** 2));
    // The anterior interventricular groove curves from left-anterior at the base towards the apex.
    const t = (theta - HEART.grooveTheta) / (180 - HEART.grooveTheta);
    const antGroove = Math.exp(-(((az - (32 - 35 * t)) / 5) ** 2)) * smooth(theta, 35, 60) * 0.6;
    const postGroove = Math.exp(-(((Math.abs(az) - 178) / 6) ** 2)) * smooth(theta, 35, 60) * 0.6;
    const base = smooth(-theta, -35, -10); // atrial region above the groove: fattier
    const mottle = 0.5 + 0.5 * Math.sin(d.x * 23 + d.y * 17) * Math.sin(d.z * 19 - d.y * 11);
    const fat = Math.min(1, Math.max(avGroove, antGroove, postGroove) * 0.9 + base * 0.5 + mottle * 0.12);
    colors[i * 3] = mr + (fr - mr) * fat;
    colors[i * 3 + 1] = mg + (fg - mg) * fat;
    colors[i * 3 + 2] = mb + (fb - mb) * fat;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
