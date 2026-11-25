// Executable card effects, keyed by official card name. Each entry implements
// the card's 2004 behaviour through the engine context (duel.js ctxFor), so
// rules such as Lord of D.'s protection or Jinzo's trap lock apply uniformly.
//
// Shape of an entry (every member optional):
//   activate  { speed, can(ctx), target(ctx), cost(ctx), resolve(ctx) }  Spell/Trap activation
//   ignition  { can, target, cost, resolve, onceKey }                      monster ignition effect
//   triggers  [{ on, watch, optional, cond, target, cost, resolve, noChain }]
//   equip     { filter(def, d, uid), atk, def, atkFn, defFn, attackBonus }
//   field     [{ match(def), atk, def }]
//   aura(ctx, uid, stat)  selfMod(ctx, stat)  lockAttacks(ctx, attacker)  lockPosition(ctx, uid)
//   noNormalSummon specialOnly canDirect noDirect attackCost attackCostCan attacksPerTurn
//   battleShield battleIndestructible afterKill afterDamage afterAttack afterAttacked
//   isEquipTrap  note (classic ruling notes shown with the card)
//
// A card with no entry here (and not a Normal Monster) is "Unsupported" and is
// locked out of decks, rewards and ranked duels until it gets one.

import { cardByName, cardById, fusionMaterials, isMonster, isSpell, isTrap, RITUALS } from './cards.js';

const E = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const opp = (ctx) => ctx.opp;
const isUpMonster = (ctx, u) => ctx.card(u).loc === 'mz' && ctx.card(u).faceUp;
const stillOnField = (ctx, u, loc = 'mz') => ctx.card(u)?.loc === loc;

function targetOne(ctx, options, title) {
  const t = ctx.chooseOne(ctx.p, options, { title, cancel: true });
  ctx.link.targets.push(t);
  return t;
}
function targetables(ctx, list) {
  return list.filter((u) => ctx.canTarget(u));
}
function discardCost(ctx, n = 1, title = 'discardCost') {
  const picks = ctx.choose(ctx.p, ctx.hand(ctx.p).filter((u) => u !== ctx.self), { min: n, max: n, title, cancel: true });
  picks.forEach((u) => ctx.discard(u));
}
function searchDeck(ctx, filter, title = 'search', toHand = true) {
  const options = ctx.deck(ctx.p).filter((u) => filter(ctx.def(u), u));
  if (!options.length) {
    ctx.shuffleDeck(ctx.p);
    return null;
  }
  const pick = ctx.chooseOne(ctx.p, options, { title });
  if (toHand) {
    ctx.toHand(pick);
    ctx.reveal(pick);
  }
  ctx.shuffleDeck(ctx.p);
  return pick;
}
function choosePos(ctx, title = 'position') {
  return ctx.chooseOne(ctx.p, ['atk', 'def'], { kind: 'option', title });
}
function untilTurn(atk, def) {
  return { atk, def, until: 'turn' };
}

const spell = (x) => x;
const trap = (x) => x;

// Equip Spell: one target, a filter, and fixed or computed modifiers.
function equipSpell(filter, mods = {}) {
  return {
    equip: { filter, ...mods },
    activate: {
      can: (ctx) => targetables(ctx, ctx.allMonsters((u) => isUpMonster(ctx, u) && filter(ctx.def(u), ctx.d, u))).length > 0,
      target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => isUpMonster(ctx, u) && filter(ctx.def(u), ctx.d, u))), 'equipTarget'),
      resolve: (ctx) => {
        const t = ctx.link.targets[0];
        if (isUpMonster(ctx, t) && filter(ctx.def(t), ctx.d, t)) ctx.equip(ctx.self, t);
      },
    },
  };
}
const raceIs = (...races) => (def) => isMonster(def) && races.includes(def.race);
const attrIs = (...attrs) => (def) => isMonster(def) && attrs.includes(def.attr);
const anyMonster = (def) => isMonster(def);

function fieldSpell(rules) {
  return { field: rules, activate: { resolve: () => {} } };
}

// Battle recruiters: "destroyed by battle and sent to the GY: Special Summon
// 1 <attr> monster with 1500 or less ATK from your Deck in Attack Position."
function recruiter(attr) {
  return {
    triggers: [
      {
        on: 'destroyedByBattle',
        optional: true,
        cond: (ctx) => ctx.freeZones(ctx.p) > 0 || true,
        resolve: (ctx) => {
          if (ctx.freeZones(ctx.p) <= 0) return;
          const options = ctx.deck(ctx.p).filter((u) => {
            const df = ctx.def(u);
            return isMonster(df) && df.attr === attr && (df.atk ?? 0) <= 1500 && df.frame !== 'fusion' && !E[df.name]?.specialOnly;
          });
          if (!options.length) return ctx.shuffleDeck(ctx.p);
          const pick = ctx.chooseOne(ctx.p, options, { title: 'recruit' });
          ctx.specialSummon(pick, ctx.p, 'atk');
          ctx.shuffleDeck(ctx.p);
        },
      },
    ],
  };
}

// Attribute auras ("All X monsters gain 500 ATK, all Y lose 400").
function attrAura(up, down) {
  return {
    aura: (ctx, uid, stat) => {
      if (stat !== 'atk' || !isUpMonster(ctx, uid)) return 0;
      const a = ctx.def(uid).attr;
      return (a === up ? 500 : 0) + (a === down ? -400 : 0);
    },
  };
}

// Flip effect wrapper.
const flip = (x) => ({ triggers: [{ on: 'flipped', ...x }] });

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

E['Buster Blader'] = {
  selfMod: (ctx, stat) => {
    if (stat !== 'atk') return 0;
    const field = ctx.faceUpMonsters(opp(ctx), (u) => ctx.def(u).race === 'Dragon').length;
    const gy = ctx.gy(opp(ctx)).filter((u) => ctx.def(u).race === 'Dragon').length;
    return 500 * (field + gy);
  },
};

E['Goblin Attack Force'] = {
  afterAttack: (ctx) => {
    ctx.card(ctx.self).flags.goblinRest = true;
  },
  note: 'After it attacks it switches to Defense Position at the end of the Battle Phase and stays there until the end of your next turn.',
};

E['Zombyra the Dark'] = {
  noDirect: true,
  afterKill: (ctx) => ctx.addMod(ctx.self, { atk: -200 }),
};

E['Nimble Momonga'] = {
  triggers: [
    {
      on: 'destroyedByBattle',
      resolve: (ctx) => {
        ctx.gainLp(ctx.p, 1000);
        const copies = ctx.deck(ctx.p).filter((u) => ctx.def(u).name === 'Nimble Momonga');
        if (!copies.length) return;
        const max = Math.min(copies.length, ctx.freeZones(ctx.p));
        const picks = ctx.choose(ctx.p, copies, { min: 0, max, title: 'momonga' });
        picks.forEach((u) => ctx.specialSummon(u, ctx.p, 'def', false));
        ctx.shuffleDeck(ctx.p);
      },
    },
  ],
};

E['Sangan'] = {
  triggers: [{ on: 'toGyFromField', resolve: (ctx) => searchDeck(ctx, (df) => isMonster(df) && df.frame !== 'fusion' && (df.atk ?? 0) <= 1500) }],
};

E['Witch of the Black Forest'] = {
  triggers: [{ on: 'toGyFromField', resolve: (ctx) => searchDeck(ctx, (df) => isMonster(df) && df.frame !== 'fusion' && (df.def ?? 0) <= 1500) }],
};

E['Penguin Soldier'] = flip({
  target: (ctx) => {
    const picks = ctx.choose(ctx.p, targetables(ctx, ctx.allMonsters((u) => u !== ctx.self || true)), { min: 0, max: 2, title: 'bounceUpTo2' });
    ctx.link.targets.push(...picks);
  },
  resolve: (ctx) => ctx.link.targets.filter((u) => stillOnField(ctx, u)).forEach((u) => ctx.toHand(u)),
});

E['Morphing Jar #2'] = flip({
  resolve: (ctx) => {
    const counts = [0, 0];
    for (const pl of [0, 1]) {
      for (const u of ctx.monsters(pl)) {
        const owner = ctx.card(u).owner;
        const wasToken = ctx.card(u).token;
        ctx.toDeck(u, false);
        if (!wasToken) counts[owner]++;
      }
    }
    for (const pl of [0, 1]) ctx.shuffleDeck(pl);
    for (const pl of [ctx.p, opp(ctx)]) {
      let found = 0;
      while (found < counts[pl] && ctx.deck(pl).length) {
        const top = ctx.deck(pl)[0];
        const df = ctx.def(top);
        ctx.reveal(top);
        if (isMonster(df) && df.level <= 4 && df.frame !== 'fusion' && !E[df.name]?.specialOnly && ctx.freeZones(pl) > 0) {
          ctx.specialSummon(top, pl, 'def', false);
          found++;
        } else ctx.sendToGy(top, 'excavate');
      }
    }
  },
});

