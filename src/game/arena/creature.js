// Living monsters: the creature painted on a card, cut from that exact card's
// artwork and animated as a bending 2.5D layer.
//
// Pixel rule: the cutout's pixels are the official artwork's pixels. The
// approved mask (src/assets.json CREATURE_<id>) contributes only its alpha:
// we draw the original art, then keep it where the mask is opaque
// (destination-in). Nothing is repainted.

import * as THREE from 'three';
import rigs from '../../data/creature-rigs.json';

const TEX_SIZE = 512;

// Motion profiles. Each Monster Type moves like what it is.
export const PROFILES = {
  generic: 0,
  dragon: 1,
  warrior: 2,
  caster: 3,
  aquatic: 4,
  machine: 5,
  beast: 6,
  fiend: 7,
  small: 8,
  rock: 9,
};

export function profileFor(def) {
  const override = rigs[def.id]?.profile;
  if (override) return override;
  const r = def.race;
  if (def.level != null && def.level <= 2 && ['Beast', 'Plant', 'Insect', 'Fairy', 'Aqua', 'Reptile', 'Fiend', 'Rock'].includes(r)) return 'small';
  if (['Dragon', 'Winged Beast'].includes(r)) return 'dragon';
  if (['Warrior', 'Beast-Warrior'].includes(r)) return 'warrior';
  if (['Spellcaster', 'Fairy', 'Thunder'].includes(r)) return 'caster';
  if (['Aqua', 'Fish', 'Sea Serpent'].includes(r)) return 'aquatic';
  if (r === 'Machine') return 'machine';
  if (['Beast', 'Dinosaur', 'Reptile', 'Insect', 'Plant'].includes(r)) return 'beast';
  if (['Fiend', 'Zombie', 'Pyro'].includes(r)) return 'fiend';
  if (r === 'Rock') return 'rock';
  return 'generic';
}

// Flyers hover above their zone instead of standing on it.
export function floats(def, profile) {
  if (rigs[def.id]?.floats != null) return rigs[def.id].floats;
  return profile === 'caster' || ['Dragon', 'Winged Beast', 'Fairy'].includes(def.race);
}

const imageCache = new Map();
function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`image failed: ${url}`));
        img.src = url;
      })
    );
  }
  return imageCache.get(url);
}

// Build (once per card) the cutout canvas and its rig: bounding box in the art,
// head / feet / side anchors measured from the mask, and an alignment score
// comparing the mask's own pixels to the original art (catches a mask that
// drifted from the painting).
const cutoutCache = new Map();
export function buildCutout(id, artUrl, maskUrl) {
  const key = `${id}|${maskUrl}`;
  if (cutoutCache.has(key)) return cutoutCache.get(key);
  const job = Promise.all([loadImage(artUrl), loadImage(maskUrl)]).then(([art, mask]) => {
    const c = document.createElement('canvas');
    c.width = c.height = TEX_SIZE;
    const g = c.getContext('2d', { willReadFrequently: true });
    // alignment: compare mask RGB with art RGB where opaque
    g.drawImage(mask, 0, 0, TEX_SIZE, TEX_SIZE);
    const mk = g.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
    g.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    g.drawImage(art, 0, 0, TEX_SIZE, TEX_SIZE);
    const ar = g.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
    let diff = 0;
    let n = 0;
    for (let i = 0; i < mk.length; i += 64) {
      if (mk[i + 3] > 200) {
        diff += Math.abs(mk[i] - ar[i]) + Math.abs(mk[i + 1] - ar[i + 1]) + Math.abs(mk[i + 2] - ar[i + 2]);
        n++;
      }
    }
    const alignment = n ? 1 - diff / (n * 3 * 255) : 0;
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0, TEX_SIZE, TEX_SIZE);
    g.globalCompositeOperation = 'source-over';
    const rig = measure(g.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data, TEX_SIZE);
    // Art Lab head anchor is stored in artwork coordinates (0..1 from top-left).
    const ha = rigs[id]?.anchors?.head;
    if (ha && ha.ax != null) rig.head = { x: (ha.ax - rig.box.x) / rig.box.w, y: 1 - (ha.ay - rig.box.y) / rig.box.h };
    return { canvas: c, rig, alignment, coverage: rig.coverage };
  });
  cutoutCache.set(key, job);
  return job;
}

