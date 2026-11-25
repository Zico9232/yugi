// Game composition: loads the card database and art, owns the run state, and
// wires the rules engine (src/engine) to the arena, presenter and interface.
//
// Spine: input -> act(duel) -> duel.events -> presenter (animation) -> arena/UI.
// The engine decides; everything else only shows what it decided.
import cardsData from '../data/cards.json';
import rigs from '../data/creature-rigs.json';
import { setCardDb, cardById, idOf } from '../engine/cards.js';
import { createDuel, act, other } from '../engine/duel.js';
import { CLASSIC_2004 } from '../engine/rules.js';
import { PRESET_DECKS, deckIds, difficultyForRank, validateDeck } from '../engine/decks.js';
import { decide, AI_PROFILES } from '../engine/ai.js';
import { freshSeed } from '../engine/rng.js';
import { createArena } from './arena/scene.js';
import { buildCutout } from './arena/creature.js';
import { createPresenter } from './presenter.js';
import { createDuelUI } from './ui/duelui.js';
import { createScreens } from './ui/screens.js';
import { createArtLab } from './ui/artlab.js';
import { createAudio } from './audio.js';
import { defaultSave, sanitizeSave, deckFor, rollRewards, grantCards, recordDuel, CHALLENGES } from './save.js';
import { T, JOEY_LINES } from './i18n.js';

setCardDb(cardsData);

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}
async function loadAtlas(url) {
  const [img, frames] = await Promise.all([loadImage(url), fetch(url.replace(/\.webp$/, '.frames.json')).then((r) => r.json())]);
  return { url, img, w: img.naturalWidth, h: img.naturalHeight, frames: frames.frames || frames };
}

