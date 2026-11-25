// Duel engine: the complete rules state machine for one duel.
//
// Contract:
// - The duel is ONE plain JSON object. Nothing outside it holds rules state, so
//   it can be cloned for the AI, snapshotted for undo of a cancelled choice, and
//   saved.
// - Players act only through act(d, player, action) with an action taken from
//   getActions(d, player). act() validates by membership, so an illegal move can
//   never execute; getActions() never offers one.
// - Every visible change pushes an event to d.events with a board snapshot. The
//   presentation layer plays those back; it never writes to the duel, so no
//   animation can change the outcome.
// - Procedures that need a player's choice throw NeedChoice. The runner restores
//   the duel to the snapshot taken before the procedure, records a pending
//   choice, and re-runs the procedure with the answers once they arrive. That
//   keeps effect scripts linear and the state serialisable.

import { CLASSIC_2004 } from './rules.js';
import { cardById, isMonster, isSpell, isTrap, baseSpeed, idOf, cardByName } from './cards.js';
import { nextRandom, randInt, shuffleInPlace } from './rng.js';
import { effectOf } from './effects.js';

export const PHASES = ['draw', 'standby', 'main1', 'battle', 'main2', 'end'];
export const other = (p) => 1 - p;

class NeedChoice {
  constructor(req) {
    this.req = req;
  }
}
class Abort {}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createDuel({ decks, seed, firstPlayer = 0, rules = CLASSIC_2004, lp = [rules.startingLp, rules.startingLp], names = ['Player', 'Joey'] }) {
  const d = {
    v: 1,
    rules: { id: rules.id },
    rng: seed | 0,
    seed: seed | 0,
    turn: 0,
    turnPlayer: other(firstPlayer),
    firstPlayer,
    phase: 'draw',
    step: 'turnStart',
    players: [0, 1].map((p) => ({
      name: names[p],
      lp: lp[p],
      deck: [],
      hand: [],
      gy: [],
      ban: [],
      extra: [],
      mz: [null, null, null, null, null],
      sz: [null, null, null, null, null],
      fz: null,
      normalDone: false,
      summonLockTurn: -1,
      flags: {},
      stats: { damageDealt: 0, spells: 0, traps: 0, summons: 0 },
    })),
    cards: {},
    nextUid: 1,
    chain: [],
    chainState: null,
    triggers: [],
    windows: [],
    window: null,
    battle: null,
    pending: null,
    flags: {},
    winner: null,
    winReason: null,
    events: [],
    seq: 0,
    log: [],
    lastFinish: null,
  };
  for (const p of [0, 1]) {
    for (const id of decks[p].main) addCard(d, id, p, 'deck');
    for (const id of decks[p].extra || []) addCard(d, id, p, 'extra');
    shuffleInPlace(d, d.players[p].deck);
  }
  emit(d, 'start', { first: firstPlayer });
  for (const p of [firstPlayer, other(firstPlayer)]) for (let i = 0; i < rules.openingHand; i++) drawOne(d, p, true);
  advance(d);
  return d;
}

