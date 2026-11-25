// Preset decks and deck validation for Classic Mode. Lists use official card
// names; validateDeck() checks size, copy limits, the Forbidden/Limited list,
// and that every card is fully playable (data, image, effect and creature).

import { cardByName, cardById } from './cards.js';
import { CLASSIC_2004 } from './rules.js';
import { supportStatus } from './effects.js';

const expand = (list) => list.flatMap(([name, n]) => Array(n).fill(name));

export const PRESET_DECKS = {
  starter: {
    id: 'starter',
    owner: 'player',
    identity: 'The original Joey the Passion starting deck: sturdy Normal Monsters, Buster Blader, and a toolbox of era-defining staples.',
    main: expand([
      ["Alligator's Sword", 2], ['Axe Raider', 2], ['Baby Dragon', 2], ['Flame Cerebrus', 1], ['Gadget Soldier', 1], ['Gamma the Magnet Warrior', 1],
      ['Gemini Elf', 2], ['Gradius', 1], ['Headless Knight', 1], ['Island Turtle', 1], ['Slot Machine', 1], ['The Gross Ghost of Fled Dreams', 1],
      ['Tiger Axe', 2], ['Buster Blader', 1], ['Goblin Attack Force', 1], ['Morphing Jar #2', 1], ['Nimble Momonga', 1], ['Penguin Soldier', 1],
      ['Sangan', 1], ['Witch of the Black Forest', 1], ['Zombyra the Dark', 1],
      ['Card of Safe Return', 1], ['Change of Heart', 1], ['Giant Trunade', 1], ['Graceful Dice', 1], ["Harpie's Feather Duster", 1],
      ['Monster Reborn', 1], ['Mystical Space Typhoon', 2], ['Polymerization', 1], ['Tribute to the Doomed', 1],
      ['Backup Soldier', 1], ['Call of the Haunted', 1], ['Chain Destruction', 1], ['Magic Cylinder', 1], ['Magic Jammer', 1], ['Torrential Tribute', 1],
    ]),
    extra: expand([["Alligator's Sword Dragon", 1]]),
  },
  dragonSpark: {
    id: 'dragonSpark',
    owner: 'player',
    unlockRank: 3,
    identity: 'Dragons and gambles: Time Wizard and Baby Dragon become Thousand Dragon, Lord of D. calls Red-Eyes in pairs.',
    main: expand([
      ['Baby Dragon', 3], ['Time Wizard', 2], ['Red-Eyes Black Dragon', 2], ['Summoned Skull', 1], ['Lord of D.', 1], ["Alligator's Sword", 2],
      ['Gemini Elf', 2], ['Axe Raider', 1], ['Mystic Tomato', 2], ['Sangan', 1], ['Witch of the Black Forest', 1], ['Big Shield Gardna', 1],
      ['Polymerization', 2], ['The Flute of Summoning Dragon', 1], ['Monster Reborn', 1], ['Dragon Treasure', 2], ['Mystical Space Typhoon', 2],
      ['Premature Burial', 1], ['Dark Hole', 1], ['Pot of Greed', 1], ['Fissure', 1], ['Graceful Dice', 1],
      ['Trap Hole', 2], ['Mirror Force', 1], ['Waboku', 2], ['Reinforcements', 2], ['Magic Cylinder', 1],
    ]),
    extra: expand([['Thousand Dragon', 2], ['Black Skull Dragon', 1], ["Alligator's Sword Dragon", 2]]),
  },
  ironKnights: {
    id: 'ironKnights',
    owner: 'player',
    unlockRank: 5,
    identity: 'Warriors that refuse to fall: Rocket Warrior and Gearfried press, Scapegoat buys time, Flame Swordsman finishes.',
    main: expand([
      ['Gearfried the Iron Knight', 2], ['Rocket Warrior', 2], ['Panther Warrior', 2], ['Goblin Attack Force', 2], ['Axe Raider', 2],
      ['Big Shield Gardna', 1], ['Flame Manipulator', 2], ['Masaki the Legendary Swordsman', 2], ['Swordsman of Landstar', 1], ['Giant Rat', 2], ['Witch of the Black Forest', 1],
      ['Polymerization', 2], ['Scapegoat', 2], ['Salamandra', 2], ['Legendary Sword', 1], ['Mystical Space Typhoon', 1], ['Nobleman of Crossout', 1],
      ['Giant Trunade', 1], ['Swords of Revealing Light', 1], ['Graceful Dice', 1], ['Dian Keto the Cure Master', 1],
      ['Reinforcements', 2], ['Backup Soldier', 1], ['Magic Cylinder', 1], ['Mirror Force', 1], ['Waboku', 1], ['Skull Dice', 1], ['Call of the Haunted', 1],
    ]),
    extra: expand([['Flame Swordsman', 2]]),
  },

  // Joey's decks, one per difficulty band.
  joeyStreet: {
    id: 'joeyStreet',
    owner: 'joey',
    identity: 'Street Rookie: honest Normal Monsters, a little burn, and Trap Hole when you overreach.',
    main: expand([
      ['Axe Raider', 2], ['Battle Warrior', 2], ['Tiger Axe', 2], ['Darkfire Soldier #1', 2], ['Headless Knight', 2], ['Island Turtle', 2], ['Science Soldier', 1],
      ['Gadget Soldier', 1], ['Overdrive', 2], ['Oni Tank T-34', 1], ['Psychic Kappa', 1], ['Leogun', 1], ['Garnecia Elefantis', 1], ['Baby Dragon', 2],
      ["Alligator's Sword", 2], ['Swordsman of Landstar', 1],
      ['Polymerization', 1], ['Mountain', 1], ['Dian Keto the Cure Master', 2], ['Hinotama', 2], ['Sparks', 2], ['Stop Defense', 1],
      ['Trap Hole', 2], ['Reinforcements', 2], ['Castle Walls', 2],
    ]),
    extra: expand([["Alligator's Sword Dragon", 1]]),
  },
  joeyDice: {
    id: 'joeyDice',
    owner: 'joey',
    identity: 'Lucky Dice: Time Wizard coin flips, Graceful and Skull Dice, and Thousand Dragon when luck is on his side.',
    main: expand([
      ['Time Wizard', 2], ['Baby Dragon', 2], ['Slot Machine', 1], ['Rocket Warrior', 1], ['Axe Raider', 2], ["Alligator's Sword", 2], ['Gemini Elf', 1],
      ['Tiger Axe', 2], ['Garnecia Elefantis', 1], ['Headless Knight', 2], ['Penguin Soldier', 1], ['Mystic Tomato', 1], ['Nimble Momonga', 2], ['Darkfire Soldier #1', 2],
      ['Graceful Dice', 2], ['Polymerization', 1], ['Monster Reborn', 1], ['Hinotama', 1], ['Dian Keto the Cure Master', 1], ['Fissure', 1], ['Stop Defense', 1], ['Giant Trunade', 1],
      ['Skull Dice', 2], ['Trap Hole', 2], ['Waboku', 1], ['Reinforcements', 2], ['Castle Walls', 2],
    ]),
    extra: expand([['Thousand Dragon', 1], ["Alligator's Sword Dragon", 1]]),
  },
  joeyFlame: {
    id: 'joeyFlame',
    owner: 'joey',
    identity: 'Flame Swordsman: Masaki and Flame Manipulator fuse, Salamandra stokes the blade, Mirror Force guards the street.',
    main: expand([
      ['Flame Manipulator', 2], ['Masaki the Legendary Swordsman', 2], ['Flame Cerebrus', 1], ['Darkfire Soldier #1', 2], ['Axe Raider', 2], ['Gemini Elf', 1],
      ['Goblin Attack Force', 1], ['Sangan', 1], ['Witch of the Black Forest', 1], ['Giant Rat', 2], ['Big Shield Gardna', 1], ['Gearfried the Iron Knight', 1],
      ['Swordsman of Landstar', 1], ['Headless Knight', 1], ['Tiger Axe', 1],
      ['Polymerization', 2], ['Salamandra', 2], ['Legendary Sword', 1], ['Monster Reborn', 1], ['Mystical Space Typhoon', 1], ['Tribute to the Doomed', 1],
      ['Swords of Revealing Light', 1], ['Graceful Dice', 1],
      ['Trap Hole', 2], ['Mirror Force', 1], ['Reinforcements', 2], ['Magic Cylinder', 1], ['Waboku', 1], ['Call of the Haunted', 1], ['Castle Walls', 2],
    ]),
    extra: expand([['Flame Swordsman', 2]]),
  },
  joeyRedEyes: {
    id: 'joeyRedEyes',
    owner: 'joey',
    identity: 'Red-Eyes Rush: Red-Eyes and Summoned Skull become Black Skull Dragon, Metalmorph forges the Metal Dragon.',
    main: expand([
      ['Red-Eyes Black Dragon', 3], ['Summoned Skull', 2], ['Baby Dragon', 2], ['Time Wizard', 1], ['Lord of D.', 1], ['Axe Raider', 2], ['Gemini Elf', 2],
      ['Mystic Tomato', 2], ['Sangan', 1], ['Witch of the Black Forest', 1], ['Big Shield Gardna', 1], ['Giant Rat', 1], ['Red-Eyes Black Metal Dragon', 1],
      ['Polymerization', 2], ['The Flute of Summoning Dragon', 1], ['Monster Reborn', 1], ['Dark Hole', 1], ['Premature Burial', 1], ['Dragon Treasure', 1],
      ['Mystical Space Typhoon', 2], ['Pot of Greed', 1], ['Change of Heart', 1],
      ['Metalmorph', 2], ['Mirror Force', 1], ['Trap Hole', 2], ['Magic Cylinder', 1], ['Call of the Haunted', 1], ['Waboku', 1], ['Reinforcements', 1],
    ]),
    extra: expand([['Black Skull Dragon', 2], ['Thousand Dragon', 1]]),
  },
  joeyIron: {
    id: 'joeyIron',
    owner: 'joey',
    identity: 'Iron Steel: Jinzo shuts your traps down while Gearfried, Rocket Warrior and Panther Warrior grind through.',
    main: expand([
      ['Jinzo', 1], ['Gearfried the Iron Knight', 2], ['Rocket Warrior', 2], ['Panther Warrior', 2], ['Goblin Attack Force', 1], ['Axe Raider', 2], ['Gemini Elf', 1],
      ['Sangan', 1], ['Witch of the Black Forest', 1], ['Big Shield Gardna', 1], ['Giant Rat', 2], ['Nimble Momonga', 2], ['Buster Blader', 1],
      ['Scapegoat', 2], ['Change of Heart', 1], ['Monster Reborn', 1], ['Pot of Greed', 1], ['Graceful Charity', 1], ['Swords of Revealing Light', 1],
      ['Mystical Space Typhoon', 2], ["Harpie's Feather Duster", 1], ['Nobleman of Crossout', 1], ['Premature Burial', 1], ['Snatch Steal', 1], ['Delinquent Duo', 1],
      ['Mirror Force', 1], ['Magic Cylinder', 1], ['Torrential Tribute', 1], ['Call of the Haunted', 1], ['Ring of Destruction', 1], ['Waboku', 1], ['Magic Jammer', 1],
    ]),
    extra: [],
  },
  joeyPassion: {
    id: 'joeyPassion',
    owner: 'joey',
    identity: 'Passion: the best of the street — Jinzo, Red-Eyes, Buster Blader and every limited power card he owns.',
    main: expand([
      ['Jinzo', 1], ['Red-Eyes Black Dragon', 2], ['Summoned Skull', 1], ['Buster Blader', 1], ['Gearfried the Iron Knight', 2], ['Rocket Warrior', 1],
      ['Panther Warrior', 1], ['Time Wizard', 1], ['Baby Dragon', 1], ['Sangan', 1], ['Witch of the Black Forest', 1], ['Mystic Tomato', 2], ['Giant Rat', 1],
      ['Nimble Momonga', 1], ['Big Shield Gardna', 1], ['Penguin Soldier', 1],
      ['Raigeki', 1], ['Dark Hole', 1], ['Change of Heart', 1], ['Pot of Greed', 1], ['Graceful Charity', 1], ['Monster Reborn', 1], ['Premature Burial', 1],
      ['Snatch Steal', 1], ["Harpie's Feather Duster", 1], ['Heavy Storm', 1], ['Scapegoat', 1], ['Swords of Revealing Light', 1], ['Mystical Space Typhoon', 1],
      ['Delinquent Duo', 1], ['Polymerization', 1],
      ['Mirror Force', 1], ['Magic Cylinder', 1], ['Ring of Destruction', 1], ['Call of the Haunted', 1], ['Torrential Tribute', 1], ['Magic Jammer', 1],
    ]),
    extra: expand([['Black Skull Dragon', 1], ['Thousand Dragon', 1]]),
  },
};

