// Joey's AI. It decides from observe(d, p) — the duel as its player could
// legitimately know it: the opponent's hand, deck and face-down cards are
// unknown stand-ins, and even its own deck order is reshuffled. It picks among
// getActions() only, so every move it makes is legal.
//
// How it thinks: each candidate action is played out on a copy of that
// observation until the game is quiet again, and the resulting board is scored
// (life points, board strength, card advantage, next-turn threat, risk from
// face-down Spell/Traps). Difficulty profiles change foresight, risk sense,
// trap timing and how often a lesser move slips through — never the cards.

import { getActions, act, observe, cloneForSim, atkOf, defStatOf, monsters, spellTraps, other, actionKey } from './duel.js';
import { cardById, isMonster, isTrap } from './cards.js';
import { effectOf } from './effects.js';

export const AI_PROFILES = {
  beginner: { id: 'beginner', noise: 0.5, slip: 0.3, lookahead: 0, trapSense: 0, threat: 0.15, holdTraps: 0, setTraps: 0.4, conserve: 0 },
  easy: { id: 'easy', noise: 0.3, slip: 0.15, lookahead: 0, trapSense: 0.25, threat: 0.4, holdTraps: 0.2, setTraps: 0.7, conserve: 0.2 },
  normal: { id: 'normal', noise: 0.12, slip: 0.05, lookahead: 0, trapSense: 0.6, threat: 0.8, holdTraps: 0.5, setTraps: 1, conserve: 0.5 },
  hard: { id: 'hard', noise: 0.04, slip: 0, lookahead: 1, trapSense: 0.9, threat: 1, holdTraps: 0.8, setTraps: 1, conserve: 0.8 },
  expert: { id: 'expert', noise: 0.01, slip: 0, lookahead: 1, trapSense: 1, threat: 1.15, holdTraps: 1, setTraps: 1, conserve: 1 },
  challenge: { id: 'challenge', noise: 0, slip: 0, lookahead: 2, trapSense: 1.1, threat: 1.25, holdTraps: 1.2, setTraps: 1, conserve: 1.2 },
};