function addCard(d, id, owner, loc) {
  const uid = 'c' + d.nextUid++;
  d.cards[uid] = { uid, id, owner, ctrl: owner, loc, faceUp: false, pos: 'atk', setTurn: -1, sumTurn: -1, posTurn: -1, attacks: 0, mods: [], equipTo: null, counters: 0, once: {}, flags: {} };
  const pl = d.players[owner];
  if (loc === 'deck') pl.deck.push(uid);
  else if (loc === 'extra') pl.extra.push(uid);
  return uid;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const inst = (d, uid) => d.cards[uid];
export const defOf = (d, uid) => cardById(d.cards[uid]?.id);
export const onField = (d, uid) => ['mz', 'sz', 'fz'].includes(d.cards[uid]?.loc);
export const monsters = (d, p) => d.players[p].mz.filter(Boolean);
export const faceUpMonsters = (d, p) => monsters(d, p).filter((u) => d.cards[u].faceUp);
export const spellTraps = (d, p) => d.players[p].sz.filter(Boolean).concat(d.players[p].fz ? [d.players[p].fz] : []);
export const allMonsters = (d) => monsters(d, 0).concat(monsters(d, 1));

export function zoneIndex(d, uid) {
  const c = d.cards[uid];
  if (c.loc === 'mz') return d.players[c.ctrl].mz.indexOf(uid);
  if (c.loc === 'sz') return d.players[c.ctrl].sz.indexOf(uid);
  return -1;
}

function jinzoActive(d) {
  return allMonsters(d).some((u) => d.cards[u].faceUp && defOf(d, u)?.name === 'Jinzo');
}

function trapNegated(d, uid) {
  return isTrap(defOf(d, uid)) && jinzoActive(d);
}

// Continuous effects currently applying from face-up cards.
function activeSources(d) {
  const out = [];
  for (const p of [0, 1]) {
    for (const u of [...d.players[p].mz, ...d.players[p].sz, d.players[p].fz]) {
      if (!u) continue;
      const c = d.cards[u];
      if (!c.faceUp) continue;
      if (trapNegated(d, u)) continue;
      const e = effectOf(c.id);
      if (e) out.push({ uid: u, e, c });
    }
  }
  return out;
}

export function getStat(d, uid, stat) {
  const c = d.cards[uid];
  const def = cardById(c.id);
  if (!def || !isMonster(def)) return 0;
  let v = c.flags.tokenStats ? c.flags.tokenStats[stat] : def[stat] ?? 0;
  if (!onField(d, uid) || !c.faceUp) return Math.max(0, v);
  const e = effectOf(c.id);
  if (e?.selfMod) v += e.selfMod(ctxFor(d, c.ctrl, uid), stat) || 0;
  for (const s of activeSources(d)) {
    if (s.e.equip && s.c.equipTo === uid && s.c.loc === 'sz') {
      const eq = s.e.equip;
      const fn = stat === 'atk' ? eq.atkFn : eq.defFn;
      v += (fn ? fn(ctxFor(d, s.c.ctrl, s.uid), uid) : stat === 'atk' ? eq.atk : eq.def) || 0;
      if (s.c.flags.choice && eq.choice) v += eq.choice(s.c.flags.choice, stat) || 0;
    }
    if (s.e.field && s.c.loc === 'fz') {
      const f = s.e.field;
      for (const rule of f) if (rule.match(def)) v += (stat === 'atk' ? rule.atk : rule.def) || 0;
    }
    if (s.e.aura) v += s.e.aura(ctxFor(d, s.c.ctrl, s.uid), uid, stat) || 0;
  }
  for (const m of c.mods) v += m[stat] || 0;
  if (stat === 'atk' && d.battle && d.battle.attacker === uid && d.battle.stage === 'damage') {
    v += d.battle.atkBonus || 0;
  }
  return Math.max(0, v);
}
export const atkOf = (d, uid) => getStat(d, uid, 'atk');
export const defStatOf = (d, uid) => getStat(d, uid, 'def');

export function levelOf(d, uid) {
  const c = d.cards[uid];
  return c.flags.tokenStats?.level ?? cardById(c.id)?.level ?? 0;
}

// Cards fill the centre zones first, then outward.
const ZONE_ORDER = [2, 1, 3, 0, 4];
function freeZone(d, p, kind) {
  for (const i of ZONE_ORDER) if (d.players[p][kind][i] === null) return i;
  return -1;
}

// ---------------------------------------------------------------------------
// Events and log
// ---------------------------------------------------------------------------

export function snapshotBoard(d) {
  const zones = {};
  for (const u in d.cards) {
    const c = d.cards[u];
    if (c.loc === 'mz' || c.loc === 'sz' || c.loc === 'fz') {
      zones[u] = {
        id: c.id,
        p: c.ctrl,
        loc: c.loc,
        i: c.loc === 'fz' ? 0 : zoneIndex(d, u),
        up: c.faceUp,
        pos: c.pos,
        atk: c.loc === 'mz' ? atkOf(d, u) : null,
        def: c.loc === 'mz' ? defStatOf(d, u) : null,
        eq: c.equipTo,
      };
    }
  }
  return {
    zones,
    lp: [d.players[0].lp, d.players[1].lp],
    hand: [d.players[0].hand.slice(), d.players[1].hand.length],
    deck: [d.players[0].deck.length, d.players[1].deck.length],
    gy: [d.players[0].gy.slice(-1)[0] || null, d.players[1].gy.slice(-1)[0] || null],
    gyIds: [0, 1].map((p) => (d.players[p].gy.length ? d.cards[d.players[p].gy[d.players[p].gy.length - 1]].id : null)),
    gyCount: [d.players[0].gy.length, d.players[1].gy.length],
    extra: [d.players[0].extra.length, d.players[1].extra.length],
    turn: d.turn,
    turnPlayer: d.turnPlayer,
    phase: d.phase,
  };
}

export function emit(d, type, data = {}) {
  if (d.flags.sim) return; // AI simulations skip presentation work
  d.events.push({ n: ++d.seq, type, ...data, snap: snapshotBoard(d) });
}

function log(d, key, args = {}) {
  if (d.flags.sim) return;
  d.log.push({ turn: d.turn, key, ...args });
  if (d.log.length > 300) d.log.splice(0, d.log.length - 300);
}

// ---------------------------------------------------------------------------
// Card movement (the only code that changes a card's location)
// ---------------------------------------------------------------------------

function detach(d, uid) {
  const c = d.cards[uid];
  for (const p of [0, 1]) {
    const pl = d.players[p];
    for (const key of ['deck', 'hand', 'gy', 'ban', 'extra']) {
      const i = pl[key].indexOf(uid);
      if (i >= 0) pl[key].splice(i, 1);
    }
    for (const key of ['mz', 'sz']) {
      const i = pl[key].indexOf(uid);
      if (i >= 0) pl[key][i] = null;
    }
    if (pl.fz === uid) pl.fz = null;
  }
  const wasField = ['mz', 'sz', 'fz'].includes(c.loc);
  if (wasField) {
    c.lastEquipTo = c.equipTo;
    c.lastLinked = c.flags.linked || null;
    c.mods = [];
    c.attacks = 0;
    c.counters = 0;
    c.once = {};
    const keep = c.flags.tokenStats;
    c.flags = keep ? { tokenStats: keep } : {};
    if (c.equipTo) c.equipTo = null;
  }
  return wasField;
}

// Send to a non-field location of the owner. Returns false if a token vanished.
function place(d, uid, loc, { top = true } = {}) {
  const c = d.cards[uid];
  const fromLoc = c.loc;
  const wasField = detach(d, uid);
  if (c.flags.tokenStats || c.token) {
    c.loc = 'void';
    c.token = true;
    return { fromLoc, wasField, vanished: true };
  }
  const pl = d.players[c.owner];
  c.ctrl = c.owner;
  c.faceUp = loc !== 'deck' && loc !== 'hand' && loc !== 'extra';
  c.pos = 'atk';
  c.loc = loc;
  if (loc === 'deck') {
    if (cardById(c.id).frame === 'fusion') {
      c.loc = 'extra';
      pl.extra.push(uid);
    } else if (top) pl.deck.unshift(uid);
    else pl.deck.push(uid);
  } else if (loc === 'hand') {
    if (cardById(c.id).frame === 'fusion') {
      c.loc = 'extra';
      pl.extra.push(uid);
    } else pl.hand.push(uid);
  } else pl[loc].push(uid);
  return { fromLoc, wasField };
}

function putOnField(d, uid, p, loc, zone) {
  const c = d.cards[uid];
  detach(d, uid);
  c.ctrl = p;
  c.loc = loc;
  if (loc === 'fz') d.players[p].fz = uid;
  else d.players[p][loc][zone] = uid;
}

function drawOne(d, p, opening = false) {
  const pl = d.players[p];
  if (!pl.deck.length) {
    if (!opening) lose(d, p, 'deckout');
    return null;
  }
  const uid = pl.deck.shift();
  const c = d.cards[uid];
  c.loc = 'hand';
  c.faceUp = false;
  pl.hand.push(uid);
  emit(d, 'draw', { p, uid: p === 0 || d.flags.revealAll ? uid : null, opening });
  return uid;
}

function lose(d, p, reason) {
  if (d.winner !== null) return;
  d.winner = other(p);
  d.winReason = reason;
  emit(d, 'win', { winner: d.winner, reason });
  log(d, 'win', { p: d.winner, reason });
}

// Shared post-move hooks for anything leaving the field.
function leftField(d, uid, fromLoc, toLoc, reason, by) {
  const c = d.cards[uid];
  const prevCtrl = c.lastCtrl ?? c.ctrl;
  // Equips attached to this card are destroyed by state check.
  if (fromLoc === 'mz') {
    for (const u of [...spellTraps(d, 0), ...spellTraps(d, 1)]) {
      if (d.cards[u].equipTo === uid) d.flags.pendingEquipCheck = true;
    }
    for (const u of [...spellTraps(d, 0), ...spellTraps(d, 1)]) {
      const e = d.cards[u];
      if (e.flags.linked === uid) d.flags.pendingEquipCheck = true;
    }
  }
  raise(d, 'leftField', { uid, reason, by, prevCtrl, fromLoc, to: toLoc });
  if (toLoc === 'gy') raise(d, 'toGyFromField', { uid, reason, by, prevCtrl, fromLoc });
  if (reason === 'battle' && toLoc === 'gy') raise(d, 'destroyedByBattle', { uid, prevCtrl });
}

export function sendToGy(d, uid, reason = 'effect', by = null) {
  const c = d.cards[uid];
  const lastCtrl = c.ctrl;
  c.lastCtrl = lastCtrl;
  const r = place(d, uid, 'gy');
  emit(d, reason === 'destroy' || reason === 'battle' ? 'destroy' : reason === 'tribute' ? 'tribute' : 'toGy', { uid, id: c.id, p: lastCtrl, from: r.fromLoc, reason, vanished: !!r.vanished });
  if (r.wasField) leftField(d, uid, r.fromLoc, 'gy', reason, by);
  if (reason === 'discard') raise(d, 'discarded', { uid });
  return r;
}

export function destroy(d, uid, reason = 'destroy', by = null) {
  if (!onField(d, uid)) return false;
  const c = d.cards[uid];
  log(d, 'destroy', { id: c.id });
  sendToGy(d, uid, reason === 'battle' ? 'battle' : 'destroy', by);
  return true;
}

export function banish(d, uid) {
  const c = d.cards[uid];
  c.lastCtrl = c.ctrl;
  const r = place(d, uid, 'ban');
  emit(d, 'banish', { uid, id: c.id, p: c.lastCtrl, from: r.fromLoc });
  if (r.wasField) leftField(d, uid, r.fromLoc, 'ban', 'banish');
  return r;
}

export function toHand(d, uid) {
  const c = d.cards[uid];
  c.lastCtrl = c.ctrl;
  const r = place(d, uid, 'hand');
  emit(d, 'toHand', { uid, id: c.id, p: c.owner, from: r.fromLoc, reveal: r.fromLoc !== 'deck' || c.owner === 0, vanished: !!r.vanished });
  if (r.wasField) leftField(d, uid, r.fromLoc, 'hand', 'bounce');
  return r;
}

export function toDeck(d, uid, shuffle = true) {
  const c = d.cards[uid];
  c.lastCtrl = c.ctrl;
  const r = place(d, uid, 'deck');
  if (shuffle && c.loc === 'deck') shuffleInPlace(d, d.players[c.owner].deck);
  emit(d, 'toDeck', { uid, id: c.id, p: c.owner, from: r.fromLoc, vanished: !!r.vanished });
  if (r.wasField) leftField(d, uid, r.fromLoc, 'deck', 'return');
  return r;
}

// ---------------------------------------------------------------------------
// Summoning
// ---------------------------------------------------------------------------

function canTributeForSummon(d, uid) {
  return !d.cards[uid].flags.noTribute;
}

export function summonMonster(d, uid, p, { pos = 'atk', faceUp = true, how = 'normal', zone = null, tributes = [] } = {}) {
  const c = d.cards[uid];
  const z = zone ?? freeZone(d, p, 'mz');
  if (z < 0) return false;
  const fromLoc = c.loc;
  putOnField(d, uid, p, 'mz', z);
  c.faceUp = faceUp;
  c.pos = pos;
  c.sumTurn = d.turn;
  c.posTurn = d.turn;
  c.setTurn = faceUp ? -1 : d.turn;
  c.attacks = 0;
  c.from = fromLoc;
  if (faceUp) {
    d.players[p].stats.summons++;
    emit(d, 'summon', { uid, id: c.id, p, how, pos, zone: z, from: fromLoc, tributes });
    log(d, 'summon', { p, id: c.id, how });
    raise(d, 'summoned', { uid, how, p, from: fromLoc });
    queueSummonWindow(d, uid, how, p);
  } else {
    emit(d, 'set', { uid, id: null, p, zone: z, kind: 'monster', from: fromLoc });
    log(d, 'setMonster', { p });
  }
  return true;
}

function flipFaceUp(d, uid, { how = 'flip', pos = null, silent = false } = {}) {
  const c = d.cards[uid];
  if (c.faceUp) return;
  c.faceUp = true;
  if (pos) c.pos = pos;
  emit(d, 'flip', { uid, id: c.id, p: c.ctrl, how, pos: c.pos });
  log(d, 'flip', { p: c.ctrl, id: c.id });
  if (!silent && isMonster(cardById(c.id))) raise(d, 'flipped', { uid, how });
}

export function setFaceDown(d, uid) {
  const c = d.cards[uid];
  c.faceUp = false;
  if (c.loc === 'mz') c.pos = 'def';
  emit(d, 'turnDown', { uid, p: c.ctrl });
}

export function changePosition(d, uid, pos) {
  const c = d.cards[uid];
  if (c.pos === pos && c.faceUp) return;
  const wasDown = !c.faceUp;
  c.pos = pos;
  c.posTurn = d.turn;
  if (wasDown && pos === 'atk') {
    flipFaceUp(d, uid, { how: 'flip', pos });
  } else emit(d, 'position', { uid, id: c.id, p: c.ctrl, pos, up: c.faceUp });
}

// ---------------------------------------------------------------------------
// Life points
// ---------------------------------------------------------------------------

export function damage(d, p, amount, source = 'effect', by = null) {
  amount = Math.max(0, Math.round(amount));
  if (!amount) return 0;
  d.players[p].lp = Math.max(0, d.players[p].lp - amount);
  d.players[other(p)].stats.damageDealt += amount;
  emit(d, 'damage', { p, amount, source, by });
  log(d, 'damage', { p, amount });
  if (d.players[p].lp <= 0) d.flags.lpCheck = true;
  return amount;
}

export function gainLp(d, p, amount) {
  d.players[p].lp += amount;
  emit(d, 'heal', { p, amount });
  log(d, 'heal', { p, amount });
  raise(d, 'gainedLp', { p, amount });
}

export function payLp(d, p, amount) {
  d.players[p].lp = Math.max(0, d.players[p].lp - amount);
  emit(d, 'pay', { p, amount });
  if (d.players[p].lp <= 0) d.flags.lpCheck = true;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

// A game event: collect every trigger effect that listens for it.
function raise(d, event, data) {
  if (d.flags.noTriggers) return;
  const watchers = new Set();
  if (data.uid) watchers.add(data.uid);
  for (const p of [0, 1]) {
    for (const u of [...d.players[p].mz, ...d.players[p].sz, d.players[p].fz]) if (u) watchers.add(u);
  }
  for (const u of watchers) {
    const c = d.cards[u];
    const e = effectOf(c.id);
    if (!e?.triggers) continue;
    e.triggers.forEach((t, i) => {
      if (t.on !== event) return;
      const selfEvent = data.uid === u;
      if (!t.watch && !selfEvent) return; // non-watchers only react to their own card
      if (t.watch && !selfEvent && (!onField(d, u) || !c.faceUp)) return;
      if (t.watch && trapNegated(d, u)) return;
      const owner = selfEvent ? data.prevCtrl ?? c.ctrl : c.ctrl;
      const ctx = ctxFor(d, owner, u, { event: data });
      if (t.cond && !t.cond(ctx, data)) return;
      d.triggers.push({ uid: u, idx: i, p: owner, data, optional: !!t.optional });
    });
  }
}

// ---------------------------------------------------------------------------
// Effect context: what effect scripts may do. Everything routes through the
// engine functions above, so rules (Lord of D., Jinzo, zones) apply uniformly.
// ---------------------------------------------------------------------------

export function ctxFor(d, p, self, extra = {}) {
  const ctx = {
    d,
    p,
    opp: other(p),
    self,
    link: extra.link || null,
    proc: extra.proc || null,
    event: extra.event || null,
    card: (u) => d.cards[u],
    def: (u) => defOf(d, u),
    atk: (u) => atkOf(d, u),
    defStat: (u) => defStatOf(d, u),
    level: (u) => levelOf(d, u),
    monsters: (pl, f) => monsters(d, pl).filter((u) => !f || f(u)),
    faceUpMonsters: (pl, f) => faceUpMonsters(d, pl).filter((u) => !f || f(u)),
    allMonsters: (f) => allMonsters(d).filter((u) => !f || f(u)),
    spellTraps: (pl, f) => spellTraps(d, pl).filter((u) => !f || f(u)),
    hand: (pl) => d.players[pl].hand.slice(),
    deck: (pl) => d.players[pl].deck.slice(),
    gy: (pl) => d.players[pl].gy.slice(),
    lp: (pl) => d.players[pl].lp,
    freeZones: (pl, kind = 'mz') => d.players[pl][kind].filter((x) => x === null).length,
    onField: (u) => onField(d, u),
    isUp: (u) => d.cards[u].faceUp,
    // Lord of D.: Dragons on the field cannot be targeted by card effects.
    canTarget: (u) => {
      const c = d.cards[u];
      if (c.loc === 'mz' && c.faceUp && defOf(d, u).race === 'Dragon') {
        const lord = allMonsters(d).some((m) => d.cards[m].faceUp && defOf(d, m).name === 'Lord of D.' && !d.cards[m].flags.negated);
        if (lord) return false;
      }
      return true;
    },
    choose: (player, options, opts = {}) => choose(ctx, player, options, opts),
    chooseOne: (player, options, opts = {}) => choose(ctx, player, options, { ...opts, min: 1, max: 1 })[0],
    yesNo: (player, title, data) => choose(ctx, player, ['yes', 'no'], { min: 1, max: 1, kind: 'option', title, data })[0] === 'yes',
    random: (n) => randInt(d, n),
    coin: () => {
      const r = nextRandom(d) < 0.5 ? 'heads' : 'tails';
      emit(d, 'coin', { p, result: r, uid: self });
      log(d, 'coin', { p, result: r });
      return r;
    },
    die: (pl = p) => {
      const r = 1 + randInt(d, 6);
      emit(d, 'die', { p: pl, result: r, uid: self });
      log(d, 'die', { p: pl, result: r });
      return r;
    },
    draw: (pl, n = 1) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const u = drawOne(d, pl);
        if (u) out.push(u);
      }
      return out;
    },
    damage: (pl, n) => damage(d, pl, n, 'effect', self),
    gainLp: (pl, n) => gainLp(d, pl, n),
    payLp: (pl, n) => payLp(d, pl, n),
    destroy: (u) => destroy(d, u, 'destroy', p),
    destroyAll: (list) => list.forEach((u) => onField(d, u) && destroy(d, u, 'destroy', p)),
    sendToGy: (u, reason = 'effect') => sendToGy(d, u, reason, p),
    discard: (u) => sendToGy(d, u, 'discard', p),
    banish: (u) => banish(d, u),
    toHand: (u) => toHand(d, u),
    toDeck: (u, shuffle = true) => toDeck(d, u, shuffle),
    shuffleDeck: (pl) => {
      shuffleInPlace(d, d.players[pl].deck);
      emit(d, 'shuffle', { p: pl });
    },
    specialSummon: (u, pl, pos = 'atk', faceUp = true, how = 'special') => {
      if (freeZone(d, pl, 'mz') < 0) return false;
      return summonMonster(d, u, pl, { pos, faceUp, how });
    },
    flip: (u, how = 'effect', silent = false) => flipFaceUp(d, u, { how, silent }),
    setFaceDown: (u) => setFaceDown(d, u),
    queueAttackStop: () => {
      if (d.battle) d.battle.negated = true;
    },
    endBattle: () => {
      d.flags.noMoreAttacks = d.turn;
    },
    revivable: (u) => revivable(d, u),
    markProper: (u) => {
      d.cards[u].proper = true;
    },
    setCard: (u) => {
      const z = freeZone(d, p, 'sz');
      if (z < 0) return false;
      putOnField(d, u, p, 'sz', z);
      d.cards[u].faceUp = false;
      d.cards[u].setTurn = d.turn;
      emit(d, 'set', { uid: u, id: null, p, zone: z, kind: 'st', from: 'hand' });
      return true;
    },
    destroyAtEnd: (u) => {
      d.flags.endDestroy = (d.flags.endDestroy || []).concat([[u, d.turn]]);
    },
    createToken: (pl, name, pos = 'def') => {
      if (freeZone(d, pl, 'mz') < 0) return null;
      const uid = addCard(d, idOf(name), pl, 'void');
      d.cards[uid].token = true;
      summonMonster(d, uid, pl, { pos, faceUp: true, how: 'token' });
      d.cards[uid].flags.noTribute = true;
      return uid;
    },
    changePos: (u, pos) => changePosition(d, u, pos),
    addMod: (u, mod) => {
      d.cards[u].mods.push(mod);
      emit(d, 'stat', { uid: u, atk: mod.atk || 0, def: mod.def || 0 });
    },
    takeControl: (u, pl, until) => takeControl(d, u, pl, until),
    equip: (eq, target) => attachEquip(d, eq, target),
    reveal: (u) => emit(d, 'reveal', { uid: u, id: d.cards[u].id, p }),
    emit: (type, data) => emit(d, type, data),
    lose: (pl, reason) => lose(d, pl, reason),
    win: (pl, reason) => lose(d, other(pl), reason),
    negateLink: (idx) => {
      const l = d.chain[idx];
      if (l) {
        l.negated = true;
        emit(d, 'negate', { uid: l.uid, id: d.cards[l.uid].id });
      }
    },
    chainTop: () => d.chain[d.chain.length - 1] || null,
    window: () => d.window,
    battle: () => d.battle,
    turn: () => d.turn,
    turnPlayer: () => d.turnPlayer,
    phase: () => d.phase,
    flags: (pl) => d.players[pl],
  };
  return ctx;
}

