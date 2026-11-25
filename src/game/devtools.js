// The game's Creator Tools vocabulary: what exists (catalog), what is on
// screen (describeScene), and the screens the editor can open. The SDK talks
// to the editor; this file only describes the game.
// levels are fixed: duels are built from decks and rank, not authored maps.

const SCREENS = [
  ['home', 'Home'],
  ['challenges', 'Challenges'],
  ['results', 'Results'],
  ['pause', 'Pause'],
  ['deck', 'Decks'],
  ['builder', 'Deck builder'],
  ['cards', 'Card list'],
  ['stats', 'Statistics'],
  ['settings', 'Settings'],
  ['artlab', 'Art Lab'],
];

export function createDevtools({ mount, game }) {
  const api = game.api;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  return {
    game: 'Joey the Passion Reimagined',

    catalog({ definition, screen, keysFor }) {
      return {
        levels: [],
        screens: SCREENS.map(([id, name]) => screen(`screen:${id}`, name, { tweakKeys: keysFor(`screen:${id}`) })),
        definitions: [
          definition('def:arena', 'Street arena', { tweakKeys: keysFor('def:arena'), nodeKinds: ['arena'], sprite: 'ARENA_BG', category: 'world' }),
          definition('def:creature', 'Living monsters', { tweakKeys: keysFor('def:creature'), nodeKinds: ['creature'], singleton: false, category: 'characters' }),
          definition('def:card', 'Cards', { tweakKeys: keysFor('def:card'), nodeKinds: ['card'], sprite: 'CARD_BACK', singleton: false, category: 'world' }),
          definition('def:joey', 'Joey', { tweakKeys: keysFor('def:joey'), nodeKinds: ['joey'], sprite: 'RIVAL_PORTRAITS', spriteFrame: 'confident', category: 'characters' }),
          definition('def:hud', 'Duel HUD', { tweakKeys: keysFor('def:hud'), nodeKinds: ['hud'], sprite: 'GAME_ICONS', category: 'interface' }),
          definition('def:hand', 'Hand', { tweakKeys: keysFor('def:hand'), nodeKinds: ['hand'], category: 'interface' }),
          definition('def:effects', 'Battle effects', { tweakKeys: keysFor('def:effects'), nodeKinds: ['effects'], sprite: 'FX_ATLAS', spriteFrame: 'impact_star', category: 'effects' }),
        ],
      };
    },

    describeScene() {
      const nodes = [];
      const canvas = mount.querySelector('.arena-canvas');
      if (canvas) nodes.push({ id: 'arena', defId: 'def:arena', kind: 'arena', label: 'Street arena', rect: rectOf(canvas), instance: {} });
      const d = game.state.duel;
      if (d) {
        for (const u of Object.keys(d.cards)) {
          const c = d.cards[u];
          if (c.loc !== 'mz' || !c.faceUp) continue;
          nodes.push({ id: `creature-${u}`, defId: 'def:creature', kind: 'creature', label: `Creature ${u}`, rect: { x: 0, y: 0, w: 0, h: 0 }, instance: { cardId: c.id, controller: c.ctrl } });
        }
      }
      const top = mount.querySelector('.hud-top');
      if (top && !top.closest('[hidden]')) nodes.push({ id: 'joey', defId: 'def:joey', kind: 'joey', label: 'Joey', rect: rectOf(top.querySelector('.badge-card')), instance: {} });
      if (top && !top.closest('[hidden]')) nodes.push({ id: 'hud', defId: 'def:hud', kind: 'hud', label: 'Duel HUD', rect: rectOf(top), instance: {} });
      const hand = mount.querySelector('.hand-tray');
      if (hand && !hand.closest('[hidden]')) nodes.push({ id: 'hand', defId: 'def:hand', kind: 'hand', label: 'Hand', rect: rectOf(hand), instance: {} });
      return { nodes };
    },

    getState: () => {
      const d = game.state.duel;
      return {
        started: !!d,
        over: d ? d.winner !== null : false,
        score: d ? d.players[0].lp : 0,
      };
    },
    getScreen: () => (game.state.screen && SCREENS.some(([id]) => id === game.state.screen) ? `screen:${game.state.screen}` : null),
    showScreen: (id) => {
      if (id === null) {
        if (!game.state.duel) api.startDuel({ mode: 'single' });
        else api.showScreen(null);
        return;
      }
      const key = id.replace('screen:', '');
      if (key === 'pause' && !game.state.duel) api.startDuel({ mode: 'single' });
      api.showScreen(key);
    },
  };
}
