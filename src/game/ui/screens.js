// Screens outside the duel itself: home, results, decks, card list, stats,
// settings, pause, challenges and the Art Lab. Each is one overlay; the game
// switches between them with showScreen(id).
import { h, icon, atlasCell, cardImg, fill } from './dom.js';
import { T } from '../i18n.js';
import { allCards, cardById, isMonster } from '../../engine/cards.js';
import { PRESET_DECKS, deckIds, validateDeck, playable, copyLimit, difficultyForRank } from '../../engine/decks.js';
import { supportStatus } from '../../engine/effects.js';
import { CHALLENGES, CHALLENGE_TEXT } from '../save.js';

export function createScreens({ root, atlases, game }) {
  const layer = h('div', { class: 'screen-layer safe-area', hidden: true });
  root.append(layer);
  let current = null;

  const btn = (label, onclick, cls = '') => h('button', { class: `control-btn ${cls}`, onclick }, h('span', { class: 'control-label' }, label));
  const back = (to = 'home') => h('button', { class: 'icon-btn back', 'aria-label': 'back', onclick: () => game.showScreen(to) }, icon('back'));
  const stars = (n, max = 9) => h('span', { class: 'pip-row rank-row' }, ...Array.from({ length: max }, (_, i) => atlasCell(atlases.icons, 'star', `pip star-pip ${i < n ? 'on' : 'off'}`)));

  function show(id, data) {
    current = id;
    layer.hidden = !id;
    layer.className = `screen-layer safe-area screen-${id || 'none'}`;
    if (!id) {
      fill(layer, );
      return;
    }
    const build = BUILD[id];
    fill(layer, build ? build(data) : h('div'));
  }

  const BUILD = {
    loading: () => h('div', { class: 'screen-center' }, h('div', { class: 'loader-ring' }), h('div', { class: 'loader-text' }, T.loading)),
    loadError: (msg) => h('div', { class: 'screen-center' }, h('div', { class: 'loader-text' }, T.loadFail), h('div', { class: 'small-print', dir: 'ltr' }, msg || ''), btn(T.retry, () => location.reload(), 'primary')),

    home: () => {
      const s = game.save;
      const diff = difficultyForRank(s.rank);
      return h(
        'div',
        { class: 'home' },
        h('div', { class: 'home-hero' }, atlasCell(atlases.portraits, 'confident', 'home-portrait'), h('div', { class: 'home-title' }, h('div', { class: 'logo' }, 'JOEY'), h('div', { class: 'logo-sub' }, 'THE PASSION · REIMAGINED'))),
        h('div', { class: 'home-rank' }, h('span', { class: 'rank-label' }, T.rank), stars(s.rank), h('span', { class: 'diff-chip' }, `${T.difficulty[diff.id]} · ${T.joeyDecks[diff.deck]}`)),
        h('div', { class: 'home-menu' }, btn(T.menu.single, () => game.startDuel({ mode: 'single' }), 'primary big'), btn(T.menu.match, () => game.startDuel({ mode: 'match' }), 'big'), btn(T.menu.challenges, () => game.showScreen('challenges')), btn(`${T.menu.deck} · ${T.deckNames[s.activeDeck] || ''}`, () => game.showScreen('deck')), btn(T.menu.cards, () => game.showScreen('cards')), btn(T.menu.stats, () => game.showScreen('stats')), btn(T.menu.settings, () => game.showScreen('settings'))),
        h('button', { class: 'link-btn', onclick: () => game.showScreen('artlab') }, T.menu.artlab)
      );
    },

    challenges: () => {
      const s = game.save;
      return h(
        'div',
        { class: 'panel-screen' },
        h('div', { class: 'screen-head' }, back(), h('h2', {}, T.menu.challenges)),
        h(
          'div',
          { class: 'list' },
          ...CHALLENGES.map((c) => {
            const locked = s.rank < c.rank && !s.challenges[c.id];
            const done = !!s.challenges[c.id];
            const reward = cardById(game.idOf(c.reward));
            return h(
              'div',
              { class: `challenge ${locked ? 'locked' : ''} ${done ? 'done' : ''}` },
              h('img', { src: cardImg(reward.id), alt: reward.name, class: 'challenge-card' }),
              h('div', { class: 'challenge-body' }, h('div', { class: 'challenge-title' }, CHALLENGE_TEXT[c.id].title), h('div', { class: 'challenge-text' }, CHALLENGE_TEXT[c.id].body), h('div', { class: 'challenge-meta' }, locked ? h('span', { class: 'chip lock' }, atlasCell(atlases.icons, 'lock', 'chip-icon'), `★${c.rank}`) : done ? h('span', { class: 'chip done' }, T.challengeDone) : h('span', { class: 'chip' }, T.difficulty[c.ai]))),
              locked ? null : btn('ابدأ', () => game.startDuel({ mode: 'challenge', challenge: c.id }), 'primary')
            );
          })
        )
      );
    },

    results: (r) => {
      const won = r.won;
      const title = r.drawn ? T.draw : won ? T.win : T.lose;
      const rewards = r.rewards || [];
      const rankLine = r.rank.after > r.rank.before ? T.rankUp : r.rank.after < r.rank.before ? T.rankDown : '';
      const cards = h('div', { class: 'reward-row' }, ...rewards.map((id, i) => h('div', { class: `reward ${r.fresh?.includes(id) ? 'new' : ''}`, style: `--d:${i * 0.25}s` }, h('div', { class: 'reward-inner' }, h('img', { class: 'reward-back', src: game.backUrl, alt: '' }), h('img', { class: 'reward-face', src: cardImg(id), alt: cardById(id)?.name, onclick: () => game.openCard(id) })))));
      const allDupes = rewards.length && !r.fresh?.length;
      return h(
        'div',
        { class: `results ${won ? 'won' : 'lost'}` },
        atlasCell(atlases.portraits, won ? 'defeated' : 'fired_up', 'results-portrait'),
        h('div', { class: 'results-title' }, title),
        h('div', { class: 'results-reason' }, T.reasons[r.reason] || ''),
        r.matchLine ? h('div', { class: 'results-match' }, r.matchLine) : null,
        h('div', { class: 'results-rank' }, stars(r.rank.after), rankLine ? h('span', { class: 'rank-change' }, rankLine) : null),
        r.unlocked?.length ? h('div', { class: 'unlock-line' }, `فُتحت مجموعة جديدة: ${r.unlocked.map((k) => T.deckNames[k]).join('، ')}`) : null,
        r.challengeDone ? h('div', { class: 'unlock-line' }, `تحدٍ منجز: ${CHALLENGE_TEXT[r.challengeDone].title}`) : null,
        rewards.length ? h('div', { class: 'reward-title' }, T.newCards) : null,
        cards,
        allDupes && !r.rerolled ? btn(T.reroll, () => game.rerollRewards(), 'small') : null,
        h('div', { class: 'controls-row' }, r.matchContinues ? btn(T.next, () => game.nextMatchDuel(), 'primary') : btn(T.rematch, () => game.rematch(), 'primary'), btn(T.home, () => game.goHome()))
      );
    },

    pause: () =>
      h(
        'div',
        { class: 'pause' },
        h('div', { class: 'pause-panel' }, h('h2', {}, 'إيقاف مؤقت'), animRow(), h('div', { class: 'controls-row' }, toggleBtn(T.settings.sound, game.save.settings.sound, (v) => game.setSetting('sound', v)), toggleBtn(T.settings.music, game.save.settings.music, (v) => game.setSetting('music', v))), h('div', { class: 'controls-row' }, btn(T.settings.log, () => game.showScreen('log')), btn(T.settings.surrender, () => game.showScreen('surrender'), 'danger')), btn(T.settings.resume, () => game.showScreen(null), 'primary big'))
      ),
    surrender: () => h('div', { class: 'pause' }, h('div', { class: 'pause-panel' }, h('h2', {}, T.surrenderConfirm), h('div', { class: 'controls-row' }, btn(T.cancel, () => game.showScreen('pause')), btn(T.settings.surrender, () => game.surrender(), 'danger')))),
    log: () => h('div', { class: 'pause' }, h('div', { class: 'pause-panel log-panel' }, h('div', { class: 'screen-head' }, back('pause'), h('h2', {}, T.settings.log)), h('div', { class: 'log-list' }, ...game.logLines().map((l) => h('div', { class: `log-line p${l.p}` }, h('span', { class: 'log-turn' }, l.turn), h('span', { dir: 'auto' }, l.text)))))),

    settings: () => h('div', { class: 'panel-screen' }, h('div', { class: 'screen-head' }, back(), h('h2', {}, T.menu.settings)), h('div', { class: 'settings' }, animRow(), h('div', { class: 'controls-row' }, toggleBtn(T.settings.sound, game.save.settings.sound, (v) => game.setSetting('sound', v)), toggleBtn(T.settings.music, game.save.settings.music, (v) => game.setSetting('music', v))), h('div', { class: 'setting-label' }, T.settings.forbidden), h('div', { class: 'controls-row' }, toggleBtn('قائمة الحظر', game.save.settings.forbidden, (v) => game.setSetting('forbidden', v))), h('div', { class: 'small-print' }, 'عند الإيقاف تُعامل البطاقات المحظورة كمحدودة (نسخة واحدة)، كما في اللعبة الأصلية.'))),

    stats: () => {
      const s = game.save;
      const total = s.wins + s.losses;
      return h(
        'div',
        { class: 'panel-screen' },
        h('div', { class: 'screen-head' }, back(), h('h2', {}, T.menu.stats)),
        h('div', { class: 'stat-grid' }, statBox(T.wins, s.wins), statBox(T.losses, s.losses), statBox('%', total ? Math.round((s.wins / total) * 100) : 0), statBox(T.cardsCollected, `${Object.keys(s.collection).length}`)),
        h('div', { class: 'diff-table' }, ...Object.keys(T.difficulty).map((k) => h('div', { class: 'diff-row' }, h('span', {}, T.difficulty[k]), h('span', { class: 'w' }, s.perDiff[k]?.w || 0), h('span', { class: 'l' }, s.perDiff[k]?.l || 0)))),
        h('h3', {}, T.history),
        h('div', { class: 'list' }, ...(s.history.length ? s.history.map((m) => h('div', { class: `hist ${m.won ? 'w' : m.drawn ? 'd' : 'l'}` }, m.finisher ? h('img', { src: cardImg(m.finisher), alt: '' }) : h('span', { class: 'hist-blank' }), h('div', { class: 'hist-body' }, h('div', {}, `${m.won ? T.win : m.drawn ? T.draw : T.lose} · ${T.difficulty[m.difficulty] || ''}`), h('div', { class: 'small-print' }, `${T.deckNames[m.deck] || m.deck} · ${m.turns} ${T.turns}`)))) : [h('div', { class: 'small-print' }, T.logEmpty)]))
      );
    },

    deck: () => {
      const s = game.save;
      const options = ['starter', 'dragonSpark', 'ironKnights', 'custom'];
      return h(
        'div',
        { class: 'panel-screen' },
        h('div', { class: 'screen-head' }, back(), h('h2', {}, T.menu.deck)),
        h(
          'div',
          { class: 'deck-picks' },
          ...options.map((k) => {
            const unlocked = k === 'custom' || s.unlocked.includes(k);
            const ids = k === 'custom' ? s.custom : deckIds(PRESET_DECKS[k]);
            const v = validateDeck(ids, { creatures: game.creatureSet(), forbiddenOn: s.settings.forbidden });
            const coverName = { starter: 'Buster Blader', dragonSpark: 'Thousand Dragon', ironKnights: 'Flame Swordsman', custom: null }[k];
            const cover = coverName ? game.idOf(coverName) : ids.main[0];
            return h('div', { class: `deck-pick ${s.activeDeck === k ? 'on' : ''} ${unlocked ? '' : 'locked'}` }, h('img', { src: cardImg(cover), alt: '' }), h('div', { class: 'deck-pick-body' }, h('div', { class: 'deck-name' }, T.deckNames[k]), h('div', { class: 'small-print' }, unlocked ? `${ids.main.length} + ${ids.extra.length} · ${v.ok ? T.deckValid : T.deckInvalid}` : `★${PRESET_DECKS[k].unlockRank}`), k !== 'custom' && unlocked ? h('div', { class: 'small-print identity', dir: 'ltr' }, PRESET_DECKS[k].identity) : null), unlocked ? h('div', { class: 'deck-pick-actions' }, v.ok ? btn(T.use, () => game.setActiveDeck(k), s.activeDeck === k ? 'primary' : '') : null, k === 'custom' ? btn('تعديل', () => game.showScreen('builder')) : null) : atlasCell(atlases.icons, 'lock', 'lock-icon'));
          })
        )
      );
    },

    builder: () => {
      const s = game.save;
      const draft = { main: s.custom.main.slice(), extra: s.custom.extra.slice() };
      const creatures = game.creatureSet();
      const owned = Object.entries(s.collection)
        .map(([id, n]) => ({ c: cardById(Number(id)), n }))
        .filter((x) => x.c && playable(x.c, creatures))
        .sort((a, b) => a.c.kind.localeCompare(b.c.kind) || (b.c.atk ?? 0) - (a.c.atk ?? 0) || a.c.name.localeCompare(b.c.name));
      const status = h('div', { class: 'builder-status' });
      const grid = h('div', { class: 'builder-grid' });
      const count = (id) => draft.main.filter((x) => x === id).length + draft.extra.filter((x) => x === id).length;
      const refresh = () => {
        const v = validateDeck(draft, { creatures, forbiddenOn: s.settings.forbidden });
        fill(status, h('span', { class: 'chip' }, `${draft.main.length} / 40–60`), h('span', { class: 'chip' }, `${T.deckNames.custom}: ${draft.extra.length}`), h('span', { class: `chip ${v.ok ? 'done' : 'bad'}` }, v.ok ? T.deckValid : T.deckInvalid));
        for (const el of grid.children) {
          const id = Number(el.dataset.id);
          el.querySelector('.count').textContent = `${count(id)}/${Math.min(el.dataset.own, copyLimit(cardById(id), s.settings.forbidden))}`;
          el.classList.toggle('in', count(id) > 0);
        }
        saveBtn.disabled = !v.ok;
      };
      for (const { c, n } of owned) {
        const max = Math.min(n, copyLimit(c, s.settings.forbidden));
        const card = h('div', { class: 'builder-card', 'data-id': c.id, 'data-own': n }, h('img', { src: cardImg(c.id), alt: c.name, loading: 'lazy', onclick: () => game.openCard(c.id) }), h('div', { class: 'builder-ctl' }, h('button', { class: 'mini-btn', 'aria-label': '-', onclick: () => {
          const list = c.frame === 'fusion' ? draft.extra : draft.main;
          const i = list.indexOf(c.id);
          if (i >= 0) list.splice(i, 1);
          refresh();
        } }, '−'), h('span', { class: 'count' }), h('button', { class: 'mini-btn', 'aria-label': '+', onclick: () => {
          if (count(c.id) >= max) return;
          (c.frame === 'fusion' ? draft.extra : draft.main).push(c.id);
          refresh();
        } }, '+')));
        grid.append(card);
      }
      const saveBtn = btn(T.save, () => {
        s.custom = draft;
        game.persist();
        game.showScreen('deck');
      }, 'primary');
      const view = h('div', { class: 'panel-screen builder' }, h('div', { class: 'screen-head' }, back('deck'), h('h2', {}, T.deckNames.custom), saveBtn), status, grid);
      refresh();
      return view;
    },

    cards: (filter = 'all') => {
      const s = game.save;
      const creatures = game.creatureSet();
      const list = allCards().filter((c) => !c.token);
      const shown = list.filter((c) => (filter === 'owned' ? s.collection[c.id] : filter === 'playable' ? playable(c, creatures) : filter === 'locked' ? !playable(c, creatures) : true));
      const owned = list.filter((c) => s.collection[c.id]).length;
      return h(
        'div',
        { class: 'panel-screen' },
        h('div', { class: 'screen-head' }, back(), h('h2', {}, T.menu.cards), h('span', { class: 'chip' }, `${owned} / ${list.length}`)),
        h('div', { class: 'controls-row tabs' }, ...['all', 'owned', 'playable', 'locked'].map((f) => btn(T.filters[f], () => show('cards', f), f === filter ? 'primary' : ''))),
        h(
          'div',
          { class: 'card-grid' },
          ...shown.map((c) => {
            const st = supportStatus(c);
            const ok = playable(c, creatures);
            return h('button', { class: `grid-card ${s.collection[c.id] ? 'owned' : ''} ${ok ? '' : 'locked'}`, onclick: () => game.openCard(c.id) }, h('img', { src: cardImg(c.id), alt: c.name, loading: 'lazy' }), s.collection[c.id] ? h('span', { class: 'own-count' }, `×${s.collection[c.id]}`) : null, !ok ? h('span', { class: `status-dot ${st === 'unsupported' ? 'unsup' : 'art'}` }) : null);
          })
        )
      );
    },

    artlab: () => game.artLab.build(),
  };

  function animRow() {
    const cur = game.save.settings.anim;
    return h('div', {}, h('div', { class: 'setting-label' }, T.settings.anim), h('div', { class: 'controls-row seg' }, ...['normal', 'fast', 'skip'].map((k) => btn(T.settings[k], () => {
      game.setSetting('anim', k);
      show(current);
    }, k === cur ? 'primary' : ''))));
  }
  function toggleBtn(label, on, set) {
    const b = btn(`${label}: ${on ? T.settings.on : T.settings.off}`, () => {
      const v = !b.classList.contains('primary');
      set(v);
      b.classList.toggle('primary', v);
      b.firstChild.textContent = `${label}: ${v ? T.settings.on : T.settings.off}`;
    }, on ? 'primary' : '');
    return b;
  }
  function statBox(label, value) {
    return h('div', { class: 'stat-box' }, h('div', { class: 'stat-val' }, value), h('div', { class: 'stat-label' }, label));
  }
  void isMonster;

  return { show, current: () => current, layer };
}