function choose(ctx, player, options, { min = 1, max = 1, kind = 'card', title = 'choose', data = null, cancel = false } = {}) {
  const proc = ctx.proc;
  if (!proc) throw new Error('choose() outside a procedure');
  const idx = proc.ai++;
  if (options.length === 0) return [];
  max = Math.min(max, options.length);
  min = Math.min(min, max);
  if (min === max && options.length === min && kind === 'card' && !proc.noAuto) return options.slice();
  const ans = proc.answers[idx];
  if (ans !== undefined) {
    if (ans === '__cancel__') throw new Abort();
    const arr = Array.isArray(ans) ? ans : [ans];
    if (arr.length >= min && arr.length <= max && arr.every((a) => options.includes(a))) return arr;
  }
  throw new NeedChoice({ player, options, min, max, kind, title, data, cancel: cancel || proc.cancelable });
}

// ---------------------------------------------------------------------------
// Procedures: player actions and effect steps run through runProc so that any
// choice they need can pause and resume deterministically.
// ---------------------------------------------------------------------------

function snapshot(d) {
  const ev = d.events;
  d.events = [];
  const s = structuredClone(d);
  d.events = ev;
  s.events = ev.slice();
  return s;
}

function restore(d, s) {
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, s);
}

function runProc(d, proc) {
  const snap = snapshot(d);
  proc.ai = 0;
  try {
    PROCS[proc.kind](d, proc);
    return true;
  } catch (e) {
    if (e instanceof NeedChoice) {
      restore(d, snap);
      d.pending = { type: 'choose', player: e.req.player, proc, ...e.req };
      return false;
    }
    if (e instanceof Abort) {
      restore(d, snap);
      return false;
    }
    restore(d, snap);
    throw e;
  }
}

