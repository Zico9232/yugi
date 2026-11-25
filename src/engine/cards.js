// Card database access. The database (src/data/cards.json) is built by
// tools/build_card_db.py from the official records; this module only reads it.
// The engine receives the array through setCardDb so it runs unchanged in the
// browser and in the Node rule tests.

let byId = new Map();
let byName = new Map();
let all = [];

// Stand-ins the AI sees instead of cards it cannot know (hidden hand, deck,
// face-down cards). Face-down monsters carry a typical defence estimate.
export const UNKNOWN_CARDS = [
  { id: 0, name: '?', kind: 'unknown', frame: null, sub: null, level: 0, atk: 0, def: 0, desc: '' },
  { id: -1, name: '?', kind: 'monster', frame: 'normal', attr: null, race: '?', level: 4, atk: 1300, def: 1500, desc: '' },
  { id: -2, name: '?', kind: 'trap', sub: 'Normal', desc: '' },
];

export function setCardDb(cards) {
  all = cards;
  byId = new Map([...cards, ...UNKNOWN_CARDS].map((c) => [c.id, c]));
  byName = new Map(cards.map((c) => [c.name, c]));
  fusionCache.clear();
}

export const allCards = () => all;
export const cardById = (id) => byId.get(id) || null;
export const cardByName = (name) => byName.get(name) || null;
export const idOf = (name) => {
  const c = byName.get(name);
  if (!c) throw new Error(`Unknown card name: ${name}`);
  return c.id;
};

export const isMonster = (c) => c?.kind === 'monster';
export const isSpell = (c) => c?.kind === 'spell';
export const isTrap = (c) => c?.kind === 'trap';
export const isExtraDeck = (c) => c?.frame === 'fusion';
export const isNormalMonster = (c) => c?.frame === 'normal';

// Spell Speed of a card's own activation, per the 2004 rulebook.
export function baseSpeed(c) {
  if (c.kind === 'spell') return c.sub === 'Quick-Play' ? 2 : 1;
  if (c.kind === 'trap') return c.sub === 'Counter' ? 3 : 2;
  return 1;
}

// Fusion materials are read from the card's own text: the leading quoted names.
const fusionCache = new Map();
export function fusionMaterials(c) {
  if (!c || c.frame !== 'fusion') return null;
  if (fusionCache.has(c.id)) return fusionCache.get(c.id);
  const first = c.desc.split('\n')[0];
  const names = [...first.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const ids = names.map((n) => byName.get(n)?.id ?? byName.get(n.replace('B. Dragon', 'Black Dragon'))?.id ?? null);
  const res = ids.every(Boolean) && ids.length >= 2 ? ids : null;
  fusionCache.set(c.id, res);
  return res;
}

// Ritual monster for each Ritual Spell in the pool.
export const RITUALS = {
  'Black Magic Ritual': 'Magician of Black Chaos',
  'Curse of the Masked Beast': 'The Masked Beast',
  'Commencement Dance': 'Performance of Sword',
  'Hamburger Recipe': 'Hungry Burger',
  'Turtle Oath': 'Crab Turtle',
  "Novox's Prayer": 'Skull Guardian',
  'Revival of Dokurorider': 'Dokurorider',
};

// Standard card layout: where the illustration sits inside the card image.
export const ART_BOX = { x: 0.119, y: 0.183, w: 0.762, h: 0.522 };

export const ATTR_COLORS = {
  DARK: '#a855f7',
  LIGHT: '#fde68a',
  EARTH: '#d97706',
  WATER: '#38bdf8',
  FIRE: '#ef4444',
  WIND: '#4ade80',
  DIVINE: '#facc15',
};