E['Morphing Jar'] = flip({
  resolve: (ctx) => {
    for (const pl of [0, 1]) ctx.hand(pl).forEach((u) => ctx.discard(u));
    for (const pl of [ctx.p, opp(ctx)]) ctx.draw(pl, 5);
  },
});

E['Time Wizard'] = {
  ignition: {
    resolve: (ctx) => {
      const r = ctx.coin();
      if (r === 'heads') ctx.destroyAll(ctx.monsters(opp(ctx)));
      else {
        const mine = ctx.monsters(ctx.p);
        const total = mine.reduce((s, u) => s + (ctx.isUp(u) ? ctx.atk(u) : 0), 0);
        ctx.destroyAll(mine);
        ctx.damage(ctx.p, Math.floor(total / 2));
      }
    },
  },
  note: 'Once per turn: toss a coin. Heads destroys every monster your opponent controls; tails destroys yours and you take half their total ATK.',
};

E['Lord of D.'] = { note: 'While face-up, Dragon monsters on the field cannot be targeted by card effects.' };

E['Mystic Tomato'] = recruiter('DARK');
E['Giant Rat'] = recruiter('EARTH');
E['Mother Grizzly'] = recruiter('WATER');
E['Shining Angel'] = recruiter('LIGHT');
E['UFO Turtle'] = recruiter('FIRE');

E['Big Shield Gardna'] = {
  afterAttacked: (ctx) => {
    if (stillOnField(ctx, ctx.self) && ctx.card(ctx.self).pos === 'def') ctx.changePos(ctx.self, 'atk');
  },
  note: 'A Spell that targets only this face-down card is negated. When attacked, it changes to Attack Position after damage calculation.',
};

E['Gearfried the Iron Knight'] = { note: 'Any Equip Card equipped to this card is destroyed.' };

E['Rocket Warrior'] = {
  battleShield: true,
  afterDamage: (ctx, target) => {
    if (target && stillOnField(ctx, target) && ctx.isUp(target)) ctx.addMod(target, untilTurn(-500, 0));
  },
  note: 'During your Battle Phase it cannot be destroyed by battle and you take no battle damage from its attacks; the monster it attacks loses 500 ATK until the end of the turn.',
};

E['Panther Warrior'] = {
  attackCostCan: (ctx) => ctx.monsters(ctx.p).some((u) => u !== ctx.self),
  attackCost: (ctx) => {
    const t = ctx.chooseOne(ctx.p, ctx.monsters(ctx.p).filter((u) => u !== ctx.self), { title: 'pantherTribute', cancel: true });
    ctx.sendToGy(t, 'tribute');
  },
};

E['Jinzo'] = { note: 'While face-up, Trap Cards cannot be activated and the effects of all face-up Traps are negated.' };

E['Red-Eyes Black Metal Dragon'] = { noNormalSummon: true, specialOnly: true, note: 'Special Summoned only by Metalmorph from a "Red-Eyes Black Dragon".' };

E['Exodia the Forbidden One'] = { note: 'Holding this card and all four Forbidden One limbs in your hand wins the duel.' };

E['D.D. Warrior'] = {
  afterDamage: (ctx, target) => {
    if (target && stillOnField(ctx, target)) ctx.banish(target);
    if (stillOnField(ctx, ctx.self)) ctx.banish(ctx.self);
  },
  afterAttacked: (ctx, attacker) => {
    if (attacker && stillOnField(ctx, attacker)) ctx.banish(attacker);
    if (stillOnField(ctx, ctx.self)) ctx.banish(ctx.self);
  },
};

E['Wall of Illusion'] = {
  afterAttacked: (ctx, attacker) => {
    if (attacker && stillOnField(ctx, attacker)) ctx.toHand(attacker);
  },
};

E['Dark Elf'] = {
  attackCostCan: (ctx) => ctx.lp(ctx.p) > 1000,
  attackCost: (ctx) => ctx.payLp(ctx.p, 1000),
};

E['Hayabusa Knight'] = { attacksPerTurn: 2 };
E['Mystic Lamp'] = { canDirect: () => true };

E["Alligator's Sword Dragon"] = {
  canDirect: (ctx) => {
    const mons = ctx.monsters(opp(ctx));
    return mons.length > 0 && mons.every((u) => ctx.isUp(u) && ['EARTH', 'WATER', 'FIRE'].includes(ctx.def(u).attr));
  },
};

E['Cannon Soldier'] = {
  ignition: {
    unlimited: true,
    can: (ctx) => ctx.monsters(ctx.p).length > 0,
    cost: (ctx) => {
      const t = ctx.chooseOne(ctx.p, ctx.monsters(ctx.p), { title: 'tributeCost', cancel: true });
      ctx.sendToGy(t, 'tribute');
    },
    resolve: (ctx) => ctx.damage(opp(ctx), 500),
  },
};

E['Catapult Turtle'] = {
  ignition: {
    can: (ctx) => ctx.monsters(ctx.p).some((u) => u !== ctx.self),
    cost: (ctx) => {
      const t = ctx.chooseOne(ctx.p, ctx.monsters(ctx.p).filter((u) => u !== ctx.self), { title: 'tributeCost', cancel: true });
      ctx.link.data.dmg = ctx.isUp(t) ? Math.floor(ctx.atk(t) / 2) : 0;
      ctx.sendToGy(t, 'tribute');
    },
    resolve: (ctx) => ctx.damage(opp(ctx), ctx.link.data.dmg),
  },
};

E['Hysteric Fairy'] = {
  ignition: {
    unlimited: true,
    can: (ctx) => ctx.monsters(ctx.p).length >= 2,
    cost: (ctx) => {
      const ts = ctx.choose(ctx.p, ctx.monsters(ctx.p), { min: 2, max: 2, title: 'tributeCost', cancel: true });
      ts.forEach((t) => ctx.sendToGy(t, 'tribute'));
    },
    resolve: (ctx) => ctx.gainLp(ctx.p, 1000),
  },
};

E['Bladefly'] = attrAura('WIND', 'EARTH');
E['Little Chimera'] = attrAura('FIRE', 'WATER');
E['Milus Radiant'] = attrAura('EARTH', 'WIND');
E['Star Boy'] = attrAura('WATER', 'FIRE');
E['Hoshiningen'] = attrAura('LIGHT', 'DARK');
E["Witch's Apprentice"] = attrAura('DARK', 'LIGHT');

E['Soul of Purity and Light'] = {
  aura: (ctx, uid, stat) => (stat === 'atk' && ctx.phase() === 'battle' && ctx.turnPlayer() === ctx.p && ctx.card(uid).ctrl === opp(ctx) && isUpMonster(ctx, uid) ? -300 : 0),
};

E['Machine King'] = {
  selfMod: (ctx, stat) => (stat === 'atk' ? 100 * ctx.allMonsters((u) => isUpMonster(ctx, u) && ctx.def(u).race === 'Machine').length : 0),
};
E['Muka Muka'] = { selfMod: (ctx) => 300 * ctx.hand(ctx.p).length }; // ATK and DEF alike
E['Maha Vailo'] = {
  selfMod: (ctx, stat) => {
    if (stat !== 'atk') return 0;
    let n = 0;
    for (const pl of [0, 1]) for (const u of ctx.spellTraps(pl)) if (ctx.card(u).equipTo === ctx.self) n++;
    return 500 * n;
  },
};
E["Harpie's Pet Dragon"] = {
  selfMod: (ctx, stat) => (stat === 'atk' ? 300 * ctx.allMonsters((u) => isUpMonster(ctx, u) && ctx.def(u).name === 'Harpie Lady').length : 0),
};