const PROCS = {
  summon(d, proc) {
    const { p, uid, set } = proc.args;
    const ctx = ctxFor(d, p, uid, { proc });
    const def = defOf(d, uid);
    const need = CLASSIC_2004.tributes(def.level);
    let tributes = [];
    if (need > 0) {
      const opts = monsters(d, p).filter((u) => canTributeForSummon(d, u));
      tributes = ctx.choose(p, opts, { min: need, max: need, title: 'tribute', data: { need } });
      for (const t of tributes) {
        d.cards[t].lastCtrl = d.cards[t].ctrl;
        sendToGy(d, t, 'tribute', p);
      }
    }
    d.players[p].normalDone = true;
    if (set) summonMonster(d, uid, p, { pos: 'def', faceUp: false, how: 'set', tributes });
    else summonMonster(d, uid, p, { pos: 'atk', faceUp: true, how: need ? 'tribute' : 'normal', tributes });
  },
  activate(d, proc) {
    const { p, uid, eff = 0 } = proc.args;
    if (d.pending?.type === 'respond') {
      if (!d.window && d.pending.window?.kind !== 'chain') d.window = d.pending.window;
      d.pending = null;
    }
    const c = d.cards[uid];
    const def = defOf(d, uid);
    const e = effectOf(c.id);
    const act = eff === 'ign' ? e.ignition : e.activate;
    const link = { uid, p, kind: eff === 'ign' ? 'ign' : 'card', targets: [], data: {}, speed: act.speed ?? (eff === 'ign' ? 1 : baseSpeed(def)), negated: false, id: c.id };
    const ctx = ctxFor(d, p, uid, { proc, link });
    // Spell/Trap cards are placed face-up before targets and costs.
    if (eff !== 'ign') {
      if (c.loc === 'hand') {
        if (def.sub === 'Field') {
          if (d.players[p].fz) sendToGy(d, d.players[p].fz, 'effect', p);
          putOnField(d, uid, p, 'fz');
        } else {
          const z = freeZone(d, p, 'sz');
          putOnField(d, uid, p, 'sz', z);
        }
        c.faceUp = true;
        c.setTurn = -1;
      } else if (!c.faceUp) {
        c.faceUp = true;
      }
      c.flags.activating = true;
      if (isSpell(def)) d.players[p].stats.spells++;
      else d.players[p].stats.traps++;
    } else {
      c.once[act.onceKey || 'ign'] = d.turn;
    }
    if (act.target) act.target(ctx);
    if (act.cost) act.cost(ctx);
    d.chain.push(link);
    emit(d, 'activate', { uid, id: c.id, p, link: d.chain.length, targets: link.targets.slice(), kind: def.kind, ign: eff === 'ign' });
    log(d, 'activate', { p, id: c.id });
    startChainWindow(d, p);
  },
  trigger(d, proc) {
    const { t } = proc.args;
    const c = d.cards[t.uid];
    const e = effectOf(c.id);
    const trig = e.triggers[t.idx];
    const link = { uid: t.uid, p: t.p, kind: 'trigger', idx: t.idx, targets: [], data: { ...t.data }, speed: trig.speed ?? 1, negated: false, id: c.id };
    const ctx = ctxFor(d, t.p, t.uid, { proc, link, event: t.data });
    if (t.optional && !(proc.args.auto)) {
      if (!ctx.yesNo(t.p, 'useTrigger', { uid: t.uid, id: c.id })) return;
    }
    if (trig.target) trig.target(ctx);
    if (trig.cost) trig.cost(ctx);
    if (trig.noChain) {
      trig.resolve(ctx);
      return;
    }
    d.chain.push(link);
    if (!d.chainState) d.chainState = { respondTo: other(t.p), passes: 0, building: true, window: null };
    emit(d, 'activate', { uid: t.uid, id: c.id, p: t.p, link: d.chain.length, targets: link.targets.slice(), kind: cardById(c.id).kind, trigger: true });
  },
  resolve(d, proc) {
    const link = d.chain[d.chain.length - 1];
    const c = d.cards[link.uid];
    const e = effectOf(link.id);
    const def = cardById(link.id);
    const ctx = ctxFor(d, link.p, link.uid, { proc, link, event: link.data });
    d.chain.pop();
    let negated = link.negated;
    // A card that left the field before resolving (e.g. destroyed in chain)
    // still resolves if it is a Spell/Trap activation (2004 rulings), except
    // continuous/equip which need to stay on the field.
    const stillThere = onField(d, link.uid) && c.faceUp;
    const needsField = link.kind === 'card' && ['Continuous', 'Equip', 'Field'].includes(def.sub);
    if (needsField && !stillThere) negated = true;
    if (link.kind === 'card' && isTrap(def) && jinzoActive(d)) negated = true;
    // Big Shield Gardna: negate a Spell that targets only this face-down card.
    if (!negated && isSpell(def) && link.targets.length === 1) {
      const t = d.cards[link.targets[0]];
      if (t && t.loc === 'mz' && !t.faceUp && cardById(t.id).name === 'Big Shield Gardna') {
        negated = true;
        flipFaceUp(d, link.targets[0], { how: 'effect' });
      }
    }
    emit(d, 'resolve', { uid: link.uid, id: link.id, p: link.p, negated });
    if (!negated) {
      const act = link.kind === 'trigger' ? e.triggers[link.idx] : link.kind === 'ign' ? e.ignition : e.activate;
      act.resolve(ctx);
    }
    // After resolution: one-shot spell/trap cards go to the Graveyard.
    if (link.kind === 'card' && onField(d, link.uid)) {
      const cc = d.cards[link.uid];
      cc.flags.activating = false;
      const stays = ['Continuous', 'Field'].includes(def.sub) || (def.sub === 'Equip' && cc.equipTo && !negated) || (e.staysOnField && !negated) || (e.isEquipTrap && cc.equipTo && !negated);
      if (!stays) sendToGy(d, link.uid, 'resolved', link.p);
    }
  },
  attack(d, proc) {
    const { p, uid, target } = proc.args;
    const ctx = ctxFor(d, p, uid, { proc });
    const e = effectOf(d.cards[uid].id);
    if (e?.attackCost) e.attackCost(ctx);
    declareAttack(d, p, uid, target);
  },
  replay(d, proc) {
    const { p } = proc.args;
    const b = d.battle;
    const ctx = ctxFor(d, p, b.attacker, { proc });
    const targets = attackTargets(d, b.attacker);
    const options = targets.map((t) => t ?? 'direct').concat(['stop']);
    const pick = ctx.chooseOne(p, options, { kind: 'option', title: 'replay', data: { attacker: b.attacker } });
    if (pick === 'stop') {
      emit(d, 'attackStop', { uid: b.attacker });
      d.battle = null;
      return;
    }
    b.target = pick === 'direct' ? null : pick;
    b.count = monsters(d, other(p)).length;
    b.stage = 'check';
    emit(d, 'attack', { uid: b.attacker, target: b.target, p, replay: true });
  },
  handLimit(d, proc) {
    const p = d.turnPlayer;
    const ctx = ctxFor(d, p, null, { proc });
    const over = d.players[p].hand.length - CLASSIC_2004.handLimit;
    if (over > 0) {
      const picks = ctx.choose(p, d.players[p].hand.slice(), { min: over, max: over, title: 'discardLimit' });
      for (const u of picks) sendToGy(d, u, 'discard', p);
    }
    d.step = 'endTurn';
  },
  effectStep(d, proc) {
    // A step an effect queued to run outside a chain (end-phase upkeep).
    const { uid, p, fn } = proc.args;
    const e = effectOf(d.cards[uid].id);
    e.steps[fn](ctxFor(d, p, uid, { proc }));
  },
};