function measure(px, S) {
  let minX = S;
  let minY = S;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const rowMin = new Array(S).fill(-1);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (px[(y * S + x) * 4 + 3] > 40) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (rowMin[y] < 0) rowMin[y] = x;
      }
    }
  }
  if (!count) return { box: { x: 0, y: 0, w: 1, h: 1 }, head: { x: 0.5, y: 0.85 }, coverage: 0 };
  // head: centre of the opaque pixels in the top 12% of the silhouette
  const topBand = minY + Math.max(4, (maxY - minY) * 0.12);
  let hx = 0;
  let hn = 0;
  for (let y = minY; y < topBand; y++) for (let x = minX; x <= maxX; x++) if (px[(y * S + x) * 4 + 3] > 40) (hx += x), hn++;
  const box = { x: minX / S, y: minY / S, w: (maxX - minX + 1) / S, h: (maxY - minY + 1) / S };
  // anchors in box-local uv (0..1, y up)
  const head = { x: ((hn ? hx / hn : (minX + maxX) / 2) - minX) / (maxX - minX + 1), y: 0.9 };
  return { box, head, coverage: count / (S * S) };
}

// ---------------------------------------------------------------------------
// Material: vertex deformation per motion profile, dissolve and hit flash.
// ---------------------------------------------------------------------------