E['Fire Princess'] = {
  triggers: [{ on: 'gainedLp', watch: true, cond: (ctx, ev) => ev.p === ctx.p && ctx.card(ctx.self).loc === 'mz', resolve: (ctx) => ctx.damage(opp(ctx), 500) }],
};
E['Mysterious Puppeteer'] = {
  triggers: [{ on: 'summoned', watch: true, cond: (ctx, ev) => (ev.how === 'normal' || ev.how === 'tribute' || ev.how === 'flip') && ctx.card(ctx.self).loc === 'mz', resolve: (ctx) => ctx.gainLp(ctx.p, 500) }],
};
const standbyHeal = (amount, cond) => ({
  triggers: [{ on: 'standby', watch: true, cond: (ctx, ev) => ev.p === ctx.p && ctx.card(ctx.self).loc === 'mz' && cond(ctx), resolve: (ctx) => ctx.gainLp(ctx.p, amount) }],
});
E['Dancing Fairy'] = standbyHeal(1000, (ctx) => ctx.card(ctx.self).pos === 'def');
E['Cure Mermaid'] = standbyHeal(800, () => true);
E['Spirit of the Breeze'] = standbyHeal(1000, (ctx) => ctx.card(ctx.self).pos === 'atk');

E['The Wicked Worm Beast'] = {
  triggers: [{ on: 'endPhase', watch: true, cond: (ctx, ev) => ev.p === ctx.p && ctx.card(ctx.self).loc === 'mz', resolve: (ctx) => stillOnField(ctx, ctx.self) && ctx.toHand(ctx.self) }],
};

E['Giant Germ'] = {
  triggers: [
    {
      on: 'destroyedByBattle',
      resolve: (ctx) => {
        ctx.damage(opp(ctx), 500);
        const copies = ctx.deck(ctx.p).filter((u) => ctx.def(u).name === 'Giant Germ');
        const max = Math.min(copies.length, ctx.freeZones(ctx.p));
        if (max > 0) ctx.choose(ctx.p, copies, { min: 0, max, title: 'germ' }).forEach((u) => ctx.specialSummon(u, ctx.p, 'atk'));
        ctx.shuffleDeck(ctx.p);
      },
    },
  ],
};

E['The Immortal of Thunder'] = {
  triggers: [
    { on: 'flipped', resolve: (ctx) => ctx.gainLp(ctx.p, 3000) },
    { on: 'toGyFromField', resolve: (ctx) => ctx.payLp(ctx.p, 5000) },
  ],
};

E['Bubonic Vermin'] = flip({
  resolve: (ctx) => {
    const copies = ctx.deck(ctx.p).filter((u) => ctx.def(u).name === 'Bubonic Vermin');
    if (copies.length && ctx.freeZones(ctx.p) > 0) ctx.specialSummon(ctx.chooseOne(ctx.p, copies, { title: 'recruit' }), ctx.p, 'def', false);
    ctx.shuffleDeck(ctx.p);
  },
});

E['Hane-Hane'] = flip({
  target: (ctx) => ctx.link.targets.push(...ctx.choose(ctx.p, targetables(ctx, ctx.allMonsters()), { min: 1, max: 1, title: 'bounce' })),
  resolve: (ctx) => ctx.link.targets.filter((u) => stillOnField(ctx, u)).forEach((u) => ctx.toHand(u)),
});
E['Man-Eater Bug'] = flip({
  target: (ctx) => ctx.link.targets.push(...ctx.choose(ctx.p, targetables(ctx, ctx.allMonsters()), { min: 1, max: 1, title: 'destroyTarget' })),
  resolve: (ctx) => ctx.link.targets.filter((u) => stillOnField(ctx, u)).forEach((u) => ctx.destroy(u)),
});
const flipDestroyST = (kindFilter) =>
  flip({
    target: (ctx) => {
      const opts = [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => kindFilter(ctx, u)));
      ctx.link.targets.push(...ctx.choose(ctx.p, opts, { min: 1, max: 1, title: 'destroyTarget' }));
    },
    resolve: (ctx) => ctx.link.targets.filter((u) => ctx.onField(u)).forEach((u) => ctx.destroy(u)),
  });