export function startChainWindow(d, activator) {
  if (!d.chainState) d.chainState = { respondTo: other(activator), passes: 0, window: d.window };
  else {
    d.chainState.respondTo = other(activator);
    d.chainState.passes = 0;
  }
}

function queueWindow(d, kind, data) {
  d.windows.push({ kind, ...data });
}

function queueSummonWindow(d, uid, how, p) {
  const last = d.windows[d.windows.length - 1];
  if (last && last.kind === 'summon' && !last.asked && last.p === p) {
    last.uids.push(uid);
    return;
  }
  queueWindow(d, 'summon', { uids: [uid], how, p });
}

function takeControl(d, uid, p, until) {
  const c = d.cards[uid];
  if (c.ctrl === p) return;
  const z = freeZone(d, p, 'mz');
  if (z < 0) return false;
  const from = c.ctrl;
  d.players[from].mz[d.players[from].mz.indexOf(uid)] = null;
  d.players[p].mz[z] = uid;
  c.ctrl = p;
  c.attacks = 0;
  if (until) c.flags.returnAt = until;
  emit(d, 'control', { uid, id: c.id, p, from });
  log(d, 'control', { p, id: c.id });
  return true;
}

function attachEquip(d, eq, target) {
  const e = d.cards[eq];
  e.equipTo = target;
  emit(d, 'equip', { uid: eq, target, id: e.id });
  // Gearfried the Iron Knight destroys any Equip Card equipped to it.
  const t = d.cards[target];
  if (t && t.faceUp && cardById(t.id).name === 'Gearfried the Iron Knight') {
    destroy(d, eq, 'destroy');
  }
}

// ---------------------------------------------------------------------------
// State checks (after every action / link)
// ---------------------------------------------------------------------------