export const DIFFICULTIES = [
  { id: 'beginner', ranks: [1, 2], deck: 'joeyStreet' },
  { id: 'easy', ranks: [3], deck: 'joeyDice' },
  { id: 'normal', ranks: [4, 5], deck: 'joeyFlame' },
  { id: 'hard', ranks: [6], deck: 'joeyRedEyes' },
  { id: 'expert', ranks: [7, 8], deck: 'joeyIron' },
  { id: 'challenge', ranks: [9], deck: 'joeyPassion' },
];

export const difficultyForRank = (rank) => DIFFICULTIES.find((d) => d.ranks.includes(rank)) || DIFFICULTIES[0];

export function deckIds(deck) {
  return {
    main: deck.main.map((n) => {
      const c = cardByName(n);
      if (!c) throw new Error(`Deck card not in database: ${n}`);
      return c.id;
    }),
    extra: deck.extra.map((n) => {
      const c = cardByName(n);
      if (!c) throw new Error(`Deck card not in database: ${n}`);
      return c.id;
    }),
  };
}

export function copyLimit(card, forbiddenOn = CLASSIC_2004.forbiddenOption) {
  if (card.limit === 'forbidden') return forbiddenOn ? 0 : 1;
  if (card.limit === 'limited') return 1;
  if (card.limit === 'semi') return 2;
  return CLASSIC_2004.copies;
}

