// The duel arena: a tilted street-corner table rendered with Three.js. It
// owns the card meshes, the living creatures standing on their zones, chalk
// zones, particles, camera fitting and picking. It only ever DRAWS a board
// snapshot handed to it by the presenter; it never reads or writes rules state.
import * as THREE from 'three';
import { createFx } from './fx.js';
import { buildCutout, createCreatureMesh, creatureHeight, profileFor, floats } from './creature.js';
import { cardById, ART_BOX, ATTR_COLORS } from '../../engine/cards.js';

export const CARD_W = 1;
export const CARD_H = 1.46;
const COLX = [-3, -2, -1, 0, 1, 2, 3].map((c) => c * 1.2);
const ROWZ = { 0: { m: 1.62, s: 3.28 }, 1: { m: -1.62, s: -3.28 } };
const PITCH = THREE.MathUtils.degToRad(63);

export function zonePos(p, loc, i = 0) {
  const r = ROWZ[p];
  switch (loc) {
    case 'mz':
      return new THREE.Vector3(COLX[i + 1], 0, r.m);
    case 'sz':
      return new THREE.Vector3(COLX[i + 1], 0, r.s);
    case 'fz':
      return new THREE.Vector3(COLX[0], 0, r.m);
    case 'gy':
      return new THREE.Vector3(COLX[6], 0, r.m);
    case 'deck':
      return new THREE.Vector3(COLX[6], 0, r.s);
    case 'extra':
      return new THREE.Vector3(COLX[0], 0, r.s);
    default:
      return new THREE.Vector3(0, 0, 0);
  }
}

function chalkRectTexture(color = 'rgba(240,236,226,0.85)') {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 184;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.lineCap = 'round';
  // several jittered passes read as chalk on asphalt
  for (let pass = 0; pass < 4; pass++) {
    g.lineWidth = 2.2 + Math.random() * 1.2;
    g.globalAlpha = 0.35 + Math.random() * 0.25;
    g.beginPath();
    const j = () => (Math.random() - 0.5) * 3;
    const pts = [
      [8 + j(), 8 + j()],
      [120 + j(), 8 + j()],
      [120 + j(), 176 + j()],
      [8 + j(), 176 + j()],
      [8 + j(), 8 + j()],
    ];
    g.moveTo(...pts[0]);
    for (const p of pts.slice(1)) g.lineTo(...p);
    g.stroke();
  }
  // grain
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] && Math.random() < 0.35) img.data[i] *= 0.4;
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function frameGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 220;
  const g = c.getContext('2d');
  g.shadowColor = 'white';
  for (let i = 0; i < 4; i++) {
    g.shadowBlur = 8 + i * 8;
    g.strokeStyle = `rgba(255,255,255,${0.5 - i * 0.1})`;
    g.lineWidth = 6;
    g.strokeRect(22, 22, 116, 176);
  }
  return new THREE.CanvasTexture(c);
}

