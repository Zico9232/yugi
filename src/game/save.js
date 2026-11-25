// Progression and save data (Playabl gameState). Small, versioned, plain JSON.
import { PRESET_DECKS, deckIds, difficultyForRank, playable, copyLimit } from '../engine/decks.js';
import { allCards, cardById } from '../engine/cards.js';

export const SAVE_VERSION = 1;

export const CHALLENGES = [
  { id: 'noSpells', rank: 2, joeyDeck: 'joeyDice', ai: 'easy', reward: 'Graceful Charity', rule: 'noSpells' },
  { id: 'speedRun', rank: 4, joeyDeck: 'joeyFlame', ai: 'normal', reward: 'Swords of Revealing Light', rule: 'turns8' },
  { id: 'lastStand', rank: 5, joeyDeck: 'joeyRedEyes', ai: 'hard', reward: 'Mirror Force', rule: 'lp2000' },
  { id: 'ironWall', rank: 7, joeyDeck: 'joeyIron', ai: 'expert', reward: 'Jinzo', rule: 'win' },
];
export const CHALLENGE_TEXT = {
  noSpells: { title: 'بلا سحر', body: 'اهزم جوي دون تفعيل أي بطاقة سحر.' },
  speedRun: { title: 'شارع سريع', body: 'اهزم سيّاف اللهب خلال ٨ أدوار أو أقل.' },
  lastStand: { title: 'آخر ألفين', body: 'تبدأ بـ ٢٠٠٠ نقطة أمام اندفاع العيون الحمراء.' },
  ironWall: { title: 'الجدار الحديدي', body: 'اهزم مجموعة الفولاذ ومعها Jinzo.' },
};

export function defaultSave() {
  const starter = deckIds(PRESET_DECKS.starter);
  const collection = {};
  for (const id of [...starter.main, ...starter.extra]) collection[id] = (collection[id] || 0) + 1;
  return {
    version: SAVE_VERSION,
    rank: 1,
    wins: 0,
    losses: 0,
    lossStreak: 0,
    collection,
    custom: { main: starter.main.slice(), extra: starter.extra.slice() },
    activeDeck: 'starter',
    unlocked: ['starter'],
    history: [],
    perDiff: {},
    challenges: {},
    settings: { anim: 'normal', sound: true, music: true, forbidden: false },
  };
}

export function sanitizeSave(raw) {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object' || raw.version !== SAVE_VERSION) return base;
  const s = { ...base, ...raw };
  s.rank = Math.min(9, Math.max(1, Number(s.rank) || 1));
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  if (!['normal', 'fast', 'skip'].includes(s.settings.anim)) s.settings.anim = 'normal';
  s.collection = typeof raw.collection === 'object' && raw.collection ? raw.collection : base.collection;
  s.history = Array.isArray(raw.history) ? raw.history.slice(0, 10) : [];
  s.unlocked = Array.isArray(raw.unlocked) ? raw.unlocked : base.unlocked;
  if (!raw.custom?.main?.length) s.custom = base.custom;
  return s;
}

export function deckFor(save, key) {
  if (key === 'custom') return { main: save.custom.main.slice(), extra: save.custom.extra.slice() };
  return deckIds(PRESET_DECKS[key] || PRESET_DECKS.starter);
}

// Rewards come only from cards that are fully playable (data, image, effect,
// creature) — never placeholders.
export function rewardPool(creatures) {
  return allCards().filter((c) => playable(c, creatures));
}

export function rollRewards(save, n, creatures, rand) {
  const pool = rewardPool(creatures);
  const weighted = [];
  for (const c of pool) {
    const w = c.games.includes('J') ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(c.id);
  }
  const out = [];
  for (let i = 0; i < n && weighted.length; i++) out.push(weighted[Math.floor(rand() * weighted.length)]);
  return out;
}

export function grantCards(save, ids) {
  const fresh = [];
  for (const id of ids) {
    const have = save.collection[id] || 0;
    const cap = Math.max(1, copyLimit(cardById(id), false));
    if (have < cap) {
      save.collection[id] = have + 1;
      if (have === 0) fresh.push(id);
    }
  }
  return fresh;
}

// Win/loss bookkeeping. Wins raise Joey's rank; two losses in a row lower it.
export function recordDuel(save, { won, drawn = false, turns, deck, finisher, joeyDeck, difficulty, challenge = null }) {
  const before = save.rank;
  if (won) {
    save.wins++;
    save.lossStreak = 0;
    if (!challenge) save.rank = Math.min(9, save.rank + 1);
  } else if (!drawn) {
    save.losses++;
    save.lossStreak++;
    if (!challenge && save.lossStreak >= 2) {
      save.rank = Math.max(1, save.rank - 1);
      save.lossStreak = 0;
    }
  }
  const pd = (save.perDiff[difficulty] = save.perDiff[difficulty] || { w: 0, l: 0 });
  if (won) pd.w++;
  else if (!drawn) pd.l++;
  save.history.unshift({ won, drawn, turns, deck, finisher, joeyDeck, difficulty, rank: before, challenge });
  save.history = save.history.slice(0, 10);
  const newly = [];
  for (const [k, d] of Object.entries(PRESET_DECKS)) {
    if (d.owner === 'player' && d.unlockRank && save.rank >= d.unlockRank && !save.unlocked.includes(k)) {
      save.unlocked.push(k);
      newly.push(k);
    }
  }
  return { before, after: save.rank, newly, difficulty: difficultyForRank(save.rank).id };
}