E['Armed Ninja'] = flipDestroyST((ctx, u) => !ctx.isUp(u) || isSpell(ctx.def(u)));
E['Trap Master'] = flipDestroyST((ctx, u) => !ctx.isUp(u) || isTrap(ctx.def(u)));
E['Reaper of the Cards'] = flipDestroyST((ctx, u) => !ctx.isUp(u) || isTrap(ctx.def(u)));
E['Greenkappa'] = flip({
  target: (ctx) => {
    const opts = [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => !ctx.isUp(u)));
    ctx.link.targets.push(...ctx.choose(ctx.p, opts, { min: Math.min(2, opts.length), max: 2, title: 'destroyTarget' }));
  },
  resolve: (ctx) => ctx.link.targets.filter((u) => ctx.onField(u)).forEach((u) => ctx.destroy(u)),
});
E['Tornado Bird'] = flip({
  target: (ctx) => {
    const opts = [0, 1].flatMap((pl) => ctx.spellTraps(pl));
    ctx.link.targets.push(...ctx.choose(ctx.p, opts, { min: Math.min(2, opts.length), max: 2, title: 'bounce' }));
  },
  resolve: (ctx) => ctx.link.targets.filter((u) => ctx.onField(u)).forEach((u) => ctx.toHand(u)),
});
E['Magician of Faith'] = flip({
  target: (ctx) => ctx.link.targets.push(...ctx.choose(ctx.p, ctx.gy(ctx.p).filter((u) => isSpell(ctx.def(u))), { min: 1, max: 1, title: 'recover' })),
  resolve: (ctx) => ctx.link.targets.filter((u) => ctx.card(u).loc === 'gy').forEach((u) => ctx.toHand(u)),
});
E['Mask of Darkness'] = flip({
  target: (ctx) => ctx.link.targets.push(...ctx.choose(ctx.p, ctx.gy(ctx.p).filter((u) => isTrap(ctx.def(u))), { min: 1, max: 1, title: 'recover' })),
  resolve: (ctx) => ctx.link.targets.filter((u) => ctx.card(u).loc === 'gy').forEach((u) => ctx.toHand(u)),
});
E['Needle Worm'] = flip({ resolve: (ctx) => ctx.deck(opp(ctx)).slice(0, 5).forEach((u) => ctx.sendToGy(u, 'mill')) });
E['Skelengel'] = flip({ resolve: (ctx) => ctx.draw(ctx.p, 1) });
E['Bite Shoes'] = flip({
  target: (ctx) => ctx.link.targets.push(...ctx.choose(ctx.p, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), { min: 1, max: 1, title: 'changePos' })),
  resolve: (ctx) => ctx.link.targets.filter((u) => isUpMonster(ctx, u)).forEach((u) => ctx.changePos(u, ctx.card(u).pos === 'atk' ? 'def' : 'atk')),
});
E['4-Starred Ladybug of Doom'] = flip({
  resolve: (ctx) => ctx.destroyAll(ctx.faceUpMonsters(opp(ctx), (u) => ctx.level(u) === 4)),
});
E['The Stern Mystic'] = flip({
  resolve: (ctx) => {
    for (const pl of [0, 1]) for (const u of [...ctx.monsters(pl), ...ctx.spellTraps(pl)]) if (!ctx.isUp(u)) ctx.reveal(u);
  },
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

E['Pot of Greed'] = spell({ activate: { can: (ctx) => ctx.deck(ctx.p).length >= 2, resolve: (ctx) => ctx.draw(ctx.p, 2) } });
E['Upstart Goblin'] = spell({ activate: { can: (ctx) => ctx.deck(ctx.p).length >= 1, resolve: (ctx) => (ctx.draw(ctx.p, 1), ctx.gainLp(opp(ctx), 1000)) } });
E['Graceful Charity'] = spell({
  activate: {
    can: (ctx) => ctx.deck(ctx.p).length >= 3,
    resolve: (ctx) => {
      ctx.draw(ctx.p, 3);
      const n = Math.min(2, ctx.hand(ctx.p).length);
      ctx.choose(ctx.p, ctx.hand(ctx.p), { min: n, max: n, title: 'discard2' }).forEach((u) => ctx.discard(u));
    },
  },
});
E['Card Destruction'] = spell({
  activate: {
    can: (ctx) => ctx.hand(ctx.p).filter((u) => u !== ctx.self).length > 0,
    resolve: (ctx) => {
      const n = [0, 1].map((pl) => ctx.hand(pl).length);
      for (const pl of [0, 1]) ctx.hand(pl).forEach((u) => ctx.discard(u));
      for (const pl of [ctx.p, opp(ctx)]) ctx.draw(pl, n[pl]);
    },
  },
});
E['Delinquent Duo'] = spell({
  activate: {
    can: (ctx) => ctx.lp(ctx.p) > 1000 && ctx.hand(opp(ctx)).length > 0,
    cost: (ctx) => ctx.payLp(ctx.p, 1000),
    resolve: (ctx) => {
      const h = ctx.hand(opp(ctx));
      if (!h.length) return;
      ctx.discard(h[ctx.random(h.length)]);
      const h2 = ctx.hand(opp(ctx));
      if (h2.length) ctx.discard(ctx.chooseOne(opp(ctx), h2, { title: 'discardChoice' }));
    },
  },
});

const damageSpell = (toOpp, toSelf = 0) => spell({ activate: { resolve: (ctx) => (ctx.damage(opp(ctx), toOpp), toSelf && ctx.damage(ctx.p, toSelf)) } });
E['Hinotama'] = damageSpell(500);
E['Sparks'] = damageSpell(200);
E['Final Flame'] = damageSpell(600);
E['Tremendous Fire'] = damageSpell(1000, 500);
const healSpell = (n) => spell({ activate: { resolve: (ctx) => ctx.gainLp(ctx.p, n) } });
E['Dian Keto the Cure Master'] = healSpell(1000);
E['Red Medicine'] = healSpell(500);
E["Goblin's Secret Remedy"] = healSpell(600);
E['Soul of the Pure'] = healSpell(800);

E['Dark Hole'] = spell({ activate: { can: (ctx) => ctx.allMonsters().length > 0, resolve: (ctx) => ctx.destroyAll(ctx.allMonsters()) } });
E['Raigeki'] = spell({ activate: { can: (ctx) => ctx.monsters(opp(ctx)).length > 0, resolve: (ctx) => ctx.destroyAll(ctx.monsters(opp(ctx))) } });
E['Heavy Storm'] = spell({
  activate: { can: (ctx) => [0, 1].some((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self).length), resolve: (ctx) => ctx.destroyAll([0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self))) },
});
E["Harpie's Feather Duster"] = spell({ activate: { can: (ctx) => ctx.spellTraps(opp(ctx)).length > 0, resolve: (ctx) => ctx.destroyAll(ctx.spellTraps(opp(ctx))) } });
E['Giant Trunade'] = spell({
  activate: {
    can: (ctx) => [0, 1].some((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self).length),
    resolve: (ctx) => [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self)).forEach((u) => ctx.toHand(u)),
  },
});
E['Fissure'] = spell({
  activate: {
    can: (ctx) => ctx.faceUpMonsters(opp(ctx)).length > 0,
    resolve: (ctx) => {
      const mons = ctx.faceUpMonsters(opp(ctx));
      if (!mons.length) return;
      const low = Math.min(...mons.map((u) => ctx.atk(u)));
      const tied = mons.filter((u) => ctx.atk(u) === low);
      ctx.destroy(tied.length === 1 ? tied[0] : ctx.chooseOne(ctx.p, tied, { title: 'destroyTarget' }));
    },
  },
});
E['Monster Reborn'] = spell({
  activate: {
    can: (ctx) => ctx.freeZones(ctx.p) > 0 && [0, 1].some((pl) => ctx.gy(pl).some((u) => ctx.revivable(u))),
    target: (ctx) => targetOne(ctx, [0, 1].flatMap((pl) => ctx.gy(pl).filter((u) => ctx.revivable(u))), 'reviveTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (ctx.card(t).loc !== 'gy' || ctx.freeZones(ctx.p) <= 0) return;
      ctx.specialSummon(t, ctx.p, choosePos(ctx));
    },
  },
});
E['Premature Burial'] = spell({
  isEquipLike: true,
  equip: { filter: anyMonster },
  activate: {
    can: (ctx) => ctx.lp(ctx.p) > 800 && ctx.freeZones(ctx.p) > 0 && ctx.gy(ctx.p).some((u) => ctx.revivable(u)),
    target: (ctx) => targetOne(ctx, ctx.gy(ctx.p).filter((u) => ctx.revivable(u)), 'reviveTarget'),
    cost: (ctx) => ctx.payLp(ctx.p, 800),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (ctx.card(t).loc !== 'gy' || ctx.freeZones(ctx.p) <= 0) return;
      ctx.specialSummon(t, ctx.p, 'atk');
      ctx.equip(ctx.self, t);
    },
  },
  triggers: [
    {
      on: 'leftField',
      noChain: true,
      cond: (ctx) => ctx.card(ctx.self).lastEquipTo,
      resolve: (ctx) => {
        const m = ctx.card(ctx.self).lastEquipTo;
        if (m && stillOnField(ctx, m)) ctx.destroy(m);
      },
    },
  ],
});
E['Call of the Haunted'] = trap({
  activate: {
    can: (ctx) => ctx.freeZones(ctx.p) > 0 && ctx.gy(ctx.p).some((u) => ctx.revivable(u)),
    target: (ctx) => targetOne(ctx, ctx.gy(ctx.p).filter((u) => ctx.revivable(u)), 'reviveTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (ctx.card(t).loc !== 'gy' || ctx.freeZones(ctx.p) <= 0) return;
      ctx.specialSummon(t, ctx.p, 'atk');
      ctx.card(ctx.self).flags.linked = t;
    },
  },
  triggers: [
    {
      on: 'leftField',
      noChain: true,
      cond: (ctx) => ctx.card(ctx.self).lastLinked,
      resolve: (ctx) => {
        const m = ctx.card(ctx.self).lastLinked;
        if (m && stillOnField(ctx, m)) ctx.destroy(m);
      },
    },
  ],
});
E['Change of Heart'] = spell({
  activate: {
    can: (ctx) => ctx.freeZones(ctx.p) > 0 && targetables(ctx, ctx.monsters(opp(ctx))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.monsters(opp(ctx))), 'stealTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (stillOnField(ctx, t) && ctx.card(t).ctrl === opp(ctx)) ctx.takeControl(t, ctx.p, ctx.turn());
    },
  },
});
E['Snatch Steal'] = spell({
  equip: { filter: anyMonster },
  activate: {
    can: (ctx) => ctx.freeZones(ctx.p) > 0 && targetables(ctx, ctx.faceUpMonsters(opp(ctx))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.faceUpMonsters(opp(ctx))), 'stealTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!isUpMonster(ctx, t) || ctx.card(t).ctrl !== opp(ctx)) return;
      ctx.equip(ctx.self, t);
      ctx.takeControl(t, ctx.p, null);
    },
  },
  triggers: [
    { on: 'standby', watch: true, cond: (ctx, ev) => ev.p === ctx.p && ctx.card(ctx.self).equipTo, resolve: (ctx) => ctx.gainLp(opp(ctx), 1000) },
    {
      on: 'leftField',
      noChain: true,
      cond: (ctx) => ctx.card(ctx.self).lastEquipTo,
      resolve: (ctx) => {
        const m = ctx.card(ctx.self).lastEquipTo;
        if (m && stillOnField(ctx, m) && ctx.card(m).ctrl !== ctx.card(m).owner) ctx.takeControl(m, ctx.card(m).owner, null);
      },
    },
  ],
});
E['Mystical Space Typhoon'] = spell({
  activate: {
    can: (ctx) => [0, 1].some((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self).length),
    target: (ctx) => targetOne(ctx, [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self)), 'destroyST'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (ctx.onField(t)) ctx.destroy(t);
    },
  },
});
E['De-Spell'] = spell({
  activate: {
    can: (ctx) => [0, 1].some((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self && (!ctx.isUp(u) || isSpell(ctx.def(u)))).length),
    target: (ctx) => targetOne(ctx, [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => u !== ctx.self && (!ctx.isUp(u) || isSpell(ctx.def(u))))), 'destroyST'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!ctx.onField(t)) return;
      if (!ctx.isUp(t)) ctx.reveal(t);
      if (isSpell(ctx.def(t))) ctx.destroy(t);
    },
  },
});
E['Remove Trap'] = spell({
  activate: {
    can: (ctx) => [0, 1].some((pl) => ctx.spellTraps(pl, (u) => ctx.isUp(u) && isTrap(ctx.def(u))).length),
    target: (ctx) => targetOne(ctx, [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => ctx.isUp(u) && isTrap(ctx.def(u)))), 'destroyST'),
    resolve: (ctx) => ctx.onField(ctx.link.targets[0]) && ctx.destroy(ctx.link.targets[0]),
  },
});
E['Tribute to the Doomed'] = spell({
  activate: {
    can: (ctx) => ctx.hand(ctx.p).filter((u) => u !== ctx.self).length > 0 && targetables(ctx, ctx.allMonsters()).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters()), 'destroyTarget'),
    cost: (ctx) => discardCost(ctx, 1),
    resolve: (ctx) => stillOnField(ctx, ctx.link.targets[0]) && ctx.destroy(ctx.link.targets[0]),
  },
});
E['Stop Defense'] = spell({
  activate: {
    can: (ctx) => targetables(ctx, ctx.monsters(opp(ctx), (u) => ctx.card(u).pos === 'def')).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.monsters(opp(ctx), (u) => ctx.card(u).pos === 'def')), 'changePos'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (stillOnField(ctx, t) && ctx.card(t).pos === 'def') ctx.changePos(t, 'atk');
    },
  },
});
E['Block Attack'] = spell({
  activate: {
    can: (ctx) => targetables(ctx, ctx.faceUpMonsters(opp(ctx), (u) => ctx.card(u).pos === 'atk')).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.faceUpMonsters(opp(ctx), (u) => ctx.card(u).pos === 'atk')), 'changePos'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (isUpMonster(ctx, t) && ctx.card(t).pos === 'atk') ctx.changePos(t, 'def');
    },
  },
});
E['Dark-Piercing Light'] = spell({
  activate: { can: (ctx) => ctx.monsters(opp(ctx), (u) => !ctx.isUp(u)).length > 0, resolve: (ctx) => ctx.monsters(opp(ctx), (u) => !ctx.isUp(u)).forEach((u) => ctx.flip(u, 'effect', true)) },
});
E['Nobleman of Crossout'] = spell({
  activate: {
    can: (ctx) => ctx.allMonsters((u) => !ctx.isUp(u)).length > 0,
    target: (ctx) => targetOne(ctx, ctx.allMonsters((u) => !ctx.isUp(u)), 'destroyTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!stillOnField(ctx, t) || ctx.isUp(t)) return;
      const def = ctx.def(t);
      ctx.reveal(t);
      const flipMonster = !!E[def.name]?.triggers?.some((x) => x.on === 'flipped');
      ctx.destroy(t);
      if (ctx.card(t).loc === 'gy') ctx.banish(t);
      if (flipMonster) for (const pl of [0, 1]) ctx.deck(pl).filter((u) => ctx.def(u).name === def.name).forEach((u) => ctx.banish(u));
    },
  },
});
E['Nobleman of Extermination'] = spell({
  activate: {
    can: (ctx) => [0, 1].some((pl) => ctx.spellTraps(pl, (u) => !ctx.isUp(u)).length),
    target: (ctx) => targetOne(ctx, [0, 1].flatMap((pl) => ctx.spellTraps(pl, (u) => !ctx.isUp(u))), 'destroyST'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!ctx.onField(t) || ctx.isUp(t)) return;
      const def = ctx.def(t);
      ctx.reveal(t);
      ctx.destroy(t);
      if (ctx.card(t).loc === 'gy') ctx.banish(t);
      if (isTrap(def)) for (const pl of [0, 1]) ctx.deck(pl).filter((u) => ctx.def(u).name === def.name).forEach((u) => ctx.banish(u));
    },
  },
});
E['Swords of Revealing Light'] = spell({
  staysOnField: true,
  activate: {
    resolve: (ctx) => {
      ctx.monsters(opp(ctx), (u) => !ctx.isUp(u)).forEach((u) => ctx.flip(u, 'effect', true));
      ctx.card(ctx.self).counters = 0;
    },
  },
  lockAttacks: (ctx, attacker) => ctx.card(attacker).ctrl === opp(ctx),
  triggers: [
    {
      on: 'endPhase',
      watch: true,
      noChain: true,
      cond: (ctx, ev) => ev.p === opp(ctx),
      resolve: (ctx) => {
        const c = ctx.card(ctx.self);
        c.counters += 1;
        ctx.emit('counter', { uid: ctx.self, n: c.counters });
        if (c.counters >= 3) ctx.destroy(ctx.self);
      },
    },
  ],
});
E['Messenger of Peace'] = spell({
  activate: { resolve: () => {} },
  lockAttacks: (ctx, attacker) => ctx.atk(attacker) >= 1500,
  triggers: [
    {
      on: 'standby',
      watch: true,
      cond: (ctx, ev) => ev.p === ctx.p,
      resolve: (ctx) => {
        if (ctx.lp(ctx.p) > 100 && ctx.yesNo(ctx.p, 'payKeep', { amount: 100, uid: ctx.self })) ctx.payLp(ctx.p, 100);
        else ctx.destroy(ctx.self);
      },
    },
  ],
});
E['Scapegoat'] = spell({
  activate: {
    can: (ctx) => ctx.freeZones(ctx.p) >= 4,
    resolve: (ctx) => {
      if (ctx.freeZones(ctx.p) < 4) return;
      for (let i = 0; i < 4; i++) ctx.createToken(ctx.p, 'Sheep Token', 'def');
      ctx.flags(ctx.p).summonLockTurn = ctx.turn();
    },
  },
});
E['Graceful Dice'] = spell({
  activate: {
    can: (ctx) => ctx.faceUpMonsters(ctx.p).length > 0,
    resolve: (ctx) => {
      const n = ctx.die();
      ctx.faceUpMonsters(ctx.p).forEach((u) => ctx.addMod(u, untilTurn(100 * n, 100 * n)));
    },
  },
});
E['Rush Recklessly'] = spell({
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), 'boostTarget'),
    resolve: (ctx) => isUpMonster(ctx, ctx.link.targets[0]) && ctx.addMod(ctx.link.targets[0], untilTurn(700, 0)),
  },
});
E['Limiter Removal'] = spell({
  activate: {
    can: (ctx) => ctx.faceUpMonsters(ctx.p, (u) => ctx.def(u).race === 'Machine').length > 0,
    resolve: (ctx) => {
      const ms = ctx.faceUpMonsters(ctx.p, (u) => ctx.def(u).race === 'Machine');
      ms.forEach((u) => {
        ctx.addMod(u, untilTurn(ctx.atk(u), 0));
        ctx.destroyAtEnd(u);
      });
    },
  },
});
E['Card of Safe Return'] = spell({
  activate: { resolve: () => {} },
  triggers: [{ on: 'summoned', watch: true, cond: (ctx, ev) => ev.from === 'gy' && ev.p === ctx.p && ctx.card(ev.uid).owner === ctx.p, resolve: (ctx) => ctx.draw(ctx.p, 1) }],
});
E['The Flute of Summoning Dragon'] = spell({
  activate: {
    can: (ctx) => ctx.allMonsters((u) => ctx.isUp(u) && ctx.def(u).name === 'Lord of D.').length > 0 && ctx.freeZones(ctx.p) > 0 && ctx.hand(ctx.p).some((u) => ctx.def(u).race === 'Dragon' && isMonster(ctx.def(u))),
    resolve: (ctx) => {
      const opts = ctx.hand(ctx.p).filter((u) => isMonster(ctx.def(u)) && ctx.def(u).race === 'Dragon' && ctx.def(u).frame !== 'fusion' && !E[ctx.def(u).name]?.specialOnly);
      const max = Math.min(2, ctx.freeZones(ctx.p), opts.length);
      if (!max) return;
      ctx.choose(ctx.p, opts, { min: 1, max, title: 'fluteDragons' }).forEach((u) => ctx.specialSummon(u, ctx.p, 'atk'));
    },
  },
});