// Is the card fully playable right now? (data + cached image + effect + creature)
export function playable(card, creatures) {
  if (!card || card.token) return false;
  if (supportStatus(card) === 'unsupported') return false;
  if (card.kind === 'monster' && creatures && !creatures.has(card.id)) return false;
  return true;
}

export function validateDeck({ main, extra }, { creatures = null, forbiddenOn = CLASSIC_2004.forbiddenOption } = {}) {
  const errors = [];
  const r = CLASSIC_2004;
  if (main.length < r.mainDeck.min) errors.push({ code: 'mainTooSmall', n: main.length });
  if (main.length > r.mainDeck.max) errors.push({ code: 'mainTooBig', n: main.length });
  if (extra.length > r.fusionDeck.max) errors.push({ code: 'extraTooBig', n: extra.length });
  const counts = new Map();
  for (const id of [...main, ...extra]) counts.set(id, (counts.get(id) || 0) + 1);
  for (const [id, n] of counts) {
    const c = cardById(id);
    if (!c) {
      errors.push({ code: 'unknownCard', id });
      continue;
    }
    if (n > copyLimit(c, forbiddenOn)) errors.push({ code: 'tooManyCopies', id, n, max: copyLimit(c, forbiddenOn) });
    if (!playable(c, creatures)) errors.push({ code: 'notPlayable', id });
  }
  for (const id of main) if (cardById(id)?.frame === 'fusion') errors.push({ code: 'fusionInMain', id });
  for (const id of extra) if (cardById(id)?.frame !== 'fusion') errors.push({ code: 'nonFusionInExtra', id });
  return { ok: errors.length === 0, errors };
}