export function createArena(host, { cardBackImage, fxImage, fxFrames, creatureAsset, tweaks }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'arena-canvas';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const camTarget = new THREE.Vector3(0, 0, 0.15);
  let camDist = 14;
  let sway = 0;

  const loader = new THREE.TextureLoader();
  const faceTex = new Map();
  const getFace = (id) => {
    if (!faceTex.has(id)) {
      const t = loader.load(`${import.meta.env.BASE_URL}cards/s/${id}.jpg`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      faceTex.set(id, t);
    }
    return faceTex.get(id);
  };
  const backTex = new THREE.Texture(cardBackImage);
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.needsUpdate = true;
  const glowTex = glowTexture();
  const shadowTex = shadowTexture();
  const frameTex = frameGlowTexture();
  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const fx = createFx(scene, fxImage, fxFrames);

  // --- Board: chalk zones and their pick planes
  const zoneMeshes = [];
  const pickables = [];
  const chalk = chalkRectTexture();
  const chalkSpecial = chalkRectTexture('rgba(255,214,140,0.8)');
  const zoneGeo = new THREE.PlaneGeometry(CARD_W * 1.1, CARD_H * 1.08);
  for (const p of [0, 1]) {
    const defs = [];
    for (let i = 0; i < 5; i++) defs.push(['mz', i], ['sz', i]);
    defs.push(['fz', 0], ['gy', 0], ['deck', 0], ['extra', 0]);
    for (const [loc, i] of defs) {
      const special = !['mz', 'sz'].includes(loc);
      const m = new THREE.Mesh(zoneGeo, new THREE.MeshBasicMaterial({ map: special ? chalkSpecial : chalk, transparent: true, depthWrite: false, opacity: special ? 0.75 : 0.9 }));
      m.rotation.x = -Math.PI / 2;
      m.position.copy(zonePos(p, loc, i)).setY(0.001);
      m.renderOrder = 1;
      m.userData = { kind: 'zone', p, loc, i };
      scene.add(m);
      zoneMeshes.push(m);
      pickables.push(m);
      // legal-target highlight
      const hl = new THREE.Mesh(zoneGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffb547', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      hl.rotation.x = -Math.PI / 2;
      hl.position.copy(m.position).setY(0.004);
      hl.scale.set(1.25, 1.2, 1);
      hl.renderOrder = 2;
      scene.add(hl);
      m.userData.hl = hl;
    }
  }
  const zoneMesh = (p, loc, i = 0) => zoneMeshes.find((m) => m.userData.p === p && m.userData.loc === loc && m.userData.i === i);

  // --- Card entities
  const cards = new Map(); // uid -> entity
  function makeCard(uid, id) {
    const g = new THREE.Group();
    const faceMat = new THREE.MeshBasicMaterial({ map: id > 0 ? getFace(id) : backTex, transparent: true });
    const backMat = new THREE.MeshBasicMaterial({ map: backTex, transparent: true });
    const face = new THREE.Mesh(cardGeo, faceMat);
    const back = new THREE.Mesh(cardGeo, backMat);
    back.rotation.y = Math.PI;
    const glow = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: frameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: '#ffcc66' }));
    glow.scale.set(1.38, 1.3, 1);
    glow.position.z = -0.002;
    face.renderOrder = back.renderOrder = 3;
    glow.renderOrder = 2;
    g.add(glow, face, back);
    g.userData = { kind: 'card', uid };
    face.userData = back.userData = { kind: 'card', uid };
    scene.add(g);
    pickables.push(face, back);
    const e = { uid, id, g, face, back, glow, faceMat, cur: { pos: new THREE.Vector3(), rx: -Math.PI / 2, ry: 0, rz: 0, s: 1 }, tgt: null, locked: 0, view: null };
    cards.set(uid, e);
    return e;
  }
  function setCardFace(e, id) {
    if (e.id !== id) {
      e.id = id;
      e.faceMat.map = id > 0 ? getFace(id) : backTex;
      e.faceMat.needsUpdate = true;
    }
  }
  function removeCard(uid) {
    const e = cards.get(uid);
    if (!e) return;
    scene.remove(e.g);
    for (const m of [e.face, e.back]) {
      const i = pickables.indexOf(m);
      if (i >= 0) pickables.splice(i, 1);
    }
    e.glow.material.dispose();
    e.faceMat.dispose();
    cards.delete(uid);
  }
  function applyTransform(e) {
    const c = e.cur;
    e.g.position.copy(c.pos);
    e.g.rotation.set(c.rx, c.ry, c.rz, 'XYZ');
    e.g.scale.setScalar(c.s);
  }
  // Flat on the board, oriented for its controller; face-down shows the back.
  function boardPose(p, loc, i, up, pos) {
    const base = zonePos(p, loc, i);
    return {
      pos: base.setY(0.02),
      rx: -Math.PI / 2,
      ry: up ? 0 : Math.PI,
      rz: (p === 1 ? Math.PI : 0) + (pos === 'def' ? Math.PI / 2 : 0) * (up ? 1 : -1),
      s: 1,
    };
  }

  // --- Creatures
  const creatures = new Map(); // uid -> creature entity
  const cutouts = new Map();
  function cutoutFor(id) {
    if (!cutouts.has(id)) {
      const mask = creatureAsset(id);
      if (!mask) {
        cutouts.set(id, Promise.resolve(null));
      } else {
        cutouts.set(
          id,
          buildCutout(id, `${import.meta.env.BASE_URL}cards/art/${id}.jpg`, mask).catch((err) => {
            console.error('creature cutout failed', id, err);
            return null;
          })
        );
      }
    }
    return cutouts.get(id);
  }
  const ready = new Map(); // id -> cutout once loaded
  function invalidate(id) {
    cutouts.delete(id);
    ready.delete(id);
  }
  function prefetch(id) {
    cutoutFor(id).then((c) => c && ready.set(id, c));
  }
  function makeCreature(uid, id) {
    const def = cardById(id);
    const cut = ready.get(id);
    if (!def || !cut) return null;
    const mesh = createCreatureMesh(cut, def, ATTR_COLORS[def.attr] || '#ffffff');
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 4;
    scene.add(mesh, shadow);
    const prof = profileFor(def);
    const ce = {
      uid,
      id,
      def,
      mesh,
      shadow,
      height: creatureHeight(def),
      profile: prof,
      floats: floats(def, prof),
      p: 0,
      base: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      scale: 1,
      t: Math.random() * 10,
      crouch: 0,
      crouchTgt: 0,
      locked: false,
      hop: 0,
    };
    mesh.userData.uid = uid;
    creatures.set(uid, ce);
    pickables.push(mesh);
    return ce;
  }
  function removeCreature(uid) {
    const ce = creatures.get(uid);
    if (!ce) return;
    scene.remove(ce.mesh, ce.shadow);
    const i = pickables.indexOf(ce.mesh);
    if (i >= 0) pickables.splice(i, 1);
    ce.mesh.material.uniforms.uMap.value.dispose();
    ce.mesh.material.dispose();
    ce.mesh.geometry.dispose();
    creatures.delete(uid);
  }
  function creatureStand(ce, p, zone) {
    const base = zonePos(p, 'mz', zone);
    // stand at the card's far edge so the card itself stays readable
    base.z -= 0.62;
    ce.base.copy(base);
    ce.p = p;
  }

  // --- Piles: deck, extra deck and graveyard tops
  const piles = {};
  for (const p of [0, 1]) {
    for (const loc of ['deck', 'extra', 'gy']) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.01, CARD_H), [
        new THREE.MeshBasicMaterial({ color: '#c9a35a' }),
        new THREE.MeshBasicMaterial({ color: '#c9a35a' }),
        new THREE.MeshBasicMaterial({ map: backTex }),
        new THREE.MeshBasicMaterial({ color: '#2a0a0a' }),
        new THREE.MeshBasicMaterial({ color: '#c9a35a' }),
        new THREE.MeshBasicMaterial({ color: '#c9a35a' }),
      ]);
      m.position.copy(zonePos(p, loc));
      if (p === 1) m.rotation.y = Math.PI;
      m.visible = false;
      m.renderOrder = 3;
      m.userData = { kind: 'zone', p, loc, i: 0 };
      scene.add(m);
      pickables.push(m);
      piles[`${p}${loc}`] = m;
    }
  }
  function setPile(p, loc, count, topId) {
    const m = piles[`${p}${loc}`];
    m.visible = count > 0;
    const h = Math.max(0.01, Math.min(0.32, count * 0.006));
    m.scale.y = h / 0.01;
    m.position.y = h / 2;
    if (loc === 'gy') {
      const mat = m.material[2];
      const tex = topId ? getFace(topId) : backTex;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
  }

  // --- Snapshot application
  let lastSnap = null;
  function applySnap(snap, { instant = false } = {}) {
    lastSnap = snap;
    const seen = new Set();
    for (const [uid, z] of Object.entries(snap.zones)) {
      seen.add(uid);
      let e = cards.get(uid);
      if (!e) {
        e = makeCard(uid, z.up ? z.id : 0);
        const pose = boardPose(z.p, z.loc, z.i, z.up, z.pos);
        Object.assign(e.cur, pose, { pos: pose.pos.clone() });
        applyTransform(e);
      }
      if (z.up || (z.p === 0 && z.id)) setCardFace(e, z.id || e.id);
      e.tgt = boardPose(z.p, z.loc, z.i, z.up, z.pos);
      e.view = z;
      if (instant) {
        Object.assign(e.cur, e.tgt, { pos: e.tgt.pos.clone() });
        applyTransform(e);
      }
      // creature presence follows the board: face-up monsters stand on their zone
      if (z.loc === 'mz' && z.up) {
        let ce = creatures.get(uid);
        if (!ce) {
          prefetch(z.id);
          ce = makeCreature(uid, z.id);
          if (ce) {
            creatureStand(ce, z.p, z.i);
            ce.offset.set(0, 0, 0);
            ce.scale = 1;
          }
        } else if (!ce.locked) creatureStand(ce, z.p, z.i);
        if (ce) ce.crouchTgt = z.pos === 'def' ? 1 : 0;
      } else if (creatures.has(uid) && !creatures.get(uid).locked) removeCreature(uid);
    }
    for (const uid of [...cards.keys()]) if (!seen.has(uid) && !cards.get(uid).locked) removeCard(uid);
    for (const uid of [...creatures.keys()]) if (!seen.has(uid) && !creatures.get(uid).locked) removeCreature(uid);
    for (const p of [0, 1]) {
      setPile(p, 'deck', snap.deck[p], null);
      setPile(p, 'extra', snap.extra[p], null);
      setPile(p, 'gy', snap.gyCount[p], snap.gy[p] ? snap.gyIds?.[p] : null);
    }
  }

  // --- Camera fit: the whole board fits between the HUD bands at any aspect.
  const insets = { top: 80, bottom: 150, right: 44 };
  let W = 1;
  let H = 1;
  const corners = [];
  for (const x of [-4.2, 4.2]) for (const z of [-4.15, 4.15]) corners.push(new THREE.Vector3(x, 0, z));
  corners.push(new THREE.Vector3(0, 0.4, -2.3)); // opponent creatures' feet line
  function placeCamera(dist, swayX = 0) {
    camera.position.set(camTarget.x + swayX, camTarget.y + Math.sin(PITCH) * dist, camTarget.z + Math.cos(PITCH) * dist);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
  }
  function fit() {
    const bandTop = insets.top;
    const bandBot = H - insets.bottom;
    const bandH = Math.max(80, bandBot - bandTop);
    const shift = (bandTop + bandBot) / 2 - H / 2;
    camera.aspect = W / H;
    // shift the picture so the board centres in the band (and clears the phase rail)
    camera.setViewOffset(W, H, (insets.right - 4) / 2, -shift, W, H);
    camera.updateProjectionMatrix();
    let lo = 4;
    let hi = 60;
    const v = new THREE.Vector3();
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      placeCamera(mid);
      let ok = true;
      for (const c of corners) {
        v.copy(c).project(camera);
        const sx = ((v.x + 1) / 2) * W;
        const sy = ((1 - v.y) / 2) * H;
        if (sx < 4 || sx > W - insets.right || sy < bandTop - 2 || sy > bandTop + bandH + 2) {
          ok = false;
          break;
        }
      }
      if (ok) hi = mid;
      else lo = mid;
    }
    camDist = hi;
    placeCamera(camDist);
  }
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width;
    H = r.height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    fit();
  }
  function setInsets(top, bottom) {
    if (Math.abs(insets.top - top) > 1 || Math.abs(insets.bottom - bottom) > 1) {
      insets.top = top;
      insets.bottom = bottom;
      fit();
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // --- Projection helpers for the DOM overlay and animations
  const tmp = new THREE.Vector3();
  function project(v3) {
    tmp.copy(v3).project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H, behind: tmp.z > 1 };
  }
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function unproject(sx, sy, depth = 6) {
    ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(depth));
  }
  function pick(sx, sy) {
    ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.kind === 'card' || ud.kind === 'creature') return { kind: 'card', uid: ud.uid ?? h.object.userData.uid };
      if (ud.kind === 'zone') return { kind: 'zone', p: ud.p, loc: ud.loc, i: ud.i };
    }
    return null;
  }
  function highlight(list) {
    // list: [{p, loc, i, color}]
    for (const m of zoneMeshes) m.userData.hlOn = null;
    for (const h of list) {
      const m = zoneMesh(h.p, h.loc, h.i);
      if (m) m.userData.hlOn = h.color || '#ffb547';
    }
  }

  // --- Animation timelines (driven by dt only)
  const anims = [];
  function animate(dur, step, done) {
    const a = { t: 0, dur: Math.max(0.0001, dur), step, done };
    anims.push(a);
    if (dur <= 0.0001) {
      step(1);
      done && done();
      anims.splice(anims.indexOf(a), 1);
    }
    return a;
  }
  const ease = {
    out: (k) => 1 - Math.pow(1 - k, 3),
    inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    back: (k) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
    },
  };

  // --- Per-frame update
  let time = 0;
  function update(dt) {
    time += dt;
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.step(k);
      if (k >= 1) {
        anims.splice(i, 1);
        a.done && a.done();
      }
    }
    const lerpK = 1 - Math.exp(-dt * 12);
    for (const e of cards.values()) {
      if (e.locked || !e.tgt) continue;
      e.cur.pos.lerp(e.tgt.pos, lerpK);
      e.cur.rx += (e.tgt.rx - e.cur.rx) * lerpK;
      e.cur.ry += (e.tgt.ry - e.cur.ry) * lerpK;
      e.cur.rz += (e.tgt.rz - e.cur.rz) * lerpK;
      e.cur.s += (e.tgt.s - e.cur.s) * lerpK;
      applyTransform(e);
    }
    const amp = tweaks.get('creatureMotion');
    for (const ce of creatures.values()) {
      ce.t += dt;
      const u = ce.mesh.material.uniforms;
      u.uTime.value = ce.t;
      u.uAmp.value = amp;
      u.uHit.value = Math.max(0, u.uHit.value - dt * 2.5);
      ce.crouch += (ce.crouchTgt - ce.crouch) * lerpK;
      if (ce.locked) continue;
      const fl = ce.floats ? 0.35 + Math.sin(ce.t * 1.6) * 0.08 * amp : 0;
      let hop = 0;
      if (ce.profile === 'small') hop = Math.max(0, Math.sin(ce.t * 2.6)) * 0.12 * amp;
      const h = ce.height * ce.scale * (1 - ce.crouch * 0.18);
      placeCreature(ce, ce.base.clone().add(ce.offset).setY(fl + hop + ce.offset.y), h);
      // ambient particles for character
      if (Math.random() < dt * 1.2 * amp) {
        const head = ce.mesh.position.clone().setY(ce.mesh.position.y + h * 0.6);
        if (ce.def.race === 'Pyro' || ce.def.attr === 'FIRE') fx.bursts.embers(head);
        else if (ce.profile === 'aquatic') fx.bursts.mist(ce.mesh.position.clone());
      }
    }
    for (const m of zoneMeshes) {
      const hl = m.userData.hl;
      const target = m.userData.hlOn ? 0.55 + Math.sin(time * 5) * 0.2 : 0;
      if (m.userData.hlOn) hl.material.color.set(m.userData.hlOn);
      hl.material.opacity += (target - hl.material.opacity) * lerpK;
    }
    fx.update(dt);
    sway = Math.sin(time * 0.25) * 0.12 * tweaks.get('cameraSway');
    placeCamera(camDist, sway);
  }

  function placeCreature(ce, pos, h) {
    ce.mesh.position.copy(pos);
    ce.mesh.quaternion.copy(camera.quaternion);
    // stand upright relative to the board, but face the camera
    ce.mesh.scale.set(h, h, h);
    ce.shadow.position.set(pos.x, 0.006, pos.z + 0.05);
    const sw = h * ce.mesh.userData.aspect * 0.8;
    ce.shadow.scale.set(sw, sw * 0.45, 1);
    ce.shadow.material.opacity = 0.85 - Math.min(0.5, pos.y * 0.6);
  }

  function render() {
    renderer.render(scene, camera);
  }

  function destroy() {
    ro.disconnect();
    renderer.dispose();
    canvas.remove();
  }

  return {
    canvas,
    scene,
    camera,
    fx,
    cards,
    creatures,
    applySnap,
    lastSnap: () => lastSnap,
    makeCard,
    removeCard,
    setCardFace,
    applyTransform,
    boardPose,
    makeCreature,
    removeCreature,
    creatureStand,
    placeCreature,
    prefetch,
    invalidate,
    ready,
    cutoutFor,
    project,
    unproject,
    pick,
    highlight,
    setInsets,
    animate,
    ease,
    update,
    render,
    resize,
    destroy,
    zonePos,
    glowTex,
    frameTex,
    size: () => ({ W, H }),
    artBox: ART_BOX,
  };
}