// Polymerization: choose a Fusion Monster, then its exact materials from hand
// or your side of the field.
function fusionOptions(ctx) {
  const pool = [...ctx.hand(ctx.p).filter((u) => u !== ctx.self), ...ctx.monsters(ctx.p)];
  const out = [];
  for (const f of ctx.d.players[ctx.p].extra) {
    const mats = fusionMaterials(ctx.def(f));
    if (!mats) continue;
    const used = new Set();
    let ok = true;
    for (const id of mats) {
      const m = pool.find((u) => !used.has(u) && ctx.card(u).id === id);
      if (!m) {
        ok = false;
        break;
      }
      used.add(m);
    }
    const freesZone = [...used].some((u) => ctx.card(u).loc === 'mz');
    if (ok && (ctx.freeZones(ctx.p) > 0 || freesZone)) out.push(f);
  }
  return out;
}
E['Polymerization'] = spell({
  activate: {
    can: (ctx) => fusionOptions(ctx).length > 0,
    resolve: (ctx) => {
      const opts = fusionOptions(ctx);
      if (!opts.length) return;
      const f = ctx.chooseOne(ctx.p, opts, { title: 'fusionPick' });
      const mats = fusionMaterials(ctx.def(f));
      const chosen = [];
      for (const id of mats) {
        const cands = [...ctx.hand(ctx.p).filter((u) => u !== ctx.self), ...ctx.monsters(ctx.p)].filter((u) => ctx.card(u).id === id && !chosen.includes(u));
        chosen.push(ctx.chooseOne(ctx.p, cands, { title: 'fusionMaterial', data: { id } }));
      }
      ctx.emit('fusion', { p: ctx.p, materials: chosen.slice(), result: f, id: ctx.card(f).id });
      chosen.forEach((u) => ctx.sendToGy(u, 'fusion'));
      const pos = choosePos(ctx);
      ctx.specialSummon(f, ctx.p, pos, true, 'fusion');
      ctx.markProper(f);
    },
  },
});