// Deterministic jitter so the AI's "mistakes" are reproducible per decision.
function jitter(seed, i) {
  let t = (seed * 2654435761 + i * 40503) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Static evaluation from player p's point of view
// ---------------------------------------------------------------------------

function monsterValue(d, u) {
  const c = d.cards[u];
  const def = cardById(c.id);
  if (!c.faceUp) return c.id === -1 ? 15 : 12 + (def?.def ?? 1000) / 250;
  const atk = atkOf(d, u);
  const df = defStatOf(d, u);
  let v = c.pos === 'atk' ? atk / 100 + df / 400 : df / 120 + atk / 400;
  if (def?.frame === 'effect') v += 2;
  if (c.flags.returnAt) v *= 0.3; // borrowed until end of turn
  if (c.token) v *= 0.6;
  return v + 3;
}

function stValue(d, u) {
  const c = d.cards[u];
  if (!c.faceUp) return c.id === -2 ? 6 : 5;
  const def = cardById(c.id);
  if (def?.sub === 'Field' || def?.sub === 'Continuous' || def?.sub === 'Equip' || effectOf(c.id)?.isEquipTrap) return 3;
  return 1;
}

// Damage and losses the opponent can inflict with what is visible now.
function threat(d, p) {
  const o = other(p);
  const attackers = monsters(d, o)
    .filter((u) => d.cards[u].faceUp && d.cards[u].pos === 'atk')
    .map((u) => atkOf(d, u))
    .sort((a, b) => b - a);
  if (!attackers.length) return { dmg: 0, lost: 0 };
  const mine = monsters(d, p).map((u) => ({ u, val: d.cards[u].faceUp ? (d.cards[u].pos === 'atk' ? atkOf(d, u) : defStatOf(d, u)) : 1500, atk: d.cards[u].pos === 'atk', mv: monsterValue(d, u) }));
  let dmg = 0;
  let lost = 0;
  for (const a of attackers) {
    if (mine.length) {
      // the attacker hits the most valuable thing it can beat
      mine.sort((x, y) => y.mv - x.mv);
      const idx = mine.findIndex((m) => m.val < a);
      if (idx >= 0) {
        const m = mine.splice(idx, 1)[0];
        lost += m.mv;
        if (m.atk) dmg += a - m.val;
      }
    } else dmg += a;
  }
  return { dmg, lost };
}

// What my visible attackers could do in the coming Battle Phase.
function attackPotential(d, p) {
  const o = other(p);
  const att = monsters(d, p)
    .filter((u) => d.cards[u].faceUp && d.cards[u].pos === 'atk' && !d.cards[u].attacks)
    .map((u) => atkOf(d, u))
    .sort((a, b) => b - a);
  const foes = monsters(d, o).map((u) => ({ val: d.cards[u].faceUp ? (d.cards[u].pos === 'atk' ? atkOf(d, u) : defStatOf(d, u)) : 1500, atk: d.cards[u].faceUp && d.cards[u].pos === 'atk', mv: monsterValue(d, u) }));
  let gain = 0;
  for (const a of att) {
    if (!foes.length) {
      gain += a / 100;
      continue;
    }
    foes.sort((x, y) => y.mv - x.mv);
    const idx = foes.findIndex((f) => f.val < a);
    if (idx >= 0) {
      const f = foes.splice(idx, 1)[0];
      gain += f.mv + (f.atk ? (a - f.val) / 100 : 0);
    }
  }
  return gain;
}

export function evaluate(d, p, prof) {
  const o = other(p);
  if (d.winner === p) return 1e6;
  if (d.winner === o) return -1e6;
  if (d.winner === -1) return 0;
  const me = d.players[p];
  const op = d.players[o];
  let s = 0;
  // Life points: each LP matters more as it runs out.
  const lpw = (lp) => lp / 100 + (lp < 2000 ? (2000 - lp) / -60 : 0);
  s += lpw(me.lp) - lpw(op.lp);
  for (const u of monsters(d, p)) s += monsterValue(d, u);
  for (const u of monsters(d, o)) s -= monsterValue(d, u);
  for (const u of spellTraps(d, p)) s += stValue(d, u);
  for (const u of spellTraps(d, o)) s -= stValue(d, u);
  s += me.hand.length * 3.2 - op.hand.length * 3.2;
  if (me.deck.length < 4) s -= (4 - me.deck.length) * 6;
  const t = threat(d, p);
  const lethal = t.dmg >= me.lp;
  s -= prof.threat * (t.dmg / 100 + t.lost * 0.6 + (lethal ? 60 : 0));
  // My own chances next: my attackers versus their board.
  if (d.turnPlayer === p && (d.phase === 'main1' || d.phase === 'battle') && d.turn > 1) s += attackPotential(d, p) * 0.9;
  else s += attackPotential(d, p) * 0.25;
  return s;
}

// ---------------------------------------------------------------------------
// Heuristic answers for choices inside simulations (and big real choices)
// ---------------------------------------------------------------------------

function cardScore(d, u, p) {
  const c = d.cards[u];
  if (!c) return 0;
  const def = cardById(c.id);
  if (!def) return 0;
  if (isMonster(def)) return (c.loc === 'mz' ? monsterValue(d, u) : (def.atk ?? 0) / 100 + (def.def ?? 0) / 400) * (c.ctrl === p ? 1 : 1);
  return c.faceUp ? 3 : 6;
}

const MINE_LOW = new Set(['tribute', 'tributeCost', 'pantherTribute', 'discardCost', 'discard2', 'discardLimit', 'discardChoice', 'destroyOwn2']);
const FOE_HIGH = new Set(['destroyTarget', 'destroyST', 'stealTarget', 'bounce', 'bounceUpTo2', 'chainTarget', 'bindTarget', 'changePos']);
const BEST = new Set(['search', 'recruit', 'reviveTarget', 'fusionPick', 'fusionMaterial', 'recover', 'recoverUpTo3', 'fluteDragons', 'ritualPick', 'momonga', 'germ', 'setCard', 'boostTarget', 'equipTarget', 'ritualTributes']);

export function quickChoose(d, p, pd) {
  const opts = pd.options.slice();
  const n = Math.max(pd.min, pd.title === 'momonga' || pd.title === 'germ' || pd.title === 'recoverUpTo3' || pd.title === 'fluteDragons' ? pd.max : pd.min);
  if (pd.kind === 'option') {
    if (opts.includes('yes')) return ['yes'];
    if (pd.title === 'position' || pd.title === 'statChoice') return [opts.includes('atk') ? 'atk' : opts[0]];
    if (pd.title === 'replay') {
      const targets = opts.filter((x) => x !== 'stop');
      const a = d.battle ? atkOf(d, d.battle.attacker) : 0;
      if (targets.includes('direct')) return ['direct'];
      const good = targets.filter((t) => {
        const c = d.cards[t];
        const v = c.faceUp ? (c.pos === 'atk' ? atkOf(d, t) : defStatOf(d, t)) : 1500;
        return v < a;
      });
      return [good[0] || 'stop'];
    }
    return [opts[0]];
  }
  let ranked;
  if (MINE_LOW.has(pd.title)) ranked = opts.sort((a, b) => cardScore(d, a, p) - cardScore(d, b, p));
  else if (FOE_HIGH.has(pd.title)) {
    ranked = opts.sort((a, b) => {
      const fa = d.cards[a].ctrl !== p ? 1 : -1;
      const fb = d.cards[b].ctrl !== p ? 1 : -1;
      if (fa !== fb) return fb - fa;
      return fa > 0 ? cardScore(d, b, p) - cardScore(d, a, p) : cardScore(d, a, p) - cardScore(d, b, p);
    });
  } else if (BEST.has(pd.title)) {
    ranked = opts.sort((a, b) => {
      const mine = (u) => (d.cards[u].ctrl === p || d.cards[u].owner === p ? 1 : 0);
      if (pd.title === 'boostTarget' || pd.title === 'equipTarget') {
        if (mine(a) !== mine(b)) return mine(b) - mine(a);
      }
      return cardScore(d, b, p) - cardScore(d, a, p);
    });
  } else ranked = opts;
  if (pd.title === 'ritualTributes') {
    // take the cheapest set that reaches the level
    const need = pd.data?.level ?? 0;
    const cheap = opts.slice().sort((a, b) => cardScore(d, a, p) - cardScore(d, b, p));
    const out = [];
    let sum = 0;
    for (const u of cheap) {
      if (sum >= need) break;
      out.push(u);
      sum += cardById(d.cards[u].id)?.level ?? 0;
    }
    return out.length ? out : [cheap[0]];
  }
  return ranked.slice(0, Math.max(1, Math.min(pd.max, n)));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// Play on until the position is quiet: no pending decisions for anyone and
// no chain or battle running. Choices inside are answered heuristically:
// the simulated player picks sensibly, the unknown opponent always passes.
function settle(sim, p, maxSteps = 120) {
  const turn = sim.turn;
  for (let i = 0; i < maxSteps; i++) {
    if (sim.winner !== null) return;
    const pd = sim.pending;
    if (!pd) return;
    if (pd.type === 'respond') {
      act(sim, pd.player, { type: 'pass' });
      continue;
    }
    if (pd.type === 'choose') {
      let values;
      if (pd.player === p) values = quickChoose(sim, p, pd);
      else if (pd.kind === 'option') values = [pd.options.includes('no') ? 'no' : pd.options[0]];
      else values = pd.options.slice(0, pd.min);
      const r = act(sim, pd.player, { type: 'choose', values });
      if (!r.ok) {
        // fall back to the first legal-sized answer
        const r2 = act(sim, pd.player, { type: 'choose', values: pd.options.slice(0, Math.max(1, pd.min)) });
        if (!r2.ok) return;
      }
      continue;
    }
    return;
  }
  if (sim.turn !== turn) return;
}

function trapRisk(obs, p, action, prof) {
  // Unknown face-down Spell/Traps on the other side make attacks risky.
  if (action.type !== 'attack') return 0;
  const sets = obs.players[other(p)].sz.filter((u) => u && !obs.cards[u].faceUp).length;
  if (!sets) return 0;
  const v = monsterValue(obs, action.uid);
  return prof.trapSense * sets * (0.9 + v * 0.12);
}

function simulate(obs, p, action) {
  const sim = cloneForSim(obs);
  const r = act(sim, p, action);
  if (!r.ok) return null;
  settle(sim, p);
  return sim;
}

function scoreAction(obs, p, action, prof, depth) {
  const sim = simulate(obs, p, action);
  if (!sim) return -1e9;
  let v = evaluate(sim, p, prof) - trapRisk(obs, p, action, prof);
  // Spending a card from hand to do nothing useful should not look free.
  if (action.type === 'activate') v -= prof.conserve * 0.8;
  if (action.type === 'setST') {
    const def = cardById(obs.cards[action.uid].id);
    v += isTrap(def) || def?.sub === 'Quick-Play' ? 2.5 * prof.setTraps : -4;
  }
  if (depth > 0 && sim.winner === null && !sim.pending && sim.turnPlayer === p && (sim.phase === 'main1' || sim.phase === 'main2')) {
    const next = getActions(sim, p).filter((a) => a.type !== 'surrender' && a.type !== 'phase');
    let best = v;
    for (const a of next.slice(0, 10)) {
      const s2 = scoreAction(sim, p, a, prof, depth - 1);
      if (s2 > best) best = s2;
    }
    v = v * 0.3 + best * 0.7;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Decision entry point
// ---------------------------------------------------------------------------

export function decide(d, p, prof = AI_PROFILES.normal, { seed = 0 } = {}) {
  const pd = d.pending;
  if (pd && pd.player === p && pd.type === 'choose') {
    const obs = observe(d, p);
    const small = pd.max === 1 && pd.options.length > 1 && pd.options.length <= 8;
    if (small && prof.lookahead >= 0) {
      let best = null;
      let bestV = -Infinity;
      pd.options.forEach((o, i) => {
        const sim = cloneForSim(obs);
        const r = act(sim, p, { type: 'choose', values: [o] });
        if (!r.ok) return;
        settle(sim, p);
        const v = evaluate(sim, p, prof) + (jitter(seed, i) - 0.5) * prof.noise * 10;
        if (v > bestV) {
          bestV = v;
          best = o;
        }
      });
      if (best !== null) return { type: 'choose', values: [best] };
    }
    return { type: 'choose', values: quickChoose(obs, p, obs.pending) };
  }

  const legal = getActions(d, p);
  if (!legal.length) return null;
  const obs = observe(d, p);
  let candidates = legal.filter((a) => a.type !== 'surrender');
  if (pd?.type === 'respond') {
    // Respond windows: play it out both ways.
    const passV = scoreAction(obs, p, { type: 'pass' }, prof, 0);
    let best = { type: 'pass' };
    let bestV = passV + prof.holdTraps * 2;
    candidates
      .filter((a) => a.type === 'activate')
      .forEach((a, i) => {
        const v = scoreAction(obs, p, a, prof, 0) + (jitter(seed, i) - 0.5) * prof.noise * 8;
        if (v > bestV) {
          bestV = v;
          best = a;
        }
      });
    return best;
  }

  // Open game state on our own turn.
  const phaseMoves = candidates.filter((a) => a.type === 'phase');
  const others = candidates.filter((a) => a.type !== 'phase');
  const base = evaluate(obs, p, prof);
  const scored = others.map((a, i) => ({ a, v: scoreAction(obs, p, a, prof, prof.lookahead) + (jitter(seed, i) - 0.5) * prof.noise * 10 }));
  scored.sort((x, y) => y.v - x.v);
  // Beginners sometimes play a weaker move.
  if (scored.length > 1 && jitter(seed, 99) < prof.slip) {
    const k = 1 + Math.floor(jitter(seed, 7) * Math.min(3, scored.length - 1));
    const pick = scored[k];
    if (pick.v > base - 4) return pick.a;
  }
  const top = scored[0];
  const margin = obs.phase === 'battle' ? 0.5 : 0.8;
  if (top && top.v > base + margin) return top.a;
  // Nothing improves the position: move on.
  const order = obs.phase === 'main1' ? ['battle', 'end'] : obs.phase === 'battle' ? ['main2'] : ['end'];
  for (const to of order) {
    const m = phaseMoves.find((x) => x.to === to);
    if (m) return m;
  }
  return phaseMoves[0] || top?.a || legal[0];
}

export { actionKey };
