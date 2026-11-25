// Particle effects drawn from the generated FX atlas. Code only spawns, moves,
// tints and fades copies of the painted particles; it never draws its own.
import * as THREE from 'three';

export function createFx(scene, atlasImage, frames) {
  const base = new THREE.Texture(atlasImage);
  base.colorSpace = THREE.SRGBColorSpace;
  base.needsUpdate = true;
  const W = atlasImage.width;
  const H = atlasImage.height;
  const mats = {};
  for (const f of frames) {
    const r = f.content || f.source;
    const t = base.clone();
    t.needsUpdate = true;
    t.repeat.set(r.w / W, r.h / H);
    t.offset.set(r.x / W, 1 - (r.y + r.h) / H);
    mats[f.name] = { tex: t, aspect: r.w / r.h };
  }
  const live = [];
  const pool = [];

  function spawn(name, opts) {
    const m = mats[name];
    if (!m) return null;
    let s = pool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
      s.renderOrder = 50;
    }
    s.material.map = m.tex;
    s.material.blending = opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    s.material.color.set(opts.color || '#ffffff');
    s.material.opacity = 1;
    s.material.rotation = opts.rot ?? Math.random() * Math.PI * 2;
    s.material.needsUpdate = true;
    s.position.copy(opts.pos);
    s.visible = true;
    scene.add(s);
    const p = {
      s,
      aspect: m.aspect,
      vel: opts.vel ? opts.vel.clone() : new THREE.Vector3(),
      acc: opts.acc ? opts.acc.clone() : new THREE.Vector3(),
      size0: opts.size ?? 0.4,
      size1: opts.size1 ?? opts.size ?? 0.4,
      spin: opts.spin ?? 0,
      life: opts.life ?? 0.6,
      age: -(opts.delay || 0),
      fadeIn: opts.fadeIn ?? 0.08,
      drag: opts.drag ?? 0,
    };
    s.visible = p.age >= 0;
    live.push(p);
    return p;
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      if (p.age < 0) continue;
      p.s.visible = true;
      const k = p.age / p.life;
      if (k >= 1) {
        p.s.visible = false;
        scene.remove(p.s);
        pool.push(p.s);
        live.splice(i, 1);
        continue;
      }
      p.vel.addScaledVector(p.acc, dt);
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.material.rotation += p.spin * dt;
      const size = p.size0 + (p.size1 - p.size0) * k;
      p.s.scale.set(size * p.aspect, size, 1);
      const fade = Math.min(1, p.age / p.fadeIn) * (1 - Math.pow(k, 2));
      p.s.material.opacity = fade;
    }
  }

  function clear() {
    for (const p of live) {
      scene.remove(p.s);
      pool.push(p.s);
    }
    live.length = 0;
  }

  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const rnd = (a) => (Math.random() * 2 - 1) * a;

  // Ready-made bursts used by the presenter.
  const bursts = {
    impact(pos, color = '#ffd37a', scale = 1) {
      spawn('impact_star', { pos, size: 0.4 * scale, size1: 1.4 * scale, life: 0.35, color });
      for (let i = 0; i < 10; i++) spawn('spark', { pos, vel: v(rnd(3), Math.random() * 3, rnd(3)), acc: v(0, -6, 0), size: 0.18, size1: 0.05, life: 0.5, color });
    },
    shatter(pos, color = '#bfefff') {
      for (let i = 0; i < 18; i++) spawn('shard', { pos: pos.clone().add(v(rnd(0.4), Math.random() * 0.9, rnd(0.2))), vel: v(rnd(2.6), 1 + Math.random() * 2.5, rnd(1.5)), acc: v(0, -7, 0), size: 0.22 + Math.random() * 0.18, life: 0.9, spin: rnd(8), color });
      for (let i = 0; i < 6; i++) spawn('smoke', { pos: pos.clone().add(v(rnd(0.3), 0.3, 0)), vel: v(rnd(0.5), 0.6, 0), size: 0.5, size1: 1.2, life: 0.9, additive: false, color: '#5b6670' });
    },
    breath(from, to, color = '#ffffff', n = 22) {
      const dir = to.clone().sub(from);
      for (let i = 0; i < n; i++) {
        const sp = dir.clone().multiplyScalar(1.6 + Math.random() * 0.5).add(v(rnd(0.5), rnd(0.5), rnd(0.5)));
        spawn('flame_puff', { pos: from.clone(), vel: sp, size: 0.25, size1: 0.9, life: 0.55, delay: i * 0.018, color, drag: 0.8 });
      }
    },
    orbs(from, to, color = '#c6b6ff', n = 5) {
      const dir = to.clone().sub(from);
      for (let i = 0; i < n; i++) spawn('energy_orb', { pos: from.clone(), vel: dir.clone().multiplyScalar(2.4), size: 0.35, size1: 0.25, life: 0.42, delay: i * 0.06, color });
    },
    water(from, to, n = 18) {
      const dir = to.clone().sub(from);
      for (let i = 0; i < n; i++) spawn('water_drop', { pos: from.clone(), vel: dir.clone().multiplyScalar(1.8).add(v(rnd(0.6), rnd(0.4) + 0.6, rnd(0.4))), acc: v(0, -3, 0), size: 0.18, size1: 0.12, life: 0.55, delay: i * 0.015, rot: 0 });
    },
    slash(pos, dir = 1) {
      spawn('slash_arc', { pos, size: 0.5, size1: 1.5, life: 0.3, rot: dir > 0 ? -0.6 : 0.6 + Math.PI });
    },
    sparks(pos, color = '#fff3a0', n = 14) {
      for (let i = 0; i < n; i++) spawn('spark', { pos: pos.clone().add(v(rnd(0.3), rnd(0.3), 0)), vel: v(rnd(2), rnd(2) + 1, rnd(1)), size: 0.2, size1: 0.05, life: 0.5, color });
    },
    gears(pos) {
      for (let i = 0; i < 5; i++) spawn('gear', { pos, vel: v(rnd(1.6), 1.5 + Math.random(), rnd(0.6)), acc: v(0, -5, 0), size: 0.2, life: 0.8, spin: rnd(10), additive: false });
    },
    circle(pos, color = '#ffd27a') {
      spawn('magic_circle', { pos, size: 0.3, size1: 2.0, life: 0.9, spin: 2, color, rot: 0 });
    },
    shield(pos) {
      spawn('shield_hex', { pos, size: 0.6, size1: 1.6, life: 0.5, color: '#7fe3ff', rot: 0 });
    },
    smoke(pos, n = 6) {
      for (let i = 0; i < n; i++) spawn('smoke', { pos: pos.clone().add(v(rnd(0.5), 0.05, rnd(0.3))), vel: v(rnd(0.8), 0.4, rnd(0.3)), size: 0.4, size1: 1.0, life: 0.8, additive: false, color: '#6b6258' });
    },
    mist(pos) {
      for (let i = 0; i < 2; i++) spawn('smoke', { pos: pos.clone().add(v(rnd(0.5), Math.random() * 0.8, 0)), vel: v(rnd(0.2), 0.25, 0), size: 0.5, size1: 0.9, life: 1.6, additive: true, color: '#3c8fb5' });
    },
    embers(pos) {
      spawn('flame_puff', { pos: pos.clone().add(v(rnd(0.4), Math.random() * 0.6, 0)), vel: v(rnd(0.2), 0.8, 0), size: 0.12, size1: 0.02, life: 0.9, color: '#ffb35a' });
    },
    chains(pos) {
      for (let i = 0; i < 8; i++) spawn('chain_ring', { pos: pos.clone().add(v(Math.cos(i) * 0.6, 0.6 + Math.sin(i) * 0.4, 0)), size: 0.22, life: 0.7, spin: rnd(3), additive: false });
    },
  };

  return { spawn, update, clear, bursts, count: () => live.length };
}