// Ritual Spells: Tribute monsters whose Levels total at least the Ritual
// Monster's Level, from hand or field.
function ritualSpell(monsterName) {
  const canDo = (ctx) => {
    const rit = ctx.hand(ctx.p).filter((u) => ctx.def(u).name === monsterName);
    if (!rit.length) return false;
    const lvl = cardByName(monsterName).level;
    const pool = [...ctx.hand(ctx.p).filter((u) => u !== ctx.self && !rit.includes(u)), ...ctx.monsters(ctx.p)].filter((u) => isMonster(ctx.def(u)));
    const total = pool.reduce((s, u) => s + ctx.level(u), 0);
    return total >= lvl && (ctx.freeZones(ctx.p) > 0 || ctx.monsters(ctx.p).length > 0);
  };
  return spell({
    activate: {
      can: canDo,
      resolve: (ctx) => {
        if (!canDo(ctx)) return;
        const rit = ctx.chooseOne(ctx.p, ctx.hand(ctx.p).filter((u) => ctx.def(u).name === monsterName), { title: 'ritualPick' });
        const lvl = ctx.def(rit).level;
        const pool = [...ctx.hand(ctx.p).filter((u) => u !== ctx.self && u !== rit), ...ctx.monsters(ctx.p)].filter((u) => isMonster(ctx.def(u)));
        let picks = [];
        for (let tries = 0; tries < 6; tries++) {
          picks = ctx.choose(ctx.p, pool, { min: 1, max: pool.length, title: 'ritualTributes', data: { level: lvl } });
          if (picks.reduce((s, u) => s + ctx.level(u), 0) >= lvl) break;
          picks = [];
        }
        if (!picks.length) return;
        picks.forEach((u) => ctx.sendToGy(u, 'tribute'));
        ctx.specialSummon(rit, ctx.p, choosePos(ctx), true, 'ritual');
        ctx.markProper(rit);
      },
    },
  });
}
for (const [spellName, monsterName] of Object.entries(RITUALS)) E[spellName] = ritualSpell(monsterName);

// Field Spells (2004 values).
E['Forest'] = fieldSpell([{ match: raceIs('Insect', 'Beast', 'Plant', 'Beast-Warrior'), atk: 200, def: 200 }]);
E['Wasteland'] = fieldSpell([{ match: raceIs('Dinosaur', 'Zombie', 'Rock'), atk: 200, def: 200 }]);
E['Mountain'] = fieldSpell([{ match: raceIs('Dragon', 'Winged Beast', 'Thunder'), atk: 200, def: 200 }]);
E['Sogen'] = fieldSpell([{ match: raceIs('Warrior', 'Beast-Warrior'), atk: 200, def: 200 }]);
E['Umi'] = fieldSpell([
  { match: raceIs('Fish', 'Sea Serpent', 'Thunder', 'Aqua'), atk: 200, def: 200 },
  { match: raceIs('Machine', 'Pyro'), atk: -200, def: -200 },
]);
E['Yami'] = fieldSpell([
  { match: raceIs('Fiend', 'Spellcaster'), atk: 200, def: 200 },
  { match: raceIs('Fairy'), atk: -200, def: -200 },
]);

// Equip Spells.
E['Legendary Sword'] = equipSpell(raceIs('Warrior'), { atk: 300, def: 300 });
E['Book of Secret Arts'] = equipSpell(raceIs('Spellcaster'), { atk: 300, def: 300 });
E['Dark Energy'] = equipSpell(raceIs('Fiend'), { atk: 300, def: 300 });
E['Beast Fangs'] = equipSpell(raceIs('Beast'), { atk: 300, def: 300 });
E['Electro-Whip'] = equipSpell(raceIs('Thunder'), { atk: 300, def: 300 });
E['Follow Wind'] = equipSpell(raceIs('Winged Beast'), { atk: 300, def: 300 });
E['Power of Kaishin'] = equipSpell(raceIs('Aqua'), { atk: 300, def: 300 });
E['Raise Body Heat'] = equipSpell(raceIs('Dinosaur'), { atk: 300, def: 300 });
E['Silver Bow and Arrow'] = equipSpell(raceIs('Fairy'), { atk: 300, def: 300 });
E['Vile Germs'] = equipSpell(raceIs('Plant'), { atk: 300, def: 300 });
E['Violet Crystal'] = equipSpell(raceIs('Zombie'), { atk: 300, def: 300 });
E['Mystical Moon'] = equipSpell(raceIs('Beast-Warrior'), { atk: 300, def: 300 });
E['Laser Cannon Armor'] = equipSpell(raceIs('Insect'), { atk: 300, def: 300 });
E['Machine Conversion Factory'] = equipSpell(raceIs('Machine'), { atk: 300, def: 300 });
E['Dragon Treasure'] = equipSpell(raceIs('Dragon'), { atk: 300, def: 300 });
E['Sword of Dark Destruction'] = equipSpell(attrIs('DARK'), { atk: 400, def: -200 });
E['Burning Spear'] = equipSpell(attrIs('FIRE'), { atk: 400, def: -200 });
E['Gust Fan'] = equipSpell(attrIs('WIND'), { atk: 400, def: -200 });
E['Steel Shell'] = equipSpell(attrIs('WATER'), { atk: 400, def: -200 });
E["Elf's Light"] = equipSpell(attrIs('LIGHT'), { atk: 400, def: -200 });
E['Salamandra'] = equipSpell(attrIs('FIRE'), { atk: 700 });
E['Lightning Blade'] = {
  ...equipSpell(raceIs('Warrior'), { atk: 800 }),
  aura: (ctx, uid) => (isUpMonster(ctx, uid) && ctx.def(uid).attr === 'WATER' && ctx.card(ctx.self).equipTo ? -500 : 0),
};
E['Horn of the Unicorn'] = {
  ...equipSpell(anyMonster, { atk: 700, def: 700 }),
  triggers: [{ on: 'toGyFromField', noChain: true, resolve: (ctx) => ctx.card(ctx.self).loc === 'gy' && ctx.toDeck(ctx.self, false) }],
};
E['Black Pendant'] = {
  ...equipSpell(anyMonster, { atk: 500 }),
  triggers: [{ on: 'toGyFromField', resolve: (ctx) => ctx.damage(opp(ctx), 500) }],
};
E['Malevolent Nuzzler'] = {
  ...equipSpell(anyMonster, { atk: 700 }),
  triggers: [
    {
      on: 'toGyFromField',
      optional: true,
      cond: (ctx) => ctx.lp(ctx.p) > 500,
      cost: (ctx) => ctx.payLp(ctx.p, 500),
      resolve: (ctx) => ctx.card(ctx.self).loc === 'gy' && ctx.toDeck(ctx.self, false),
    },
  ],
};
E['Axe of Despair'] = {
  ...equipSpell(anyMonster, { atk: 1000 }),
  triggers: [
    {
      on: 'toGyFromField',
      optional: true,
      cond: (ctx) => ctx.monsters(ctx.p).length > 0,
      cost: (ctx) => ctx.sendToGy(ctx.chooseOne(ctx.p, ctx.monsters(ctx.p), { title: 'tributeCost' }), 'tribute'),
      resolve: (ctx) => ctx.card(ctx.self).loc === 'gy' && ctx.toDeck(ctx.self, false),
    },
  ],
};
E['Megamorph'] = equipSpell(anyMonster, {
  atkFn: (ctx, uid) => {
    const base = ctx.def(uid).atk ?? 0;
    const mine = ctx.lp(ctx.p);
    const theirs = ctx.lp(opp(ctx));
    return mine < theirs ? base : mine > theirs ? -Math.ceil(base / 2) : 0;
  },
});
E['United We Stand'] = equipSpell(anyMonster, {
  atkFn: (ctx) => 800 * ctx.faceUpMonsters(ctx.p).length,
  defFn: (ctx) => 800 * ctx.faceUpMonsters(ctx.p).length,
});
E['Mage Power'] = equipSpell(anyMonster, {
  atkFn: (ctx) => 500 * ctx.spellTraps(ctx.p).length,
  defFn: (ctx) => 500 * ctx.spellTraps(ctx.p).length,
});
E['Stim-Pack'] = {
  ...equipSpell(anyMonster, { atkFn: (ctx) => 700 - 200 * (ctx.card(ctx.self).counters || 0) }),
  triggers: [
    {
      on: 'standby',
      watch: true,
      noChain: true,
      cond: (ctx, ev) => ev.p === ctx.p && ctx.card(ctx.self).equipTo,
      resolve: (ctx) => {
        ctx.card(ctx.self).counters = (ctx.card(ctx.self).counters || 0) + 1;
        ctx.emit('stat', { uid: ctx.card(ctx.self).equipTo });
      },
    },
  ],
};
E['7 Completed'] = {
  ...equipSpell(raceIs('Machine'), {}),
};
E['7 Completed'].equip.choice = (choice, stat) => (choice === stat ? 700 : 0);
E['7 Completed'].activate.resolve = (ctx) => {
  const t = ctx.link.targets[0];
  if (!isUpMonster(ctx, t) || ctx.def(t).race !== 'Machine') return;
  ctx.card(ctx.self).flags.choice = ctx.chooseOne(ctx.p, ['atk', 'def'], { kind: 'option', title: 'statChoice' });
  ctx.equip(ctx.self, t);
};