const vert = /* glsl */ `
uniform float uTime;
uniform float uProfile;
uniform float uAmp;
uniform float uAttack;
uniform float uHit;
uniform float uFlat;
uniform vec2 uHead;
uniform float uDir;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vec3 p = position;
  float t = uTime;
  float side = abs(uv.x - 0.5);
  float breath = sin(t * 2.0) * 0.012 * uv.y;
  p.y *= 1.0 + breath * uAmp;
  // head region
  float hd = distance(uv, uHead);
  float head = exp(-hd * hd / 0.03);
  if (uProfile < 1.5 && uProfile > 0.5) {
    // dragon / winged: wings flap, tail sways, head bobs; attack rears back then strikes
    float wing = smoothstep(0.16, 0.48, side) * smoothstep(0.2, 0.65, uv.y);
    p.y += sin(t * 3.2) * 0.055 * wing * uAmp;
    p.x *= 1.0 + sin(t * 3.2) * 0.05 * wing * uAmp + uAttack * 0.12 * wing;
    float tail = smoothstep(0.35, 0.0, uv.y) * smoothstep(0.15, 0.45, side);
    p.x += sin(t * 2.4) * 0.03 * tail * uAmp;
    p.y += sin(t * 2.0 + 1.0) * 0.02 * head * uAmp;
    p.z += uAttack * 0.35 * head;
    p.x += uAttack * 0.08 * head * uDir;
  } else if (uProfile < 2.5) {
    // warrior: weight shift, weapon-side lean; attack winds up and slashes
    p.x += sin(t * 1.3) * 0.018 * uv.y * uAmp;
    p.x += uAttack * 0.22 * uv.y * uv.y * uDir;
    p.z += uAttack * 0.15 * uv.y;
  } else if (uProfile < 3.5) {
    // spellcaster: robes ripple, hands drift
    p.x += sin(uv.y * 5.0 + t * 1.8) * 0.012 * (1.0 - uv.y) * uAmp;
    p.x += sin(t * 1.6) * 0.02 * smoothstep(0.25, 0.5, side) * uv.y * uAmp;
    p.y += uAttack * 0.06 * uv.y;
  } else if (uProfile < 4.5) {
    // aquatic: body undulates
    p.x += sin(uv.y * 6.0 + t * 2.6) * 0.022 * uAmp;
    p.y += sin(uv.x * 5.0 + t * 2.0) * 0.012 * uAmp;
  } else if (uProfile < 5.5) {
    // machine: idle vibration, recoil on attack
    p.x += sin(t * 37.0) * 0.003 * uAmp;
    p.y += sin(t * 41.0 + uv.x * 3.0) * 0.003 * uAmp;
    p.z -= uAttack * 0.08;
  } else if (uProfile < 6.5) {
    // beast: deep breaths, crouch to pounce
    p.y *= 1.0 + sin(t * 1.7) * 0.02 * uAmp - uAttack * 0.12;
    p.x *= 1.0 + uAttack * 0.06;
    p.y += sin(t * 2.0) * 0.015 * head * uAmp;
  } else if (uProfile < 7.5) {
    // fiend: unsettling wobble
    p.x += sin(uv.y * 4.0 + t * 2.1) * 0.02 * uv.y * uAmp;
    p.x += uAttack * 0.12 * uv.y * uDir;
  } else if (uProfile < 8.5) {
    // small: springy squash
    p.y *= 1.0 - uAttack * 0.18;
    p.x *= 1.0 + uAttack * 0.12;
  } else {
    // rock: slow heavy settle
    p.y *= 1.0 + sin(t * 0.9) * 0.01 * uAmp;
    p.x *= 1.0 + uAttack * 0.05;
  }
  // hit reaction: violent shake that decays
  p.x += sin(t * 60.0) * 0.05 * uHit;
  // flat (lying in the card) -> no deformation
  p = mix(p, position, uFlat);
  vShade = 0.86 + 0.14 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uCrop;
uniform float uOpacity;
uniform float uHit;
uniform float uDissolve;
uniform vec3 uRim;
uniform vec3 uLight;
uniform float uGlow;
varying vec2 vUv;
varying float vShade;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
void main() {
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  vec4 c = texture2D(uMap, uv);
  if (c.a < 0.08) discard;
  // street light: warm key from above, teal fill below
  vec3 col = c.rgb * mix(vec3(0.78, 0.86, 0.9), uLight, vShade);
  // attribute rim on the silhouette edge (cheap: brighten near-transparent pixels)
  float edge = smoothstep(0.85, 0.25, c.a);
  col += uRim * edge * (0.5 + uGlow);
  col += uRim * uGlow * 0.25;
  col = mix(col, vec3(1.0), uHit * 0.55);
  float n = noise(vUv * 18.0);
  if (uDissolve > 0.0) {
    if (n < uDissolve) discard;
    float burn = smoothstep(uDissolve + 0.08, uDissolve, n);
    col = mix(col, uRim * 2.2 + vec3(0.4), burn);
  }
  gl_FragColor = vec4(col, c.a * uOpacity);
}
`;

export function createCreatureMesh(cutout, def, attrColor) {
  const { canvas, rig } = cutout;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const box = rig.box;
  const aspect = box.w / box.h;
  const geo = new THREE.PlaneGeometry(aspect, 1, 18, 18);
  geo.translate(0, 0.5, 0); // origin at the feet
  const profile = profileFor(def);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: tex },
      uCrop: { value: new THREE.Vector4(box.x, 1 - box.y - box.h, box.w, box.h) },
      uTime: { value: Math.random() * 10 },
      uProfile: { value: PROFILES[profile] },
      uAmp: { value: 1 },
      uAttack: { value: 0 },
      uHit: { value: 0 },
      uFlat: { value: 0 },
      uHead: { value: new THREE.Vector2(rig.head.x, rig.head.y) },
      uDir: { value: 1 },
      uOpacity: { value: 1 },
      uDissolve: { value: 0 },
      uRim: { value: new THREE.Color(attrColor) },
      uLight: { value: new THREE.Color('#ffd9a0') },
      uGlow: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 10;
  mesh.userData = { kind: 'creature', profile, aspect, rig };
  return mesh;
}

// How big a creature stands on the field (world units, height), by Level.
export function creatureHeight(def) {
  const base = rigs[def.id]?.height;
  if (base) return base;
  const lv = def.level ?? 4;
  return lv >= 7 ? 3.5 : lv >= 5 ? 3.05 : lv <= 2 ? 2.1 : 2.6;
}