function checkState(d) {
  if (d.winner !== null) return;
  const lost = [0, 1].filter((p) => d.players[p].lp <= 0);
  if (lost.length === 2) {
    d.winner = -1;
    d.winReason = 'draw';
    emit(d, 'win', { winner: -1, reason: 'draw' });
    return;
  }
  if (lost.length === 1) {
    lose(d, lost[0], 'lp');
    return;
  }
  // Exodia: all five pieces in hand.
  for (const p of [0, 1]) {
    const names = new Set(d.players[p].hand.map((u) => defOf(d, u).name));
    if (['Exodia the Forbidden One', 'Left Arm of the Forbidden One', 'Right Arm of the Forbidden One', 'Left Leg of the Forbidden One', 'Right Leg of the Forbidden One'].every((n) => names.has(n))) {
      emit(d, 'exodia', { p });
      lose(d, other(p), 'exodia');
      return;
    }
  }
  if (d.chain.length && !d.chainState?.resolving) return; // equips resolve after the chain
  // Equip cards / linked continuous cards whose target is gone.
  for (const p of [0, 1]) {
    for (const u of spellTraps(d, p)) {
      const c = d.cards[u];
      if (c.flags.activating) continue;
      const e = effectOf(c.id);
      if (c.equipTo) {
        const t = d.cards[c.equipTo];
        const ok = t && t.loc === 'mz' && t.faceUp && (!e?.equip?.filter || e.equip.filter(cardById(t.id), d, c.equipTo));
        if (!ok) {
          c.equipTo = null;
          destroy(d, u, 'destroy');
        }
      } else if (c.faceUp && (cardById(c.id).sub === 'Equip' || e?.isEquipTrap) && !c.flags.activating && !d.chain.some((l) => l.uid === u)) {
        sendToGy(d, u, 'destroy', p);
      }
      if (c.flags.linked) {
        const t = d.cards[c.flags.linked];
        if (!t || t.loc !== 'mz') {
          c.flags.linked = null;
          if (onField(d, u)) destroy(d, u, 'destroy');
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

// Fusion, Ritual and "Special Summon only" monsters can only be revived after
// they were properly summoned once.
export function revivable(d, uid) {
  const c = d.cards[uid];
  const def = cardById(c.id);
  if (!def || !isMonster(def)) return false;
  const e = effectOf(c.id);
  if (def.frame === 'fusion' || def.frame === 'ritual' || e?.specialOnly) return !!c.proper;
  return true;
}

export function attackTargets(d, uid) {
  const c = d.cards[uid];
  const p = c.ctrl;
  const opp = other(p);
  const mons = monsters(d, opp);
  if (mons.length) {
    const e = effectOf(c.id);
    const direct = e?.canDirect && e.canDirect(ctxFor(d, p, uid));
    return direct ? [...mons, null] : mons;
  }
  const e = effectOf(c.id);
  if (e?.noDirect) return [];
  return [null];
}

function positionLocked(d, uid) {
  return activeSources(d).some((s) => s.e.lockPosition && s.e.lockPosition(ctxFor(d, s.c.ctrl, s.uid), uid));
}

function canDeclareAttack(d, uid) {
  const c = d.cards[uid];
  const p = c.ctrl;
  if (d.phase !== 'battle' || d.turnPlayer !== p) return false;
  if (c.loc !== 'mz' || !c.faceUp || c.pos !== 'atk') return false;
  const maxAttacks = effectOf(c.id)?.attacksPerTurn || 1;
  if (c.attacks >= maxAttacks) return false;
  if (d.flags.noMoreAttacks === d.turn) return false;
  if (d.turn === 1 && !CLASSIC_2004.firstPlayerCanAttack) return false;
  if (c.flags.cannotAttack === d.turn) return false;
  // Swords of Revealing Light / similar locks from the opponent's side.
  for (const s of activeSources(d)) {
    if (s.e.lockAttacks && s.e.lockAttacks(ctxFor(d, s.c.ctrl, s.uid), uid)) return false;
  }
  const e = effectOf(c.id);
  if (e?.attackCostCan && !e.attackCostCan(ctxFor(d, p, uid))) return false;
  return attackTargets(d, uid).length > 0;
}

function declareAttack(d, p, uid, target) {
  const c = d.cards[uid];
  c.attacks += 1;
  d.battle = { attacker: uid, target, stage: 'check', count: monsters(d, other(p)).length, negated: false, atkBonus: 0 };
  emit(d, 'attack', { uid, target, p });
  log(d, 'attack', { p, id: c.id, target: target ? d.cards[target].faceUp ? d.cards[target].id : 0 : null });
  raise(d, 'attackDeclared', { attacker: uid, target, p });
  queueWindow(d, 'attack', { attacker: uid, target, p });
}

function battleStep(d) {
  const b = d.battle;
  const a = d.cards[b.attacker];
  const p = d.turnPlayer;
  if (b.negated || !a || a.loc !== 'mz' || a.ctrl !== p || !a.faceUp || a.pos !== 'atk') {
    if (b.negated) emit(d, 'attackNegated', { uid: b.attacker });
    d.battle = null;
    return;
  }
  if (b.stage === 'check') {
    const count = monsters(d, other(p)).length;
    const targetGone = b.target && (d.cards[b.target].loc !== 'mz' || d.cards[b.target].ctrl === p);
    if (CLASSIC_2004.replay && (targetGone || count !== b.count)) {
      b.stage = 'replay';
      if (!runProc(d, { kind: 'replay', args: { p }, answers: [] })) return;
      return;
    }
    b.stage = 'damage';
    resolveDamage(d);
  }
}

function resolveDamage(d) {
  const b = d.battle;
  const p = d.turnPlayer;
  const opp = other(p);
  const A = b.attacker;
  const T = b.target;
  const aCard = d.cards[A];
  const aEff = effectOf(aCard.id);
  if (T && !d.cards[T].faceUp) flipFaceUp(d, T, { how: 'attacked' });
  const tEff = T ? effectOf(d.cards[T].id) : null;
  if (T && aEff?.attackBonus) b.atkBonus = aEff.attackBonus(ctxFor(d, p, A), T);
  // Metalmorph-style equip bonus when attacking.
  for (const s of activeSources(d)) if (s.c.equipTo === A && s.e.equip?.attackBonus && T) b.atkBonus += s.e.equip.attackBonus(ctxFor(d, s.c.ctrl, s.uid), T);
  const aAtk = atkOf(d, A);
  const noDmg = (pl) => d.players[pl].flags?.noBattleDamage === d.turn;
  const noBattleDestroy = (pl) => d.players[pl].flags?.noBattleDestroy === d.turn;
  const rocketShield = (uid) => {
    const e = effectOf(d.cards[uid].id);
    return e?.battleShield && d.cards[uid].ctrl === d.turnPlayer && uid === A;
  };
  const res = { attacker: A, target: T, aAtk, damage: [0, 0], destroyed: [] };
  if (!T) {
    const dmg = noDmg(opp) ? 0 : aAtk;
    res.damage[opp] = dmg;
    emit(d, 'battle', { ...res });
    if (dmg) damage(d, opp, dmg, 'battle', A);
  } else {
    const t = d.cards[T];
    const tVal = t.pos === 'atk' ? atkOf(d, T) : defStatOf(d, T);
    res.tVal = tVal;
    res.tPos = t.pos;
    const kill = [];
    if (t.pos === 'atk') {
      if (aAtk > tVal) {
        kill.push(T);
        if (!noDmg(opp)) res.damage[opp] = aAtk - tVal;
      } else if (aAtk < tVal) {
        kill.push(A);
        if (!noDmg(p) && !rocketShield(A)) res.damage[p] = tVal - aAtk;
      } else if (aAtk > 0) {
        kill.push(A, T);
      }
    } else {
      if (aAtk > tVal) kill.push(T);
      else if (aAtk < tVal && !noDmg(p) && !rocketShield(A)) res.damage[p] = tVal - aAtk;
    }
    const finalKill = kill.filter((u) => {
      const c = d.cards[u];
      if (noBattleDestroy(c.ctrl)) return false;
      if (rocketShield(u)) return false;
      const e = effectOf(c.id);
      if (e?.battleIndestructible) return false;
      return true;
    });
    res.destroyed = finalKill;
    emit(d, 'battle', { ...res });
    for (const pl of [0, 1]) if (res.damage[pl]) damage(d, pl, res.damage[pl], 'battle', pl === opp ? A : T);
    for (const u of finalKill) {
      const c = d.cards[u];
      c.lastCtrl = c.ctrl;
      c.flags.destroyedBy = u === T ? A : T;
      destroy(d, u, 'battle');
    }
    if (finalKill.includes(T) && aEff?.afterKill) aEff.afterKill(ctxFor(d, p, A), T);
    if (aEff?.afterDamage && d.cards[A].loc === 'mz') aEff.afterDamage(ctxFor(d, p, A), T);
    if (tEff?.afterAttacked && d.cards[T].loc === 'mz') tEff.afterAttacked(ctxFor(d, d.cards[T].ctrl, T), A);
  }
  if (aEff?.afterAttack && d.cards[A].loc === 'mz') aEff.afterAttack(ctxFor(d, p, A));
  d.battle = null;
  d.flags.lpCheck = true;
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

function canActivate(d, p, uid, eff = 0, chainCtx = null) {
  const c = d.cards[uid];
  const def = cardById(c.id);
  const e = effectOf(c.id);
  if (!e) return false;
  const act = eff === 'ign' ? e.ignition : e.activate;
  if (!act) return false;
  const speed = act.speed ?? (eff === 'ign' ? 1 : baseSpeed(def));
  const myTurn = d.turnPlayer === p;
  const top = d.chain[d.chain.length - 1];
  const inChain = d.chain.length > 0;
  const openMain = myTurn && (d.phase === 'main1' || d.phase === 'main2') && !inChain && !d.pending;
  if (inChain || chainCtx?.window) {
    if (speed < 2) return false;
    if (top && speed < top.speed) return false;
  } else if (!openMain && speed < 2) return false;
  if (eff === 'ign') {
    if (c.loc !== 'mz' || !c.faceUp || c.ctrl !== p) return false;
    if (!act.unlimited && c.once[act.onceKey || 'ign'] === d.turn) return false;
  } else if (isSpell(def) || isTrap(def)) {
    if (c.ctrl !== p && c.loc !== 'hand') return false;
    if (c.loc === 'hand') {
      if (d.players[p].hand.indexOf(uid) < 0) return false;
      if (isTrap(def)) return false; // traps must be Set first
      if (def.sub === 'Quick-Play' && !myTurn) return false;
      if (def.sub !== 'Field' && freeZone(d, p, 'sz') < 0) return false;
    } else if (c.loc === 'sz' || c.loc === 'fz') {
      if (c.faceUp) return false; // already active
      if ((isTrap(def) || def.sub === 'Quick-Play') && c.setTurn >= d.turn && CLASSIC_2004.trapsNeedSetTurn) return false;
    } else return false;
    if (isTrap(def) && jinzoActive(d)) return false;
    if (d.chain.some((l) => l.uid === uid)) return false;
  } else return false;
  const ctx = ctxFor(d, p, uid, { link: { uid, p, targets: [], data: {} } });
  ctx.chainCtx = chainCtx;
  try {
    return act.can ? !!act.can(ctx) : true;
  } catch {
    return false;
  }
}

function activatableCards(d, p, chainCtx) {
  const pl = d.players[p];
  const out = [];
  for (const u of [...pl.hand, ...pl.sz.filter(Boolean), ...(pl.fz ? [pl.fz] : [])]) {
    if (canActivate(d, p, u, 0, chainCtx)) out.push({ type: 'activate', uid: u, eff: 0 });
  }
  for (const u of pl.mz.filter(Boolean)) {
    const e = effectOf(d.cards[u].id);
    if (e?.ignition && canActivate(d, p, u, 'ign', chainCtx)) out.push({ type: 'activate', uid: u, eff: 'ign' });
  }
  return out;
}

export function getActions(d, p) {
  if (d.winner !== null) return [];
  const acts = [];
  if (d.pending) {
    const pd = d.pending;
    if (pd.player !== p) return [];
    if (pd.type === 'respond') {
      acts.push(...activatableCards(d, p, { window: pd.window }));
      acts.push({ type: 'pass' });
      return acts;
    }
    if (pd.type === 'choose') {
      acts.push({ type: 'choose' });
      if (pd.cancel) acts.push({ type: 'cancel' });
      return acts;
    }
    return acts;
  }
  if (d.chain.length || d.triggers.length || d.windows.length || d.battle) return [];
  if (d.turnPlayer !== p) return [];
  const pl = d.players[p];
  const main = d.phase === 'main1' || d.phase === 'main2';
  if (main) {
    for (const u of pl.hand) {
      const def = defOf(d, u);
      if (isMonster(def)) {
        if (!pl.normalDone && def.frame !== 'fusion' && def.frame !== 'ritual' && !effectOf(def.id)?.noNormalSummon) {
          const need = CLASSIC_2004.tributes(def.level);
          const avail = monsters(d, p).filter((m) => canTributeForSummon(d, m)).length;
          const zoneOk = need > 0 ? avail >= need : freeZone(d, p, 'mz') >= 0;
          if (zoneOk && avail >= need) {
            if (pl.summonLockTurn !== d.turn) acts.push({ type: 'summon', uid: u });
            acts.push({ type: 'set', uid: u });
          }
        }
      } else if (freeZone(d, p, 'sz') >= 0 && def.sub !== 'Field') {
        acts.push({ type: 'setST', uid: u });
      }
    }
    for (const u of pl.mz.filter(Boolean)) {
      const c = d.cards[u];
      if (!c.faceUp && c.setTurn < d.turn && c.posTurn < d.turn && pl.summonLockTurn !== d.turn) acts.push({ type: 'flip', uid: u });
      else if (c.faceUp && c.sumTurn < d.turn && c.posTurn < d.turn && !c.attacks && !(c.flags.posLockUntil >= d.turn) && !positionLocked(d, u)) acts.push({ type: 'position', uid: u });
    }
  }
  if (main || d.phase === 'battle') acts.push(...activatableCards(d, p, null));
  if (d.phase === 'battle') {
    for (const u of pl.mz.filter(Boolean)) {
      if (!canDeclareAttack(d, u)) continue;
      for (const t of attackTargets(d, u)) acts.push({ type: 'attack', uid: u, target: t });
    }
  }
  if (d.phase === 'main1') {
    if (d.turn !== 1) acts.push({ type: 'phase', to: 'battle' });
    acts.push({ type: 'phase', to: 'end' });
  } else if (d.phase === 'battle') acts.push({ type: 'phase', to: 'main2' });
  else if (d.phase === 'main2') acts.push({ type: 'phase', to: 'end' });
  acts.push({ type: 'surrender' });
  return acts;
}

export function actionKey(a) {
  return [a.type, a.uid ?? '', a.target === undefined ? '' : a.target ?? 'direct', a.eff ?? '', a.to ?? ''].join('|');
}

// ---------------------------------------------------------------------------
// Acting
// ---------------------------------------------------------------------------

export function act(d, p, action) {
  if (d.winner !== null) return { ok: false, reason: 'over' };
  if (action.type === 'surrender' && !d.pending) {
    lose(d, p, 'surrender');
    return { ok: true };
  }
  if (action.type === 'surrender') {
    lose(d, p, 'surrender');
    return { ok: true };
  }
  if (action.type === 'choose' || action.type === 'cancel') {
    const pd = d.pending;
    if (!pd || pd.type !== 'choose' || pd.player !== p) return { ok: false, reason: 'notYourChoice' };
    if (action.type === 'cancel') {
      if (!pd.cancel) return { ok: false, reason: 'cannotCancel' };
      d.pending = null;
      pd.proc.answers.push('__cancel__');
      runProc(d, pd.proc);
      advance(d);
      return { ok: true };
    }
    const values = Array.isArray(action.values) ? action.values : [action.values];
    if (values.length < pd.min || values.length > pd.max || !values.every((v) => pd.options.includes(v)) || new Set(values).size !== values.length) {
      return { ok: false, reason: 'badChoice' };
    }
    d.pending = null;
    pd.proc.answers.push(values);
    runProc(d, pd.proc);
    advance(d);
    return { ok: true };
  }
  const legal = getActions(d, p);
  const key = actionKey(action);
  const match = legal.find((a) => actionKey(a) === key);
  if (!match) return { ok: false, reason: explainIllegal(d, p, action) };
  if (action.type === 'pass') {
    passPriority(d, p);
    advance(d);
    return { ok: true };
  }
  switch (action.type) {
    case 'summon':
    case 'set':
      runProc(d, { kind: 'summon', args: { p, uid: action.uid, set: action.type === 'set' }, answers: [], cancelable: true });
      break;
    case 'setST': {
      const c = d.cards[action.uid];
      const z = freeZone(d, p, 'sz');
      putOnField(d, action.uid, p, 'sz', z);
      c.faceUp = false;
      c.setTurn = d.turn;
      emit(d, 'set', { uid: action.uid, id: null, p, zone: z, kind: 'st', from: 'hand' });
      log(d, 'setST', { p });
      break;
    }
    case 'flip': {
      const c = d.cards[action.uid];
      c.posTurn = d.turn;
      c.pos = 'atk';
      flipFaceUp(d, action.uid, { how: 'flipSummon', pos: 'atk' });
      d.players[p].stats.summons++;
      raise(d, 'summoned', { uid: action.uid, how: 'flip', p });
      queueSummonWindow(d, action.uid, 'flip', p);
      break;
    }
    case 'position': {
      const c = d.cards[action.uid];
      changePosition(d, action.uid, c.pos === 'atk' ? 'def' : 'atk');
      break;
    }
    case 'activate': {
      runProc(d, { kind: 'activate', args: { p, uid: action.uid, eff: action.eff }, answers: [], cancelable: true });
      break;
    }
    case 'attack':
      runProc(d, { kind: 'attack', args: { p, uid: action.uid, target: action.target }, answers: [], cancelable: true });
      break;
    case 'phase':
      gotoPhase(d, action.to);
      break;
  }
  advance(d);
  return { ok: true };
}

export function explainIllegal(d, p, a) {
  if (d.pending && d.pending.player !== p) return 'waitOpponent';
  if (d.turnPlayer !== p && !d.pending) return 'notYourTurn';
  const c = a.uid ? d.cards[a.uid] : null;
  if (a.type === 'summon' || a.type === 'set') {
    if (d.players[p].normalDone) return 'normalUsed';
    if (!['main1', 'main2'].includes(d.phase)) return 'mainOnly';
    const def = c && defOf(d, a.uid);
    if (def && CLASSIC_2004.tributes(def.level) > monsters(d, p).length) return 'needTributes';
    if (def && (def.frame === 'fusion' || def.frame === 'ritual' || effectOf(def.id)?.noNormalSummon)) return 'specialOnly';
    return 'zonesFull';
  }
  if (a.type === 'attack') {
    if (d.phase !== 'battle') return 'battleOnly';
    if (d.turn === 1) return 'firstTurnNoAttack';
    if (c && c.pos !== 'atk') return 'defCannotAttack';
    if (c && c.attacks) return 'alreadyAttacked';
    return 'cannotAttack';
  }
  if (a.type === 'activate') {
    if (c && isTrap(defOf(d, a.uid)) && c.loc === 'hand') return 'setTrapFirst';
    if (c && c.setTurn >= d.turn) return 'setThisTurn';
    if (jinzoActive(d) && c && isTrap(defOf(d, a.uid))) return 'jinzo';
    return 'conditionsNotMet';
  }
  if (a.type === 'position' || a.type === 'flip') return 'positionLocked';
  return 'illegal';
}

function passPriority(d, p) {
  const pd = d.pending;
  d.pending = null;
  if (d.chainState && d.chain.length) {
    d.chainState.passes++;
    d.chainState.respondTo = other(p);
  } else if (pd?.window) {
    pd.window.passed = (pd.window.passed || 0) + 1;
  }
}

function gotoPhase(d, to) {
  if (d.phase === 'battle') endBattlePhase(d);
  if (to === 'battle') {
    setPhase(d, 'battle');
    queueWindow(d, 'phase', { phase: 'battle', p: d.turnPlayer, only: other(d.turnPlayer) });
  } else if (to === 'main2') {
    setPhase(d, 'main2');
  } else if (to === 'end') {
    setPhase(d, 'end');
    d.step = 'endPhase';
    queueWindow(d, 'phase', { phase: 'end', p: d.turnPlayer, only: other(d.turnPlayer) });
  }
}

function setPhase(d, phase) {
  d.phase = phase;
  emit(d, 'phase', { phase, p: d.turnPlayer });
}

function endBattlePhase(d) {
  for (const u of monsters(d, d.turnPlayer)) {
    const c = d.cards[u];
    if (c.flags.goblinRest) {
      c.flags.goblinRest = false;
      if (c.pos === 'atk') changePosition(d, u, 'def');
      c.flags.posLockUntil = d.turn + 2;
    }
  }
}

// ---------------------------------------------------------------------------
// The flow loop
// ---------------------------------------------------------------------------

function hasResponse(d, p, window) {
  return activatableCards(d, p, { window }).length > 0;
}

export function advance(d) {
  for (let guard = 0; guard < 2000; guard++) {
    if (d.winner !== null) return;
    if (d.pending) return;
    if (d.flags.lpCheck || d.flags.pendingEquipCheck) {
      d.flags.lpCheck = false;
      d.flags.pendingEquipCheck = false;
    }
    checkState(d);
    if (d.winner !== null) return;

    // 1. A chain resolving runs to the end before anything new starts.
    // 2. Triggers waiting to go on a new chain (turn player's first).
    if (d.triggers.length && (!d.chain.length || d.chainState?.building)) {
      d.triggers.sort((a, b) => (a.p === d.turnPlayer ? 0 : 1) - (b.p === d.turnPlayer ? 0 : 1));
      const t = d.triggers.shift();
      if (!runProc(d, { kind: 'trigger', args: { t }, answers: [] })) return;
      continue;
    }
    if (d.chain.length) {
      const cs = d.chainState;
      if (cs.building) {
        cs.building = false;
        cs.respondTo = other(d.chain[d.chain.length - 1].p);
        cs.passes = 0;
      }
      if (cs.passes >= 2 || cs.resolving) {
        cs.resolving = true;
        if (!runProc(d, { kind: 'resolve', args: {}, answers: [] })) return;
        if (!d.chain.length) {
          d.chainState = null;
          d.window = null;
          emit(d, 'chainEnd', {});
        }
        continue;
      }
      const p = cs.respondTo;
      if (hasResponse(d, p, cs.window)) {
        d.pending = { type: 'respond', player: p, window: cs.window || { kind: 'chain' }, chainTop: d.chain[d.chain.length - 1].uid };
        return;
      }
      cs.passes++;
      cs.respondTo = other(p);
      continue;
    }
    if (d.chainState) {
      d.chainState = null;
      d.window = null;
    }

    // 3. Response windows (summon, attack declaration, phase start).
    if (d.windows.length) {
      const w = d.windows[0];
      // Only the other player is asked: the acting player keeps priority in
      // their own open game state and can chain to any response.
      const order = w.only !== undefined ? [w.only] : [other(w.p)];
      w.asked = w.asked || 0;
      if (w.asked >= order.length) {
        d.windows.shift();
        if (!d.chain.length) d.window = null;
        continue;
      }
      const who = order[w.asked];
      w.asked++;
      d.window = w;
      if (hasResponse(d, who, w)) {
        d.pending = { type: 'respond', player: who, window: w };
        return;
      }
      continue;
    }

    // 4. Battle in progress.
    if (d.battle) {
      battleStep(d);
      continue;
    }

    // 5. Turn structure.
    switch (d.step) {
      case 'turnStart': {
        d.turn += 1;
        d.turnPlayer = other(d.turnPlayer);
        const pl = d.players[d.turnPlayer];
        pl.normalDone = false;
        for (const u of monsters(d, d.turnPlayer)) d.cards[u].attacks = 0;
        emit(d, 'turn', { p: d.turnPlayer, turn: d.turn });
        log(d, 'turn', { p: d.turnPlayer, turn: d.turn });
        setPhase(d, 'draw');
        d.step = 'draw';
        break;
      }
      case 'draw': {
        if (d.turn > 1 || CLASSIC_2004.firstPlayerDraws) drawOne(d, d.turnPlayer);
        if (d.winner !== null) return;
        d.step = 'standby';
        setPhase(d, 'standby');
        raise(d, 'standby', { p: d.turnPlayer });
        break;
      }
      case 'standby':
        setPhase(d, 'main1');
        d.step = 'open';
        break;
      case 'open':
        return; // waiting for the turn player
      case 'endPhase': {
        raise(d, 'endPhase', { p: d.turnPlayer });
        d.step = 'endExpire';
        break;
      }
      case 'endExpire': {
        for (const [u, t] of d.flags.endDestroy || []) if (t === d.turn && onField(d, u)) destroy(d, u, 'destroy');
        d.flags.endDestroy = (d.flags.endDestroy || []).filter(([, t]) => t > d.turn);
        // "Until the End Phase" effects end; borrowed monsters return.
        for (const u of Object.keys(d.cards)) {
          const c = d.cards[u];
          if (c.mods.length) {
            const before = c.mods.length;
            c.mods = c.mods.filter((m) => m.until !== 'turn');
            if (c.mods.length !== before) emit(d, 'stat', { uid: u });
          }
          if (c.loc === 'mz' && c.flags.returnAt === d.turn) {
            c.flags.returnAt = null;
            takeControl(d, u, c.owner, null);
          }
        }
        d.step = 'handLimit';
        break;
      }
      case 'handLimit': {
        if (d.players[d.turnPlayer].hand.length > CLASSIC_2004.handLimit) {
          if (!runProc(d, { kind: 'handLimit', args: {}, answers: [] })) return;
        } else d.step = 'endTurn';
        break;
      }
      case 'endTurn':
        d.step = 'turnStart';
        break;
      default:
        return;
    }
  }
  throw new Error('advance(): flow did not settle');
}

// ---------------------------------------------------------------------------
// Observation for the AI: the same duel with everything its player could not
// know replaced by unknown cards. The AI only ever sees this.
// ---------------------------------------------------------------------------

export const UNKNOWN_ID = 0;

export function observe(d, p) {
  const o = structuredClone({ ...d, events: [], log: [] });
  o.flags = { ...o.flags, sim: true };
  const opp = other(p);
  const hide = (u, id = UNKNOWN_ID) => {
    o.cards[u].id = id;
  };
  for (const u of o.players[opp].hand) hide(u);
  for (const u of o.players[opp].deck) hide(u);
  for (const u of o.players[opp].extra) hide(u);
  for (const u of o.players[opp].mz) if (u && !o.cards[u].faceUp) hide(u, -1);
  for (const u of o.players[opp].sz) if (u && !o.cards[u].faceUp) hide(u, -2);
  // Its own deck order is unknown to the AI as well.
  o.rng = (o.rng ^ 0x5bd1e995) | 0;
  shuffleInPlace(o, o.players[p].deck);
  return o;
}

export function cloneForSim(d) {
  const o = structuredClone({ ...d, events: [], log: [] });
  o.flags = { ...o.flags, sim: true };
  return o;
}

// Helpers used by tests and the UI.
export function findInHand(d, p, name) {
  const id = idOf(name);
  return d.players[p].hand.find((u) => d.cards[u].id === id) || null;
}
export const nameOf = (d, uid) => defOf(d, uid)?.name;
export { cardByName };