// ---------------------------------------------------------------------------
// Traps
// ---------------------------------------------------------------------------

const inWindow = (ctx, kind) => ctx.window()?.kind === kind || ctx.chainCtx?.window?.kind === kind;
const attackWindowFoe = (ctx) => inWindow(ctx, 'attack') && ctx.battle() && ctx.card(ctx.battle().attacker)?.ctrl === opp(ctx) && stillOnField(ctx, ctx.battle().attacker);
const summonedNow = (ctx, filter) => {
  const w = ctx.window();
  if (!w || w.kind !== 'summon') return [];
  return w.uids.filter((u) => isUpMonster(ctx, u) && filter(u, w));
};

E['Trap Hole'] = trap({
  activate: {
    can: (ctx) => summonedNow(ctx, (u, w) => ctx.card(u).ctrl === opp(ctx) && ['normal', 'tribute', 'flip'].includes(w.how) && ctx.atk(u) >= 1000 && ctx.canTarget(u)).length > 0,
    target: (ctx) => targetOne(ctx, summonedNow(ctx, (u, w) => ctx.card(u).ctrl === opp(ctx) && ['normal', 'tribute', 'flip'].includes(w.how) && ctx.atk(u) >= 1000 && ctx.canTarget(u)), 'destroyTarget'),
    resolve: (ctx) => stillOnField(ctx, ctx.link.targets[0]) && ctx.destroy(ctx.link.targets[0]),
  },
});
E['Torrential Tribute'] = trap({
  activate: { can: (ctx) => summonedNow(ctx, () => true).length > 0, resolve: (ctx) => ctx.destroyAll(ctx.allMonsters()) },
});
E['Chain Destruction'] = trap({
  activate: {
    can: (ctx) => summonedNow(ctx, (u) => ctx.atk(u) <= 2000 && ctx.canTarget(u)).length > 0,
    target: (ctx) => targetOne(ctx, summonedNow(ctx, (u) => ctx.atk(u) <= 2000 && ctx.canTarget(u)), 'chainTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!isUpMonster(ctx, t)) return;
      const pl = ctx.card(t).ctrl;
      const name = ctx.def(t).name;
      [...ctx.hand(pl), ...ctx.deck(pl)].filter((u) => ctx.def(u).name === name).forEach((u) => ctx.sendToGy(u, 'destroy'));
      ctx.shuffleDeck(pl);
    },
  },
});
E['Mirror Force'] = trap({
  activate: { can: (ctx) => attackWindowFoe(ctx), resolve: (ctx) => ctx.destroyAll(ctx.monsters(opp(ctx), (u) => ctx.card(u).pos === 'atk' && ctx.isUp(u))) },
});
E['Magic Cylinder'] = trap({
  activate: {
    can: (ctx) => attackWindowFoe(ctx) && ctx.canTarget(ctx.battle().attacker),
    target: (ctx) => ctx.link.targets.push(ctx.battle().attacker),
    resolve: (ctx) => {
      const a = ctx.link.targets[0];
      ctx.queueAttackStop();
      if (isUpMonster(ctx, a)) ctx.damage(opp(ctx), ctx.atk(a));
    },
  },
});
E['Negate Attack'] = trap({
  activate: {
    can: (ctx) => attackWindowFoe(ctx),
    resolve: (ctx) => {
      ctx.queueAttackStop();
      ctx.endBattle();
    },
  },
});
E['Enchanted Javelin'] = trap({
  activate: {
    can: (ctx) => attackWindowFoe(ctx),
    target: (ctx) => ctx.link.targets.push(ctx.battle().attacker),
    resolve: (ctx) => isUpMonster(ctx, ctx.link.targets[0]) && ctx.gainLp(ctx.p, ctx.atk(ctx.link.targets[0])),
  },
});
E['Waboku'] = trap({
  activate: {
    resolve: (ctx) => {
      const f = ctx.flags(ctx.p).flags;
      f.noBattleDamage = ctx.turn();
      f.noBattleDestroy = ctx.turn();
    },
  },
});
E['Reinforcements'] = trap({
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), 'boostTarget'),
    resolve: (ctx) => isUpMonster(ctx, ctx.link.targets[0]) && ctx.addMod(ctx.link.targets[0], untilTurn(500, 0)),
  },
});
E['Castle Walls'] = trap({
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), 'boostTarget'),
    resolve: (ctx) => isUpMonster(ctx, ctx.link.targets[0]) && ctx.addMod(ctx.link.targets[0], untilTurn(0, 500)),
  },
});
E['Skull Dice'] = trap({
  activate: {
    can: (ctx) => ctx.faceUpMonsters(opp(ctx)).length > 0,
    resolve: (ctx) => {
      const n = ctx.die();
      ctx.faceUpMonsters(opp(ctx)).forEach((u) => ctx.addMod(u, untilTurn(-100 * n, -100 * n)));
    },
  },
});
E['Backup Soldier'] = trap({
  activate: {
    can: (ctx) => ctx.gy(ctx.p).filter((u) => isMonster(ctx.def(u))).length >= 5 && ctx.gy(ctx.p).some((u) => ctx.def(u).frame === 'normal' && (ctx.def(u).atk ?? 0) <= 1500),
    resolve: (ctx) => {
      const opts = ctx.gy(ctx.p).filter((u) => ctx.def(u).frame === 'normal' && (ctx.def(u).atk ?? 0) <= 1500);
      ctx.choose(ctx.p, opts, { min: 1, max: 3, title: 'recoverUpTo3' }).forEach((u) => ctx.toHand(u));
    },
  },
});
E['Magic Jammer'] = trap({
  activate: {
    speed: 3,
    can: (ctx) => {
      const top = ctx.chainTop();
      return top && top.kind === 'card' && isSpell(cardById(top.id)) && top.p === opp(ctx) && ctx.hand(ctx.p).length > 0;
    },
    target: (ctx) => {
      ctx.link.data.neg = ctx.d.chain.length - 1;
    },
    cost: (ctx) => discardCost(ctx, 1),
    resolve: (ctx) => {
      const l = ctx.d.chain[ctx.link.data.neg];
      if (!l) return;
      ctx.negateLink(ctx.link.data.neg);
      if (ctx.onField(l.uid)) ctx.destroy(l.uid);
    },
  },
});
E['Seven Tools of the Bandit'] = trap({
  activate: {
    speed: 3,
    can: (ctx) => {
      const top = ctx.chainTop();
      return top && top.kind === 'card' && isTrap(cardById(top.id)) && top.p === opp(ctx) && ctx.lp(ctx.p) > 1000;
    },
    target: (ctx) => {
      ctx.link.data.neg = ctx.d.chain.length - 1;
    },
    cost: (ctx) => ctx.payLp(ctx.p, 1000),
    resolve: (ctx) => {
      const l = ctx.d.chain[ctx.link.data.neg];
      if (!l) return;
      ctx.negateLink(ctx.link.data.neg);
      if (ctx.onField(l.uid)) ctx.destroy(l.uid);
    },
  },
});
E['Metalmorph'] = trap({
  isEquipTrap: true,
  equip: {
    filter: anyMonster,
    atk: 300,
    def: 300,
    attackBonus: (ctx, target) => (ctx.isUp(target) ? Math.floor(ctx.atk(target) / 2) : 0),
  },
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), 'equipTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!isUpMonster(ctx, t)) return;
      const metal = [...ctx.hand(ctx.p), ...ctx.deck(ctx.p)].filter((u) => ctx.def(u).name === 'Red-Eyes Black Metal Dragon');
      if (ctx.def(t).name === 'Red-Eyes Black Dragon' && ctx.card(t).ctrl === ctx.p && metal.length && ctx.yesNo(ctx.p, 'metalmorph', { uid: t })) {
        ctx.sendToGy(t, 'tribute');
        const m = metal[0];
        ctx.specialSummon(m, ctx.p, 'atk', true, 'metal');
        ctx.markProper(m);
        if (ctx.card(m).loc === 'mz') ctx.shuffleDeck(ctx.p);
        ctx.sendToGy(ctx.self, 'resolved');
        return;
      }
      ctx.equip(ctx.self, t);
    },
  },
});
E['Ring of Destruction'] = trap({
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), 'destroyTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!isUpMonster(ctx, t)) return;
      const n = ctx.atk(t);
      ctx.destroy(t);
      ctx.damage(ctx.p, n);
      ctx.damage(opp(ctx), n);
    },
  },
});
E['Dust Tornado'] = trap({
  activate: {
    can: (ctx) => ctx.spellTraps(opp(ctx)).length > 0,
    target: (ctx) => targetOne(ctx, ctx.spellTraps(opp(ctx)), 'destroyST'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (ctx.onField(t)) ctx.destroy(t);
      const settable = ctx.hand(ctx.p).filter((u) => !isMonster(ctx.def(u)) && ctx.def(u).sub !== 'Field');
      if (settable.length && ctx.freeZones(ctx.p, 'sz') > 0 && ctx.yesNo(ctx.p, 'dustSet')) {
        ctx.setCard(ctx.chooseOne(ctx.p, settable, { title: 'setCard' }));
      }
    },
  },
});
E['Two-Pronged Attack'] = trap({
  activate: {
    can: (ctx) => ctx.monsters(ctx.p).length >= 2 && targetables(ctx, ctx.monsters(opp(ctx))).length > 0,
    target: (ctx) => {
      const mine = ctx.choose(ctx.p, targetables(ctx, ctx.monsters(ctx.p)), { min: 2, max: 2, title: 'destroyOwn2', cancel: true });
      ctx.link.targets.push(...mine);
      targetOne(ctx, targetables(ctx, ctx.monsters(opp(ctx))), 'destroyTarget');
    },
    resolve: (ctx) => ctx.link.targets.filter((u) => stillOnField(ctx, u)).forEach((u) => ctx.destroy(u)),
  },
});
E['Windstorm of Etaqua'] = trap({
  activate: {
    can: (ctx) => ctx.faceUpMonsters(opp(ctx)).length > 0,
    resolve: (ctx) => ctx.faceUpMonsters(opp(ctx)).forEach((u) => ctx.changePos(u, ctx.card(u).pos === 'atk' ? 'def' : 'atk')),
  },
});
E['Acid Trap Hole'] = trap({
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => !ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, ctx.allMonsters((u) => !ctx.isUp(u)), 'destroyTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (!stillOnField(ctx, t) || ctx.isUp(t)) return;
      ctx.flip(t, 'effect', true);
      if (ctx.defStat(t) <= 2000) ctx.destroy(t);
      else ctx.setFaceDown(t);
    },
  },
});
E['Gravity Bind'] = trap({ activate: { resolve: () => {} }, lockAttacks: (ctx, attacker) => ctx.level(attacker) >= 4 });
E['Spellbinding Circle'] = trap({
  activate: {
    can: (ctx) => targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))).length > 0,
    target: (ctx) => targetOne(ctx, targetables(ctx, ctx.allMonsters((u) => ctx.isUp(u))), 'bindTarget'),
    resolve: (ctx) => {
      const t = ctx.link.targets[0];
      if (isUpMonster(ctx, t)) ctx.card(ctx.self).flags.linked = t;
      else ctx.destroy(ctx.self);
    },
  },
  lockAttacks: (ctx, attacker) => ctx.card(ctx.self).flags.linked === attacker,
  lockPosition: (ctx, uid) => ctx.card(ctx.self).flags.linked === uid,
});
E['Dragon Capture Jar'] = trap({
  activate: { resolve: (ctx) => ctx.allMonsters((u) => isUpMonster(ctx, u) && ctx.def(u).race === 'Dragon' && ctx.card(u).pos === 'atk').forEach((u) => ctx.changePos(u, 'def')) },
  lockPosition: (ctx, uid) => isUpMonster(ctx, uid) && ctx.def(uid).race === 'Dragon',
  triggers: [
    {
      on: 'summoned',
      watch: true,
      noChain: true,
      cond: (ctx, ev) => ctx.def(ev.uid).race === 'Dragon',
      resolve: (ctx) => isUpMonster(ctx, ctx.event.uid) && ctx.card(ctx.event.uid).pos === 'atk' && ctx.changePos(ctx.event.uid, 'def'),
    },
  ],
});
E['Ceasefire'] = trap({
  activate: {
    can: (ctx) => ctx.allMonsters((u) => !ctx.isUp(u)).length > 0 || ctx.allMonsters((u) => ctx.isUp(u) && ctx.def(u).frame === 'effect').length > 0,
    resolve: (ctx) => {
      ctx.allMonsters((u) => !ctx.isUp(u)).forEach((u) => ctx.flip(u, 'effect', true));
      const n = ctx.allMonsters((u) => ctx.isUp(u) && ctx.def(u).frame === 'effect').length;
      ctx.damage(opp(ctx), 500 * n);
    },
  },
});
E['Jar of Greed'] = trap({ activate: { can: (ctx) => ctx.deck(ctx.p).length > 0, resolve: (ctx) => ctx.draw(ctx.p, 1) } });
E['Gift of The Mystical Elf'] = trap({ activate: { resolve: (ctx) => ctx.gainLp(ctx.p, 300 * ctx.allMonsters().length) } });
E['Numinous Healer'] = trap({ activate: { resolve: (ctx) => ctx.gainLp(ctx.p, 1000 + 500 * ctx.gy(ctx.p).filter((u) => ctx.def(u).name === 'Numinous Healer').length) } });
E['Minor Goblin Official'] = trap({
  activate: { can: (ctx) => ctx.lp(opp(ctx)) <= 3000, resolve: () => {} },
  triggers: [{ on: 'standby', watch: true, cond: (ctx, ev) => ev.p === opp(ctx) && ctx.lp(opp(ctx)) <= 3000, resolve: (ctx) => ctx.damage(opp(ctx), 500) }],
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let byId = null;
function buildIndex() {
  byId = new Map();
  for (const [name, e] of Object.entries(E)) {
    const c = cardByName(name);
    if (c) byId.set(c.id, e);
  }
}

export function effectOf(id) {
  if (!byId) buildIndex();
  return byId.get(id) || null;
}

export function resetEffectIndex() {
  byId = null;
}

export const EFFECT_NAMES = () => Object.keys(E);

// A fusion monster has an effect when its text continues past the materials line.
function fusionHasEffect(c) {
  // Parenthesised reminder lines (archetype notes) are not effects.
  return c.desc
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !/^\(.*\)$/.test(l)).length > 0;
}

// Support status of a card: what the engine can run today.
//   'normal'  — Normal Monster / effectless Fusion or Ritual / token: nothing to run
//   'effect'  — executable effect implemented here
//   'unsupported' — card text not yet executable; locked out of play
export function supportStatus(c) {
  if (!c) return 'unsupported';
  if (c.token) return 'normal';
  if (effectOf(c.id)) return 'effect';
  if (c.kind === 'monster') {
    if (c.frame === 'normal') return 'normal';
    if (c.frame === 'fusion') return fusionMaterials(c) && !fusionHasEffect(c) ? 'normal' : 'unsupported';
    if (c.frame === 'ritual') return c.name === 'Relinquished' ? 'unsupported' : 'normal';
    return 'unsupported';
  }
  return 'unsupported';
}