export function createGame({ mount, sdk, tweaks, assets }) {
  // Run state the SDK hands to every hook. Plain JSON.
  const state = {
    phase: 'loading', // loading | ready | error
    screen: 'loading',
    version: 0,
    duel: null,
    config: null, // { mode, challenge, joeyDeck, difficulty, playerDeck }
    match: null,
    resultsShown: false,
    aiTimer: 0,
    aiSeed: 1,
    previewing: false,
  };
  const intents = [];
  let save = defaultSave();
  let lastResults = null;

  mount.replaceChildren();
  mount.classList.add('game-root');
  mount.style.backgroundImage = `url("${assets.get('ARENA_BG')}")`;
  const arenaHost = document.createElement('div');
  arenaHost.className = 'arena-host';
  mount.append(arenaHost);

  const audio = createAudio(sdk, tweaks);
  const haptic = (pattern) => {
    try {
      if (sdk.device.haptics.isSupported()) void sdk.device.haptics.vibrate(pattern).catch(() => {});
    } catch {
      /* haptics optional */
    }
  };
  // first genuine tap unlocks sound; the tap still does its job
  const unlock = () => audio.unlock();
  mount.addEventListener('pointerdown', unlock, true);

  let arena = null;
  let presenter = null;
  let ui = null;
  let screens = null;
  let artLab = null;
  let atlases = null;
  let backUrl = '';

  const creatureIds = () =>
    Object.keys(assets.snapshot ? assets.snapshot() : {})
      .filter((k) => k.startsWith('CREATURE_'))
      .map((k) => Number(k.slice(9)))
      .filter((id) => cardById(id));
  let creatureList = [];
  const creatureAsset = (id) => artLab?.edits[id]?.maskDataUrl || (creatureList.includes(id) ? assets.get(`CREATURE_${id}`) : null);
  const creatureSet = () => new Set(creatureList.filter((id) => (artLab ? artLab.rigOf(id).approved : rigs[id]?.approved !== false)));

  // ------------------------------------------------------------------------
  // Boot: everything the first screen draws, then the home screen.
  // ------------------------------------------------------------------------
  const booting = Promise.all([
    loadImage(assets.get('CARD_BACK')),
    loadAtlas(assets.get('FX_ATLAS')),
    loadAtlas(assets.get('GAME_ICONS')),
    loadAtlas(assets.get('RIVAL_PORTRAITS')),
    loadImage(assets.get('ARENA_BG')),
    sdk.gameState.load().catch(() => null),
  ])
    .then(([back, fxA, iconsA, portraitsA, , saved]) => {
      save = sanitizeSave(saved);
      backUrl = assets.get('CARD_BACK');
      atlases = { icons: iconsA, portraits: portraitsA };
      creatureList = (() => {
        const keys = creatureIds();
        return keys.length ? keys : Object.keys(rigs).filter((k) => k !== '_doc').map(Number);
      })();
      arena = createArena(arenaHost, { cardBackImage: back, fxImage: fxA.img, fxFrames: fxA.frames, creatureAsset, tweaks });
      arena.backUrl = backUrl;
      ui = createDuelUI({ root: mount, arena, atlases, onAct: (a) => intents.push(a), onMenu: () => api.showScreen('pause'), getCreatureCanvas });
      presenter = createPresenter({ arena, ui, audio, haptic, getSpeed: () => save.settings.anim, getHurry: () => state.duel?.pending?.player === 0 });
      artLab = createArtLab({ game: api, sdk });
      screens = createScreens({ root: mount, atlases, game: api });
      audio.setSound(save.settings.sound);
      audio.setMusic(save.settings.music);
      for (const id of creatureList) arena.prefetch(id);
      state.phase = 'ready';
      ui.setVisible(false);
      api.showScreen('home');
    })
    .catch((err) => {
      console.error('[joey] boot failed', err);
      state.phase = 'error';
      mountError(String(err?.message || err));
    });

  function mountError(msg) {
    mount.querySelector('.boot-error')?.remove();
    const el = document.createElement('div');
    el.className = 'boot-error safe-area';
    el.innerHTML = `<div class="screen-center"><div class="loader-text">${T.loadFail}</div><div class="small-print" dir="ltr"></div><button class="control-btn primary"><span class="control-label">${T.retry}</span></button></div>`;
    el.querySelector('.small-print').textContent = msg;
    el.querySelector('button').onclick = () => location.reload();
    mount.append(el);
  }
  const loadingEl = document.createElement('div');
  loadingEl.className = 'boot-loading';
  loadingEl.innerHTML = `<div class="loader-ring"></div><div class="loader-text">${T.loading}</div>`;
  mount.append(loadingEl);

  // Creature preview image for card details (the cutout, original pixels).
  const cutoutUrls = new Map();
  function getCreatureCanvas(id) {
    if (cutoutUrls.has(id)) return cutoutUrls.get(id);
    const mask = creatureAsset(id);
    if (!mask) return null;
    cutoutUrls.set(id, null);
    buildCutout(id, `${import.meta.env.BASE_URL}cards/art/${id}.jpg`, mask)
      .then((c) => cutoutUrls.set(id, c.canvas.toDataURL('image/webp', 0.85)))
      .catch(() => {});
    return null;
  }

  // ------------------------------------------------------------------------
  // Duels
  // ------------------------------------------------------------------------
  function joeySetup(config) {
    if (config.mode === 'challenge') {
      const c = CHALLENGES.find((x) => x.id === config.challenge);
      return { joeyDeck: c.joeyDeck, difficulty: c.ai };
    }
    const d = difficultyForRank(save.rank);
    return { joeyDeck: d.deck, difficulty: d.id };
  }

  function startDuel(config) {
    const setup = { ...config, ...joeySetup(config) };
    if (setup.mode === 'match' && !state.match) state.match = { wins: [0, 0], game: 1 };
    if (setup.mode !== 'match') state.match = null;
    let playerDeckKey = save.activeDeck;
    let playerDeck = deckFor(save, playerDeckKey);
    if (!validateDeck(playerDeck, { creatures: creatureSet(), forbiddenOn: save.settings.forbidden }).ok) {
      playerDeckKey = 'starter';
      playerDeck = deckIds(PRESET_DECKS.starter);
    }
    setup.playerDeck = playerDeckKey;
    state.config = setup;
    const seed = freshSeed();
    const first = (seed >>> 3) & 1; // the opening coin toss
    const lp = [CLASSIC_2004.startingLp, CLASSIC_2004.startingLp];
    if (setup.mode === 'challenge' && CHALLENGES.find((c) => c.id === setup.challenge)?.rule === 'lp2000') lp[0] = 2000;
    const d = createDuel({ decks: [playerDeck, deckIds(PRESET_DECKS[setup.joeyDeck])], seed, firstPlayer: first, lp, names: [T.you, T.joey] });
    state.duel = d;
    state.resultsShown = false;
    state.aiTimer = 0;
    state.version++;
    intents.length = 0;
    presenter.clear();
    arena.fx.clear();
    arena.applySnap({ zones: {}, lp, hand: [[], 0], deck: [40, 40], gy: [null, null], gyIds: [null, null], gyCount: [0, 0], extra: [0, 0], turn: 0, turnPlayer: 0, phase: 'draw' }, { instant: true });
    ui.reset();
    ui.setLpInstant(lp);
    ui.setVisible(true);
    for (const u of Object.keys(d.cards)) arena.prefetch(d.cards[u].id);
    drain();
    screens.show(null);
    state.screen = null;
    ui.joeySays('start');
  }

  function drain() {
    const d = state.duel;
    if (!d || !d.events.length) return;
    presenter.push(d.events.splice(0));
  }

  function surrender() {
    if (!state.duel || state.duel.winner !== null) return;
    act(state.duel, 0, { type: 'surrender' });
    drain();
    state.version++;
    api.showScreen(null);
  }

  function finishDuel() {
    const d = state.duel;
    state.resultsShown = true;
    const won = d.winner === 0;
    const drawn = d.winner === -1;
    const cfg = state.config;
    ui.joeySays(won ? 'lose' : 'win');
    // the card that finished it: last face-up monster/spell we saw act
    const finisher = [...d.log].reverse().find((l) => (l.key === 'summon' || l.key === 'activate') && l.p === d.winner)?.id || null;
    let result = { won, drawn, reason: d.winReason, rewards: [], fresh: [], rank: { before: save.rank, after: save.rank } };
    let recordNow = true;
    if (cfg.mode === 'match') {
      if (!drawn) state.match.wins[won ? 0 : 1]++;
      const [a, b] = state.match.wins;
      const over = a >= 2 || b >= 2;
      result.matchLine = `${a} - ${b}`;
      if (!over) {
        recordNow = false;
        result.matchContinues = true;
      } else {
        result.won = a > b;
      }
    }
    if (recordNow) {
      let challengeDone = null;
      if (cfg.mode === 'challenge' && won) {
        const c = CHALLENGES.find((x) => x.id === cfg.challenge);
        const ok = c.rule === 'noSpells' ? d.players[0].stats.spells === 0 : c.rule === 'turns8' ? d.turn <= 8 : true;
        if (ok) {
          challengeDone = c.id;
          if (!save.challenges[c.id]) {
            save.challenges[c.id] = true;
            result.rewards = [idOf(c.reward)];
          }
        }
      }
      const rec = recordDuel(save, { won: result.won, drawn, turns: d.turn, deck: cfg.playerDeck, finisher, joeyDeck: cfg.joeyDeck, difficulty: cfg.difficulty, challenge: cfg.mode === 'challenge' ? cfg.challenge : null });
      result.rank = { before: rec.before, after: rec.after };
      result.unlocked = rec.newly;
      result.challengeDone = challengeDone;
      if (cfg.mode !== 'challenge' && result.won) {
        const n = cfg.mode === 'match' ? 3 : 1;
        result.rewards = rollRewards(save, n, creatureSet(), Math.random);
      }
      result.fresh = grantCards(save, result.rewards);
      persist();
      if (cfg.mode === 'match') state.match = null;
    }
    lastResults = result;
    haptic(won ? [20, 40, 20, 40, 60] : [60, 50, 60]);
    api.showScreen('results', result);
  }

  function rerollRewards() {
    if (!lastResults || lastResults.rerolled) return;
    // only when every card won was a duplicate: undo and draw again, once
    for (const id of lastResults.rewards) if (save.collection[id] > 1) save.collection[id]--;
    lastResults.rewards = rollRewards(save, lastResults.rewards.length, creatureSet(), Math.random);
    lastResults.fresh = grantCards(save, lastResults.rewards);
    lastResults.rerolled = true;
    persist();
    api.showScreen('results', lastResults);
  }

  // Results view rebuilt from the most recent duel in history (for revisits).
  function lastHistoryResult() {
    const m = save.history[0];
    return { won: !!m?.won, drawn: !!m?.drawn, reason: m ? (m.won ? 'lp' : 'lp') : '', rewards: [], fresh: [], rank: { before: save.rank, after: save.rank } };
  }

  function persist() {
    void sdk.gameState.save(save).catch(() => {});
  }

  // ------------------------------------------------------------------------
  // Log text (Arabic) for the duel log screen.
  // ------------------------------------------------------------------------
  function logText(l) {
    const who = l.p === 0 ? T.you : T.joey;
    const nm = (id) => cardById(id)?.name || '?';
    switch (l.key) {
      case 'turn':
        return `— ${T.phases.draw}: ${l.p === 0 ? T.yourTurn : T.joeyTurn} (${l.turn})`;
      case 'summon':
        return `${who} استدعى ${nm(l.id)}`;
      case 'setMonster':
        return `${who} وضع وحشًا مقلوبًا`;
      case 'setST':
        return `${who} وضع بطاقة`;
      case 'activate':
        return `${who} فعّل ${nm(l.id)}`;
      case 'flip':
        return `قُلب ${nm(l.id)}`;
      case 'attack':
        return `${who} هاجم بـ ${nm(l.id)}${l.target === null ? ' مباشرة' : ''}`;
      case 'destroy':
        return `دُمّر ${nm(l.id)}`;
      case 'damage':
        return `${l.p === 0 ? T.you : T.joey} −${l.amount}`;
      case 'heal':
        return `${l.p === 0 ? T.you : T.joey} +${l.amount}`;
      case 'coin':
        return `عملة: ${l.result === 'heads' ? T.heads : T.tails}`;
      case 'die':
        return `نرد: ${l.result}`;
      case 'control':
        return `${who} يسيطر على ${nm(l.id)}`;
      case 'win':
        return l.p === 0 ? T.win : T.lose;
      default:
        return l.key;
    }
  }

  // ------------------------------------------------------------------------
  // The API other modules call (and the Creator Tools will).
  // ------------------------------------------------------------------------
  const api = {
    state,
    get save() {
      return save;
    },
    get backUrl() {
      return backUrl;
    },
    get artLab() {
      return artLab;
    },
    idOf,
    showScreen(id, data) {
      if (state.phase !== 'ready') return;
      loadingEl.remove();
      if (id === 'results' && !data) data = lastResults || lastHistoryResult();
      state.screen = id;
      screens.show(id, data);
      const inDuel = !!state.duel && state.duel.winner === null;
      ui.setVisible(inDuel && (id === null || ['pause', 'log', 'surrender'].includes(id)));
      if (id === null && !state.duel) {
        state.screen = 'home';
        screens.show('home');
      }
    },
    getScreen: () => state.screen,
    startDuel: (cfg) => startDuel(cfg),
    rematch: () => startDuel({ mode: state.config?.mode === 'challenge' ? 'challenge' : 'single', challenge: state.config?.challenge }),
    nextMatchDuel: () => {
      state.match.game++;
      startDuel({ mode: 'match' });
    },
    goHome: () => {
      state.duel = null;
      state.match = null;
      presenter.clear();
      arena.fx.clear();
      arena.applySnap({ zones: {}, lp: [8000, 8000], hand: [[], 0], deck: [0, 0], gy: [null, null], gyIds: [null, null], gyCount: [0, 0], extra: [0, 0] }, { instant: true });
      ui.setVisible(false);
      api.showScreen('home');
    },
    surrender,
    rerollRewards,
    persist,
    setActiveDeck(k) {
      save.activeDeck = k;
      persist();
      api.showScreen('deck');
    },
    setSetting(k, v) {
      save.settings[k] = v;
      if (k === 'sound') audio.setSound(v);
      if (k === 'music') audio.setMusic(v);
      persist();
    },
    openCard: (id) => ui.openDetail(null, id),
    creatureSet,
    creatureIds: () => creatureList.slice().sort((a, b) => cardById(a).name.localeCompare(cardById(b).name)),
    creatureAsset,
    cutoutScore: (id) => {
      const m = creatureAsset(id);
      return m ? buildCutout(id, `${import.meta.env.BASE_URL}cards/art/${id}.jpg`, m).then((c) => c.alignment).catch(() => null) : Promise.resolve(null);
    },
    applyCreatureEdit(id, e) {
      const r = (rigs[id] = { ...(rigs[id] || {}) });
      for (const k of ['profile', 'floats', 'height', 'approved', 'anchors']) if (e[k] !== undefined) r[k] = e[k];
      arena.invalidate(id);
      cutoutUrls.delete(id);
      arena.prefetch(id);
    },
    previewCreature(id, e) {
      if (e) api.applyCreatureEdit(id, e);
      arena.invalidate(id);
      arena.cutoutFor(id).then((c) => {
        if (!c) return;
        arena.ready.set(id, c);
        state.previewing = true;
        screens.show(null);
        state.screen = 'artlab-preview';
        presenter.preview(id);
      });
    },
    logLines: () => (state.duel ? state.duel.log.slice().reverse().map((l) => ({ turn: l.turn, p: l.p ?? -1, text: logText(l) })) : []),
    get JOEY_LINES() {
      return JOEY_LINES;
    },
  };

  // ------------------------------------------------------------------------
  // Hooks for the SDK loop
  // ------------------------------------------------------------------------
  const hooks = {
    init() {
      // Restart rebuilds the run from scratch: no duel, back at the street corner.
      if (state.phase !== 'ready') return;
      lastResults = null;
      api.goHome();
    },
    update(s, dt) {
      if (state.phase !== 'ready') return;
      arena.update(dt);
      presenter.update(dt);
      ui.update(dt);
      audio.scheduleMusic();
      if (state.previewing && presenter.idle()) {
        state.previewing = false;
        api.showScreen('artlab');
      }
      const d = state.duel;
      if (!d || !presenter.idle()) return;
      if (state.screen && !['pause', 'log', 'surrender'].includes(state.screen) && d.winner === null) return;
      if (d.winner !== null) {
        if (!state.resultsShown && !state.screen) finishDuel();
        return;
      }
      if (state.screen) return; // paused
      const who = d.pending ? d.pending.player : d.turnPlayer;
      if (who === 1) {
        intents.length = 0;
        state.aiTimer += dt;
        const think = tweaks.get('aiThinkTime') * (d.pending?.type === 'respond' ? 0.6 : 1);
        if (state.aiTimer >= think) {
          state.aiTimer = 0;
          const prof = AI_PROFILES[state.config.difficulty] || AI_PROFILES.normal;
          const a = decide(d, 1, prof, { seed: state.aiSeed++ });
          if (a) {
            const r = act(d, 1, a);
            if (!r.ok) console.error('[joey] AI produced an illegal action', a, r.reason);
          }
          drain();
          state.version++;
        }
        return;
      }
      state.aiTimer = 0;
      while (intents.length) {
        const a = intents.shift();
        const r = act(d, 0, a);
        if (!r.ok) ui.toast(r.reason);
        else {
          if (a.type === 'activate' || a.type === 'summon') haptic(12);
        }
        drain();
        state.version++;
      }
    },
    render() {
      if (state.phase !== 'ready') return;
      const d = state.duel;
      ui.render({ duel: d || { cards: {}, players: [{ gy: [], extra: [] }, { gy: [], extra: [] }], chain: [], pending: null }, canAct: !!d && d.winner === null && presenter.idle() && !state.screen && (d.pending ? d.pending.player === 0 : d.turnPlayer === 0), version: state.version * 10 + (presenter.idle() ? 1 : 0), rank: save.rank });
      arena.render();
    },
  };

  return {
    state,
    hooks,
    api,
    booting,
    destroy() {
      mount.removeEventListener('pointerdown', unlock, true);
      audio.destroy();
      arena?.destroy();
      mount.replaceChildren();
    },
    sdk,
    tweaks,
    assets,
  };
}

export { other };
