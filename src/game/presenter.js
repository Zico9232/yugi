// Event playback. The engine has already applied every rule; the presenter
// replays its events one by one as animation, then shows the board snapshot
// recorded with each event. Normal / Fast / Skip only scale these durations,
// so animation speed can never change what happened.
import * as THREE from 'three';
import { cardById, ART_BOX, ATTR_COLORS, isTrap, isSpell, isMonster } from '../engine/cards.js';
import { CARD_H, CARD_W } from './arena/scene.js';

const SPEED = { normal: 1, fast: 0.45, skip: 0 };

export function createPresenter({ arena, ui, audio, haptic, getSpeed, getHurry }) {
  const queue = [];
  let current = null; // { ev, left, finish }
  const fx = arena.fx;

  const factor = () => SPEED[getSpeed()] * (getHurry() ? 0.6 : 1);

  function push(events) {
    for (const e of events) queue.push(e);
  }
  function idle() {
    return !current && queue.length === 0;
  }
  function clear() {
    queue.length = 0;
    current = null;
  }

  function update(dt) {
    let budget = 8; // several instant events per frame
    while (budget-- > 0) {
      if (current) {
        current.left -= dt;
        dt = 0;
        if (current.left > 0) return;
        finishCurrent();
        continue;
      }
      if (!queue.length) return;
      const ev = queue.shift();
      const f = factor();
      const h = HANDLERS[ev.type];
      let dur = 0;
      let finish = null;
      if (h) {
        const r = h(ev, f) || {};
        dur = (r.dur || 0) * f;
        finish = r.finish || null;
      }
      current = { ev, left: dur, finish };
      if (dur <= 0) finishCurrent();
    }
  }
  function finishCurrent() {
    const { ev, finish } = current;
    current = null;
    if (finish) finish();
    arena.applySnap(ev.snap);
    ui.onSnap(ev.snap, ev);
  }

  // --- helpers --------------------------------------------------------------
  const pos3 = (p, loc, i = 0) => arena.zonePos(p, loc, i);
  function handPoint(p) {
    const { W, H } = arena.size();
    return p === 0 ? arena.unproject(W / 2, H - 40, 8) : arena.unproject(W / 2, 40, 9);
  }
  function stagePoint(p, zone) {
    const z = pos3(p, 'mz', zone ?? 2);
    const toCam = arena.camera.position.clone().sub(z).normalize();
    return z.clone().add(new THREE.Vector3(0, 1.35, 0)).add(toCam.multiplyScalar(1.4));
  }
  function creatureCenter(uid) {
    const ce = arena.creatures.get(uid);
    if (ce) return ce.mesh.position.clone().add(new THREE.Vector3(0, ce.height * ce.scale * 0.5, 0));
    const e = arena.cards.get(uid);
    return e ? e.g.position.clone().add(new THREE.Vector3(0, 0.3, 0)) : new THREE.Vector3();
  }
  function headPoint(uid) {
    const ce = arena.creatures.get(uid);
    if (!ce) return creatureCenter(uid);
    const rig = ce.mesh.userData.rig;
    const h = ce.height * ce.scale;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(arena.camera.quaternion);
    return ce.mesh.position.clone().add(new THREE.Vector3(0, h * 0.85, 0)).add(right.multiplyScalar((rig.head.x - 0.5) * h * ce.mesh.userData.aspect));
  }
  const camQuat = () => arena.camera.quaternion.clone();
  function boardQuat(pose) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.rx, pose.ry, pose.rz, 'XYZ'));
  }
  function cardEntity(uid, id) {
    let e = arena.cards.get(uid);
    if (!e) e = arena.makeCard(uid, id);
    else arena.setCardFace(e, id);
    e.locked++;
    return e;
  }
  function unlock(e, pose) {
    e.locked = Math.max(0, e.locked - 1);
    if (pose) {
      Object.assign(e.cur, pose, { pos: pose.pos.clone() });
      arena.applyTransform(e);
    }
  }
  function attrColor(id) {
    return ATTR_COLORS[cardById(id)?.attr] || '#ffd27a';
  }
  function flyCard(e, fromPos, fromQuat, toPos, toQuat, dur, { lift = 0.8, scale0 = 1, scale1 = 1 } = {}) {
    return arena.animate(dur, (k) => {
      const t = arena.ease.inOut(k);
      e.g.position.lerpVectors(fromPos, toPos, t).setY(fromPos.y + (toPos.y - fromPos.y) * t + Math.sin(Math.PI * t) * lift);
      e.g.quaternion.slerpQuaternions(fromQuat, toQuat, t);
      e.g.scale.setScalar(scale0 + (scale1 - scale0) * t);
    });
  }

  // Creature emergence from a card held at `cardE` (camera-facing at stage).
  function emerge(uid, id, p, zone, cardE, f, { quick = false } = {}) {
    const ce = arena.makeCreature(uid, id);
    if (!ce) return 0;
    ce.locked = true;
    arena.creatureStand(ce, p, zone);
    const u = ce.mesh.material.uniforms;
    const rig = ce.mesh.userData.rig;
    const cs = cardE.g.scale.x;
    const artW = ART_BOX.w * CARD_W * cs;
    const artH = ART_BOX.h * CARD_H * cs;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(arena.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(arena.camera.quaternion);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(arena.camera.quaternion);
    // where the creature sits inside the card's illustration
    const artCenter = cardE.g.position.clone().add(right.clone().multiplyScalar((ART_BOX.x + ART_BOX.w / 2 - 0.5) * CARD_W * cs)).add(up.clone().multiplyScalar((0.5 - (ART_BOX.y + ART_BOX.h / 2)) * CARD_H * cs));
    const boxC = artCenter.clone().add(right.clone().multiplyScalar((rig.box.x + rig.box.w / 2 - 0.5) * artW)).add(up.clone().multiplyScalar((0.5 - (rig.box.y + rig.box.h / 2)) * artH));
    const h0 = rig.box.h * artH;
    const feet0 = boxC.clone().add(up.clone().multiplyScalar(-h0 / 2)).add(fwd.clone().multiplyScalar(0.01));
    const finalH = ce.height;
    const stand = ce.base.clone().setY(ce.floats ? 0.35 : 0);
    const out = feet0.clone().add(fwd.clone().multiplyScalar(0.9)).add(up.clone().multiplyScalar(0.25));
    const T = quick ? 0.9 : 1.5;
    u.uFlat.value = 1;
    u.uGlow.value = 1;
    arena.animate(T * f, (k) => {
      // 0-0.3 art comes alive in place; 0.3-0.6 breaks free past the frame; 0.6-1 lands
      let pos;
      let h;
      if (k < 0.3) {
        const t = k / 0.3;
        u.uFlat.value = 1 - t * 0.7;
        pos = feet0.clone().add(fwd.clone().multiplyScalar(t * 0.12));
        h = h0 * (1 + t * 0.06);
      } else if (k < 0.6) {
        const t = arena.ease.out((k - 0.3) / 0.3);
        u.uFlat.value = 0.3 * (1 - t);
        pos = feet0.clone().lerp(out, t);
        h = h0 + (finalH * 1.15 - h0) * t;
      } else {
        const t = arena.ease.inOut((k - 0.6) / 0.4);
        pos = out.clone().lerp(stand, t);
        pos.y += Math.sin(Math.PI * t) * 0.6;
        h = finalH * (1.15 - 0.15 * t);
        u.uGlow.value = 1 - t;
      }
      arena.placeCreature(ce, pos, h);
    }, () => {
      ce.locked = false;
      u.uGlow.value = 0;
      u.uFlat.value = 0;
      if (!ce.floats) fx.bursts.smoke(stand.clone().setY(0.05), 5);
      if (ce.profile === 'caster') fx.bursts.circle(stand.clone().setY(0.02), attrColor(id));
      if (ce.profile === 'machine') fx.bursts.gears(stand.clone().setY(0.6));
    });
    return T;
  }

  // --- event handlers -------------------------------------------------------
  const HANDLERS = {
    start: () => ({ dur: 0.1 }),
    draw: (ev) => {
      if (!ev.opening) audio.sfx('card');
      ui.onDraw(ev);
      return { dur: ev.opening ? 0.04 : 0.22 };
    },
    turn: (ev) => {
      ui.banner(ev.p === 0 ? 'yourTurn' : 'joeyTurn');
      audio.blip(ev.p === 0 ? 660 : 440, 0.12);
      return { dur: 0.85 };
    },
    phase: (ev) => {
      ui.onPhase(ev.phase);
      return { dur: ev.phase === 'draw' || ev.phase === 'standby' ? 0.05 : 0.2 };
    },
    summon: (ev, f) => {
      const def = cardById(ev.id);
      const e = cardEntity(ev.uid, ev.id);
      const pose = arena.boardPose(ev.p, 'mz', ev.zone, true, ev.pos);
      const from = ev.from === 'hand' ? handPoint(ev.p) : ev.from === 'void' ? pos3(ev.p, 'mz', ev.zone) : pos3(ev.p, ev.from === 'gy' ? 'gy' : ev.from === 'extra' ? 'extra' : ev.from === 'deck' ? 'deck' : 'mz', 0);
      const stage = stagePoint(ev.p, ev.zone);
      const quick = ev.how === 'token';
      if (quick) {
        unlock(e, pose);
        const t = emerge(ev.uid, ev.id, ev.p, ev.zone, e, f * 0.4, { quick: true });
        return { dur: Math.max(0.35, t * 0.4) };
      }
      audio.sfx('summon');
      haptic(25);
      const fromQuat = ev.from === 'hand' ? camQuat() : boardQuat(pose);
      const color = attrColor(ev.id);
      e.glow.material.color.set(color);
      const t1 = 0.35;
      e.g.position.copy(from);
      e.g.quaternion.copy(fromQuat);
      flyCard(e, from.clone(), fromQuat, stage, camQuat(), t1 * f, { lift: 0.3, scale0: 0.8, scale1: 1.55 });
      // frame lights up in the attribute colour
      arena.animate(0.5 * f, (k) => (e.glow.material.opacity = Math.min(1, k * 2)));
      if (ev.how === 'fusion') fx.bursts.circle(stage.clone(), '#c084fc');
      if (ev.how === 'tribute' || def.level >= 7) fx.bursts.sparks(stage.clone(), color, 18);
      let te = 0;
      arena.animate((t1 + 0.25) * f, () => {}, () => {
        te = emerge(ev.uid, ev.id, ev.p, ev.zone, e, f);
        // the card settles onto its zone once the creature is out
        arena.animate(te * 0.55 * f, () => {}, () => {
          const s0 = e.g.position.clone();
          const q0 = e.g.quaternion.clone();
          flyCard(e, s0, q0, pose.pos.clone(), boardQuat(pose), 0.45 * f, { lift: 0.1, scale0: e.g.scale.x, scale1: 1 });
          arena.animate(0.45 * f, (k) => (e.glow.material.opacity = 1 - k));
        });
      });
      const total = t1 + 0.25 + 1.5 * 0.55 + 0.5;
      return {
        dur: total,
        finish: () => {
          unlock(e, pose);
          e.glow.material.opacity = 0;
          ui.monsterCallout(ev.uid, def);
          if (ev.p === 1 && (def.atk ?? 0) >= 2000) ui.joeySays('summonBig');
        },
      };
    },
    set: (ev, f) => {
      audio.sfx('card');
      const e = cardEntity(ev.uid, 0);
      const loc = ev.kind === 'monster' ? 'mz' : 'sz';
      const pose = arena.boardPose(ev.p, loc, ev.zone, false, ev.kind === 'monster' ? 'def' : 'atk');
      const from = handPoint(ev.p);
      flyCard(e, from, camQuat(), pose.pos.clone(), boardQuat(pose), 0.38 * f, { lift: 0.5, scale0: 0.8, scale1: 1 });
      return { dur: 0.4, finish: () => unlock(e, pose) };
    },
    flip: (ev, f) => {
      audio.sfx('card');
      const def = cardById(ev.id);
      const e = arena.cards.get(ev.uid);
      if (e) arena.setCardFace(e, ev.id);
      if (isMonster(def) && e) {
        const snapZone = ev.snap.zones[ev.uid];
        const zone = snapZone ? snapZone.i : 0;
        const pose = arena.boardPose(ev.p, 'mz', zone, true, ev.pos);
        e.locked++;
        const stage = stagePoint(ev.p, zone).lerp(pose.pos, 0.35);
        const q0 = e.g.quaternion.clone();
        flyCard(e, e.g.position.clone(), q0, stage, camQuat(), 0.3 * f, { lift: 0.2, scale0: 1, scale1: 1.3 });
        e.glow.material.color.set(attrColor(ev.id));
        e.glow.material.opacity = 1;
        arena.animate(0.32 * f, () => {}, () => {
          emerge(ev.uid, ev.id, ev.p, zone, e, f * 0.75, { quick: true });
          flyCard(e, e.g.position.clone(), e.g.quaternion.clone(), pose.pos.clone(), boardQuat(pose), 0.5 * f, { lift: 0.1, scale0: 1.3, scale1: 1 });
        });
        return { dur: 1.1, finish: () => ((e.glow.material.opacity = 0), unlock(e, pose), ui.monsterCallout(ev.uid, def)) };
      }
      return { dur: 0.35 };
    },
    position: (ev) => {
      audio.sfx('card');
      const ce = arena.creatures.get(ev.uid);
      if (ce && ev.pos === 'def') fx.bursts.shield(creatureCenter(ev.uid));
      return { dur: 0.45 };
    },
    turnDown: () => ({ dur: 0.35 }),
    activate: (ev, f) => {
      const def = cardById(ev.id);
      audio.sfx(isTrap(def) ? 'trap' : 'spell');
      haptic(15);
      ui.activation(ev, def);
      if (ev.p === 1 && isTrap(def)) ui.joeySays('trap');
      const e = arena.cards.get(ev.uid);
      if (e && !ev.trigger && !ev.ign) {
        arena.setCardFace(e, ev.id);
        e.glow.material.color.set(isTrap(def) ? '#e879f9' : isSpell(def) ? '#34d399' : attrColor(ev.id));
        arena.animate(1.0 * f, (k) => (e.glow.material.opacity = Math.sin(Math.PI * k)));
        const base = e.g.position.clone();
        arena.animate(0.6 * f, (k) => e.g.position.copy(base).setY(base.y + Math.sin(Math.PI * k) * 0.35));
      } else if (arena.creatures.get(ev.uid)) {
        const ce = arena.creatures.get(ev.uid);
        ce.mesh.material.uniforms.uGlow.value = 1;
        arena.animate(0.9 * f, (k) => (ce.mesh.material.uniforms.uGlow.value = 1 - k));
        fx.bursts.circle(ce.mesh.position.clone().setY(0.03), attrColor(ev.id));
      }
      for (const t of ev.targets || []) {
        const c = creatureCenter(t);
        fx.bursts.sparks(c, '#ffe08a', 10);
      }
      return { dur: 1.15 };
    },
    resolve: (ev) => ({ dur: ev.negated ? 0.3 : 0.18 }),
    negate: (ev) => {
      ui.toast('negated', cardById(ev.id)?.name);
      fx.bursts.chains(creatureCenter(ev.uid));
      audio.sfx('trap');
      return { dur: 0.6 };
    },
    chainEnd: () => ({ dur: 0 }),
    attack: (ev, f) => {
      const ce = arena.creatures.get(ev.uid);
      if (ce) {
        const u = ce.mesh.material.uniforms;
        arena.animate(0.5 * f, (k) => (u.uAttack.value = -0.4 * Math.sin(Math.PI * k * 0.5)));
        u.uDir.value = 1;
      }
      ui.aim(ev.uid, ev.target, ev.p);
      audio.blip(300, 0.08, 'sawtooth');
      return { dur: 0.6, finish: () => ui.aim(null) };
    },
    attackStop: () => ({ dur: 0.2 }),
    attackNegated: (ev) => {
      ui.toast('attackNegated');
      const ce = arena.creatures.get(ev.uid);
      if (ce) ce.mesh.material.uniforms.uAttack.value = 0;
      return { dur: 0.45 };
    },
    battle: (ev, f) => battleAnim(ev, f),
    damage: (ev) => {
      ui.lpChange(ev.p, -ev.amount, ev.snap.lp[ev.p]);
      if (ev.amount >= 1000) {
        ui.shake(Math.min(1, ev.amount / 3000));
        haptic(ev.p === 0 ? [30, 40, 30] : 20);
      }
      if (ev.p === 1 && ev.amount >= 1500) ui.joeySays('hurt');
      if (ev.p === 0 && ev.amount >= 1500) ui.joeySays('hit');
      audio.drain(ev.amount);
      return { dur: 0.65 };
    },
    heal: (ev) => {
      ui.lpChange(ev.p, ev.amount, ev.snap.lp[ev.p]);
      audio.blip(880, 0.15, 'sine');
      return { dur: 0.5 };
    },
    pay: (ev) => {
      ui.lpChange(ev.p, -ev.amount, ev.snap.lp[ev.p]);
      return { dur: 0.45 };
    },
    destroy: (ev, f) => removeFromField(ev, f, 'destroy'),
    tribute: (ev, f) => removeFromField(ev, f, 'tribute'),
    toGy: (ev, f) => moveCardAnim(ev, f, 'gy'),
    toHand: (ev, f) => {
      if (ev.from === 'deck' && ev.reveal) ui.reveal(ev.id);
      return moveCardAnim(ev, f, 'hand');
    },
    toDeck: (ev, f) => moveCardAnim(ev, f, 'deck'),
    banish: (ev, f) => {
      const r = moveCardAnim(ev, f, 'ban');
      return r;
    },
    shuffle: () => {
      audio.sfx('card');
      return { dur: 0.12 };
    },
    coin: (ev) => {
      ui.coin(ev.result);
      audio.blip(1200, 0.06, 'triangle');
      if (ev.p === 1) ui.joeySays('coin');
      return { dur: 1.5 };
    },
    die: (ev) => {
      ui.die(ev.result);
      audio.sfx('card');
      return { dur: 1.5 };
    },
    control: () => {
      audio.sfx('summon');
      return { dur: 0.7 };
    },
    equip: (ev) => {
      fx.bursts.sparks(creatureCenter(ev.target), '#a7f3d0', 12);
      return { dur: 0.45 };
    },
    stat: (ev) => {
      ui.statPulse(ev.uid);
      return { dur: 0.08 };
    },
    fusion: (ev, f) => {
      audio.sfx('summon');
      const center = stagePoint(ev.p, 2);
      fx.bursts.circle(center.clone(), '#c084fc');
      for (const m of ev.materials) {
        const ce = arena.creatures.get(m);
        const e = arena.cards.get(m);
        const obj = ce ? ce.mesh : e ? e.g : null;
        if (!obj) continue;
        if (ce) ce.locked = true;
        const start = obj.position.clone();
        arena.animate(1.0 * f, (k) => {
          const a = k * Math.PI * 3;
          const r = (1 - k) * 1.2;
          obj.position.copy(start.clone().lerp(center, k)).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.5));
          if (ce) ce.mesh.material.uniforms.uOpacity.value = 1 - k * 0.8;
        });
      }
      ui.reveal(ev.id, 'fusion');
      return { dur: 1.15 };
    },
    reveal: (ev) => {
      ui.reveal(ev.id);
      return { dur: ev.p === 0 ? 0.5 : 0.9 };
    },
    counter: () => ({ dur: 0.3 }),
    exodia: () => {
      ui.banner('exodia');
      return { dur: 1.6 };
    },
    win: (ev) => {
      audio.sfx(ev.winner === 0 ? 'summon' : 'shatter');
      return { dur: 0.8 };
    },
  };

  function removeFromField(ev, f, kind) {
    const ce = arena.creatures.get(ev.uid);
    const e = arena.cards.get(ev.uid);
    if (!e && !ce) return moveCardAnim(ev, f, 'gy');
    const gyPos = pos3(ev.p ?? 0, 'gy');
    if (ce) {
      ce.locked = true;
      const u = ce.mesh.material.uniforms;
      const p0 = ce.mesh.position.clone();
      const h0 = ce.mesh.scale.y;
      if (kind === 'destroy') {
        audio.sfx('shatter');
        u.uHit.value = 1;
        arena.animate(0.75 * f, (k) => {
          u.uDissolve.value = k * 1.05;
          const pos = p0.clone();
          pos.y += k * 0.2;
          arena.placeCreature(ce, pos, h0 * (1 - k * 0.45));
        });
        arena.animate(0.25 * f, () => {}, () => fx.bursts.shatter(creatureCenter(ev.uid), ATTR_COLORS[cardById(ev.id)?.attr] || '#bfefff'));
      } else {
        // tribute: the creature dissolves upward into light
        arena.animate(0.55 * f, (k) => {
          u.uOpacity.value = 1 - k;
          u.uGlow.value = k;
          arena.placeCreature(ce, p0.clone().setY(p0.y + k * 1.2), h0 * (1 - k * 0.3));
        });
        fx.bursts.sparks(creatureCenter(ev.uid), '#fff1c1', 12);
      }
    } else if (kind === 'destroy' && e) {
      audio.sfx('shatter');
      fx.bursts.shatter(e.g.position.clone().setY(0.2));
    }
    if (e) {
      e.locked++;
      e.glow.material.color.set(kind === 'destroy' ? '#ff4d4d' : '#fff1c1');
      e.glow.material.opacity = 1;
      const s0 = e.g.position.clone();
      const q0 = e.g.quaternion.clone();
      const gq = boardQuat(arena.boardPose(ev.p ?? 0, 'gy', 0, true, 'atk'));
      arena.animate(0.35 * f, () => {}, () => flyCard(e, s0, q0, gyPos.clone().setY(0.3), gq, 0.4 * f, { lift: 0.6 }));
    }
    const dur = kind === 'destroy' ? 0.85 : 0.65;
    return {
      dur,
      finish: () => {
        if (ce) {
          ce.locked = false;
          arena.removeCreature(ev.uid);
        }
        if (e) {
          e.locked = 0;
          arena.removeCard(ev.uid);
        }
      },
    };
  }

  function moveCardAnim(ev, f, to) {
    const p = ev.p ?? 0;
    let e = arena.cards.get(ev.uid);
    const ce = arena.creatures.get(ev.uid);
    if (ce) {
      ce.locked = true;
      const u = ce.mesh.material.uniforms;
      arena.animate(0.3 * f, (k) => (u.uOpacity.value = 1 - k));
    }
    let made = false;
    if (!e) {
      if (ev.from !== 'hand') return { dur: ev.from === 'deck' ? 0.12 : 0.05, finish: () => ce && (arena.removeCreature(ev.uid)) };
      e = arena.makeCard(ev.uid, ev.id && (p === 0 || to !== 'hand') ? ev.id : 0);
      e.g.position.copy(handPoint(p));
      e.g.quaternion.copy(camQuat());
      made = true;
    }
    if (ev.id && (to === 'gy' || to === 'ban')) arena.setCardFace(e, ev.id);
    e.locked++;
    const dest = to === 'hand' ? handPoint(p) : to === 'ban' ? pos3(p, 'gy').add(new THREE.Vector3(0, 1.5, 0)) : pos3(p, to === 'deck' ? 'deck' : 'gy').setY(0.3);
    const dq = to === 'hand' ? camQuat() : boardQuat(arena.boardPose(p, 'gy', 0, to !== 'deck', 'atk'));
    flyCard(e, e.g.position.clone(), e.g.quaternion.clone(), dest, dq, 0.42 * f, { lift: 0.5 });
    if (to === 'ban') arena.animate(0.42 * f, (k) => (e.faceMat.opacity = 1 - k));
    if (to === 'gy') audio.sfx('card');
    return {
      dur: 0.45,
      finish: () => {
        e.locked = 0;
        e.faceMat.opacity = 1;
        arena.removeCard(ev.uid);
        if (ce) {
          ce.locked = false;
          arena.removeCreature(ev.uid);
        }
        void made;
      },
    };
  }

  function battleAnim(ev, f) {
    const A = ev.attacker;
    const ce = arena.creatures.get(A);
    const ap = ev.snap.zones[A]?.p ?? (ce ? ce.p : 0);
    const targetPt = ev.target ? creatureCenter(ev.target) : new THREE.Vector3(0, 0.8, ap === 0 ? -4.6 : 4.6);
    const color = attrColor(ce?.id || 0);
    let hitAt = 0.35;
    if (ce) {
      ce.locked = true;
      const u = ce.mesh.material.uniforms;
      const start = ce.mesh.position.clone();
      const h = ce.mesh.scale.y;
      const dir = targetPt.clone().sub(start);
      u.uDir.value = Math.sign(dir.x || 1);
      const prof = ce.profile;
      const ranged = ['dragon', 'caster', 'aquatic', 'machine', 'fiend'].includes(prof);
      if (ranged) {
        // rear up, then unleash
        arena.animate(0.75 * f, (k) => {
          u.uAttack.value = k < 0.35 ? -0.6 * (k / 0.35) : 1 - (k - 0.35) / 0.65;
          const lunge = k < 0.35 ? -0.1 * (k / 0.35) : Math.sin(Math.PI * Math.min(1, (k - 0.35) / 0.4)) * 0.35;
          arena.placeCreature(ce, start.clone().add(dir.clone().normalize().multiplyScalar(lunge)), h);
        });
        const from = headPoint(A);
        arena.animate(0.28 * f, () => {}, () => {
          if (prof === 'dragon') {
            audio.sfx('fire');
            fx.bursts.breath(from, targetPt, color === '#a855f7' ? '#d8b4fe' : '#ffffff');
          } else if (prof === 'aquatic') fx.bursts.water(from, targetPt);
          else if (prof === 'machine') {
            fx.bursts.orbs(from, targetPt, '#9be7ff', 6);
            fx.bursts.gears(start.clone().setY(h * 0.5));
          } else if (prof === 'fiend') fx.bursts.orbs(from, targetPt, '#c084fc', 4);
          else {
            fx.bursts.circle(start.clone().setY(0.03), color);
            fx.bursts.orbs(from, targetPt, '#fde68a', 5);
          }
        });
        hitAt = 0.62;
      } else {
        // melee: crouch, lunge across the street, strike, spring back
        arena.animate(0.8 * f, (k) => {
          let t;
          if (k < 0.2) t = -0.08 * (k / 0.2);
          else if (k < 0.5) t = arena.ease.out((k - 0.2) / 0.3) * 0.78;
          else t = 0.78 * (1 - arena.ease.inOut((k - 0.5) / 0.5));
          u.uAttack.value = k < 0.2 ? -0.5 * (k / 0.2) : k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
          const pos = start.clone().lerp(targetPt.clone().setY(start.y), t);
          if (prof === 'beast' || prof === 'small') pos.y += Math.sin(Math.PI * Math.max(0, Math.min(1, (k - 0.2) / 0.3))) * 0.8;
          arena.placeCreature(ce, pos, h);
        });
        hitAt = 0.42;
      }
    }
    arena.animate(hitAt * f, () => {}, () => {
      audio.sfx('impact');
      fx.bursts.impact(targetPt, '#ffd37a', ev.damage[0] + ev.damage[1] > 1500 ? 1.4 : 1);
      if (ce && !['dragon', 'caster', 'aquatic', 'machine', 'fiend'].includes(ce.profile)) fx.bursts.slash(targetPt, ap === 0 ? 1 : -1);
      const tce = ev.target && arena.creatures.get(ev.target);
      if (tce) {
        tce.mesh.material.uniforms.uHit.value = 1;
        if (ev.tPos === 'def' && !ev.destroyed.includes(ev.target)) fx.bursts.shield(targetPt);
      }
      if (ev.target && ev.tVal > ev.aAtk && ce) ce.mesh.material.uniforms.uHit.value = 1;
      ui.battleNumbers(ev, targetPt);
      ui.shake(0.35 + Math.min(0.6, (ev.damage[0] + ev.damage[1]) / 3000));
    });
    return {
      dur: Math.max(0.95, hitAt + 0.45),
      finish: () => {
        if (ce) {
          ce.locked = false;
          ce.mesh.material.uniforms.uAttack.value = 0;
        }
      },
    };
  }

  // Art Lab preview: summon and attack with any approved creature on an empty
  // board, using the very same animations.
  function preview(id, f = 1) {
    const uid = `preview-${id}-${Math.floor(Math.random() * 1e6)}`;
    const snapBefore = arena.lastSnap();
    const zones = { ...(snapBefore?.zones || {}) };
    const after = { ...(snapBefore || { deck: [0, 0], extra: [0, 0], gyCount: [0, 0], gy: [null, null], lp: [8000, 8000], hand: [[], 0] }), zones: { ...zones, [uid]: { id, p: 0, loc: 'mz', i: 2, up: true, pos: 'atk', atk: cardById(id).atk, def: cardById(id).def } } };
    queue.push({ type: 'summon', uid, id, p: 0, how: 'normal', pos: 'atk', zone: 2, from: 'hand', snap: after });
    queue.push({ type: 'battle', attacker: uid, target: null, aAtk: cardById(id).atk, damage: [0, 0], destroyed: [], snap: after });
    queue.push({ type: 'destroy', uid, id, p: 0, snap: { ...after, zones } });
    void f;
  }

  return { push, update, idle, clear, preview, busy: () => !!current };
}
