// The duel interface over the arena: HUD, hand, phase controls, action sheet,
// chain / choice prompts, card details and short feedback (banners, toasts,
// damage numbers, Joey's lines). It reads the duel to decide what to OFFER and
// only ever acts through onAct(action) with an action from getActions().
import { h, icon, atlasCell, cardImg, fill } from './dom.js';
import { T, JOEY_LINES } from '../i18n.js';
import { cardById, isMonster, isSpell, isTrap, ATTR_COLORS } from '../../engine/cards.js';
import { getActions, explainIllegal, actionKey } from '../../engine/duel.js';
import { supportStatus, effectOf } from '../../engine/effects.js';

const PHASE_ORDER = ['draw', 'standby', 'main1', 'battle', 'main2', 'end'];

export function createDuelUI({ root, arena, atlases, onAct, onMenu, getCreatureCanvas }) {
  // ---- structure -----------------------------------------------------------
  const labels = h('div', { class: 'label-layer' });
  const floatLayer = h('div', { class: 'float-layer' });
  const oppPortrait = atlasCell(atlases.portraits, 'confident', 'portrait');
  const oppLp = h('span', { class: 'lp-value' }, '8000');
  const oppHandCount = h('span', { class: 'chip-num' }, '0');
  const oppDeckCount = h('span', { class: 'chip-num' }, '0');
  const speech = h('div', { class: 'speech', hidden: true });
  const rankStars = h('span', { class: 'pip-row rank-pips' });
  const menuBtn = h('button', { class: 'icon-btn', 'aria-label': 'menu', onclick: () => onMenu() }, icon('menu'));
  const top = h(
    'div',
    { class: 'hud-top' },
    h('div', { class: 'badge-card opp' }, h('div', { class: 'portrait-wrap' }, oppPortrait), h('div', { class: 'badge-body' }, h('div', { class: 'badge-name' }, h('span', {}, T.joey), rankStars), h('div', { class: 'lp-line' }, atlasCell(atlases.icons, 'life', 'lp-icon'), oppLp)), h('div', { class: 'badge-chips' }, h('span', { class: 'chip' }, h('span', { class: 'mini-card' }), oppHandCount), h('span', { class: 'chip' }, atlasCell(atlases.icons, 'deck', 'chip-icon'), oppDeckCount))),
    menuBtn
  );
  const oppHand = h('div', { class: 'opp-hand' });
  const rail = h('div', { class: 'phase-rail' }, ...PHASE_ORDER.map((p) => h('span', { class: 'phase-pill', 'data-p': p }, T.phaseShort[p])));
  const myLp = h('span', { class: 'lp-value' }, '8000');
  const myDeckCount = h('span', { class: 'chip-num' }, '0');
  const phaseBtn = h('button', { class: 'phase-btn', onclick: () => phaseAction(0) }, h('span', { class: 'control-label' }, ''));
  const phaseAlt = h('button', { class: 'phase-alt', onclick: () => phaseAction(1) }, h('span', { class: 'control-label' }, T.endTurn));
  const bottom = h(
    'div',
    { class: 'hud-bottom' },
    h('div', { class: 'badge-card me' }, atlasCell(atlases.icons, 'player_badge', 'portrait me'), h('div', { class: 'badge-body' }, h('div', { class: 'lp-line' }, atlasCell(atlases.icons, 'life', 'lp-icon'), myLp), h('div', { class: 'badge-chips' }, h('span', { class: 'chip' }, atlasCell(atlases.icons, 'deck', 'chip-icon'), myDeckCount)))),
    h('div', { class: 'phase-actions' }, phaseAlt, phaseBtn)
  );
  const hand = h('div', { class: 'hand-tray bleed-bottom' });
  const sheet = h('div', { class: 'action-sheet', hidden: true });
  const prompt = h('div', { class: 'prompt-panel', hidden: true });
  const toastEl = h('div', { class: 'toast', hidden: true });
  const bannerEl = h('div', { class: 'banner', hidden: true });
  const actBanner = h('div', { class: 'act-banner', hidden: true });
  const coinEl = h('div', { class: 'coin-overlay', hidden: true });
  const callout = h('div', { class: 'callout', hidden: true });
  const detail = h('div', { class: 'detail-scrim', hidden: true, onclick: (e) => e.target === detail && closeDetail() });
  const ui = h('div', { class: 'duel-ui safe-area' }, top, oppHand, speech, rail, bannerEl, actBanner, callout, h('div', { class: 'spacer' }), sheet, prompt, toastEl, bottom, hand);
  root.append(labels, floatLayer, ui, coinEl, detail);

  // ---- local UI state (not rules state) ------------------------------------
  let duel = null;
  let canAct = false;
  let legal = [];
  let legalVersion = -1;
  let selected = null; // { uid, from: 'hand'|'field' }
  let targeting = null; // attacker uid
  let chosen = new Set();
  let promptKey = '';
  let timers = { toast: 0, banner: 0, act: 0, speech: 0, callout: 0, coin: 0, shake: 0 };
  let shakeAmp = 0;
  const lpShown = [8000, 8000];
  const lpTarget = [8000, 8000];
  let view = null;
  const plates = new Map();

  // ---- input on the arena -----------------------------------------------
  let press = null;
  arena.canvas.addEventListener('pointerdown', (e) => {
    press = { x: e.offsetX, y: e.offsetY, t: 0, id: e.pointerId, long: false };
  });
  arena.canvas.addEventListener('pointerup', (e) => {
    if (!press) return;
    const p = press;
    press = null;
    if (p.long) return;
    const hit = arena.pick(e.offsetX, e.offsetY);
    onFieldTap(hit);
  });
  arena.canvas.addEventListener('pointercancel', () => (press = null));

  function onFieldTap(hit) {
    if (!duel) return;
    if (!hit) return clearSelection();
    if (hit.kind === 'zone' && ['gy', 'deck', 'extra'].includes(hit.loc)) {
      if (hit.loc === 'gy') return showPile(hit.p, 'gy');
      if (hit.loc === 'extra' && hit.p === 0) return showPile(0, 'extra');
      return;
    }
    const uid = hit.kind === 'card' ? hit.uid : view?.zones && Object.keys(view.zones).find((u) => {
      const z = view.zones[u];
      return z.p === hit.p && z.loc === hit.loc && z.i === hit.i;
    });
    if (!uid || !duel.cards[uid]) return clearSelection();
    if (targeting) {
      const a = legal.find((x) => x.type === 'attack' && x.uid === targeting && x.target === uid);
      if (a) {
        act(a);
        return;
      }
      if (duel.cards[uid].ctrl === 1) return toast('illegal');
    }
    const c = duel.cards[uid];
    if (c.ctrl === 0 && canAct && !duel.pending) {
      selected = { uid, from: 'field' };
      targeting = null;
      buildSheet();
    } else openDetail(uid);
  }

  // ---- public feedback API (presenter calls) -----------------------------
  function onSnap(snap) {
    view = snap;
    lpTarget[0] = snap.lp[0];
    lpTarget[1] = snap.lp[1];
    myDeckCount.textContent = snap.deck[0];
    oppDeckCount.textContent = snap.deck[1];
    oppHandCount.textContent = snap.hand[1];
    renderOppHand(snap.hand[1]);
    renderHand(snap.hand[0]);
    for (const el of rail.children) {
      el.classList.toggle('on', el.dataset.p === snap.phase);
      el.classList.toggle('joey', snap.turnPlayer === 1);
    }
  }
  function onDraw() {}
  function onPhase(phase) {
    for (const el of rail.children) el.classList.toggle('on', el.dataset.p === phase);
  }
  function banner(key) {
    bannerEl.textContent = key === 'exodia' ? T.reasons.exodia : T[key];
    bannerEl.className = `banner ${key === 'joeyTurn' ? 'joey' : ''}`;
    bannerEl.hidden = false;
    timers.banner = 0.9;
  }
  function activation(ev, def) {
    fill(actBanner, h('img', { src: cardImg(def.id), alt: '' }), h('div', { class: 'act-text' }, h('div', { class: 'act-who' }, ev.p === 0 ? T.you : T.joey), h('div', { class: 'act-name', dir: 'ltr' }, def.name)));
    actBanner.className = `act-banner ${isTrap(def) ? 'trap' : isSpell(def) ? 'spell' : 'monster'} ${ev.p === 1 ? 'opp' : ''}`;
    actBanner.hidden = false;
    timers.act = 1.15;
  }
  function monsterCallout(uid, def) {
    if (!def) return;
    fill(callout, h('div', { class: 'callout-name', dir: 'ltr' }, def.name), h('div', { class: 'callout-stats' }, h('span', { class: 'atk' }, `ATK ${def.atk ?? '?'}`), h('span', { class: 'def' }, `DEF ${def.def ?? '?'}`)));
    callout.style.setProperty('--attr', ATTR_COLORS[def.attr] || '#ffd27a');
    callout.hidden = false;
    timers.callout = 1.4;
  }
  let lastLine = '';
  function joeySays(kind) {
    const lines = JOEY_LINES[kind];
    if (!lines) return;
    let line = lines[Math.floor(Math.random() * lines.length)];
    if (line === lastLine && lines.length > 1) line = lines[(lines.indexOf(line) + 1) % lines.length];
    lastLine = line;
    speech.textContent = line;
    speech.hidden = false;
    timers.speech = 2.4;
    const face = { summonBig: 'confident', trap: 'confident', hurt: 'rattled', hit: 'fired_up', low: 'rattled', coin: 'fired_up', win: 'fired_up', lose: 'defeated', start: 'confident' }[kind] || 'confident';
    setFace(face);
  }
  function setFace(name) {
    const cell = atlasCell(atlases.portraits, name, 'portrait');
    oppPortrait.style.cssText = cell.style.cssText;
  }
  function toast(key, extra) {
    const msg = T.illegal[key] || (key === 'negated' ? `تم إبطال ${extra || ''}` : key === 'attackNegated' ? 'تم إبطال الهجوم' : key);
    toastEl.textContent = msg;
    toastEl.hidden = false;
    timers.toast = 1.8;
  }
  let aimLine = null;
  function aim(uid, target, p) {
    if (!uid) {
      arena.highlight([]);
      return;
    }
    if (target) {
      const z = view?.zones?.[target];
      if (z) arena.highlight([{ p: z.p, loc: 'mz', i: z.i, color: '#ff5a4d' }]);
    } else arena.highlight([]);
    void aimLine;
    void p;
  }
  function lpChange(p, delta, final) {
    lpTarget[p] = final;
    const pos = p === 0 ? myLp.getBoundingClientRect() : oppLp.getBoundingClientRect();
    const rootR = root.getBoundingClientRect();
    floatText(`${delta > 0 ? '+' : ''}${delta}`, pos.left - rootR.left + pos.width / 2, pos.top - rootR.top + (p === 0 ? -10 : pos.height + 18), delta < 0 ? 'dmg' : 'heal');
    (p === 0 ? myLp : oppLp).parentElement.classList.add(delta < 0 ? 'hurt' : 'healed');
    timers[`lp${p}`] = 0.6;
    if (p === 1 && final < 2000 && final > 0) joeySays('low');
  }
  function floatText(text, x, y, cls) {
    const el = h('div', { class: `float-text ${cls}`, style: `left:${x}px;top:${y}px` }, text);
    floatLayer.append(el);
    floatTimers.push({ el, t: 1.1 });
  }
  const floatTimers = [];
  function shake(amount) {
    shakeAmp = Math.max(shakeAmp, amount);
    timers.shake = 0.35;
  }
  function battleNumbers(ev, pos3) {
    const s = arena.project(pos3);
    for (const p of [0, 1]) if (ev.damage[p]) floatText(`-${ev.damage[p]}`, s.x, s.y - 20 - p * 26, 'dmg big');
  }
  function reveal(id, kind) {
    const def = cardById(id);
    if (!def) return;
    fill(actBanner, h('img', { src: cardImg(id), alt: '' }), h('div', { class: 'act-text' }, h('div', { class: 'act-who' }, kind === 'fusion' ? 'دمج' : 'كشف'), h('div', { class: 'act-name', dir: 'ltr' }, def.name)));
    actBanner.className = `act-banner ${kind === 'fusion' ? 'fusion' : 'monster'}`;
    actBanner.hidden = false;
    timers.act = 1.0;
  }
  function coin(result) {
    fill(coinEl, atlasCell(atlases.icons, result === 'heads' ? 'coin_heads' : 'coin_tails', 'coin-icon spin'), h('div', { class: 'coin-text' }, result === 'heads' ? T.heads : T.tails));
    coinEl.hidden = false;
    timers.coin = 1.4;
  }
  function die(n) {
    fill(coinEl, atlasCell(atlases.icons, 'die', 'coin-icon tumble'), h('div', { class: 'coin-text die-num' }, String(n)));
    coinEl.hidden = false;
    timers.coin = 1.4;
  }
  function statPulse(uid) {
    const pl = plates.get(uid);
    if (pl) {
      pl.el.classList.remove('pulse');
      void pl.el.offsetWidth;
      pl.el.classList.add('pulse');
    }
  }

  // ---- hand --------------------------------------------------------------
  let handKey = '';
  function renderHand(uids) {
    const key = uids.join(',');
    if (key === handKey) return;
    handKey = key;
    fill(hand, 
      ...uids.map((uid, i) => {
        const id = duel?.cards[uid]?.id;
        const el = h('button', { class: 'hand-card', 'data-uid': uid, style: `--i:${i};--n:${uids.length}` }, h('img', { src: cardImg(id), alt: cardById(id)?.name || '', draggable: 'false' }));
        let t0 = null;
        let longFired = false;
        el.addEventListener('pointerdown', () => {
          t0 = 0;
          longFired = false;
          holdTarget = { uid, el, fire: () => ((longFired = true), openDetail(uid)) };
        });
        el.addEventListener('pointerup', () => {
          holdTarget = null;
          if (longFired) return;
          void t0;
          onHandTap(uid);
        });
        el.addEventListener('pointerleave', () => (holdTarget = null));
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        return el;
      })
    );
    updateHandSelection();
  }
  let holdTarget = null;
  let holdT = 0;
  function renderOppHand(n) {
    if (oppHand.childElementCount === n) return;
    fill(oppHand, ...Array.from({ length: n }, () => h('span', { class: 'opp-card' })));
  }
  function onHandTap(uid) {
    if (!duel) return;
    if (selected?.uid === uid) return clearSelection();
    selected = { uid, from: 'hand' };
    targeting = null;
    buildSheet();
  }
  function updateHandSelection() {
    for (const el of hand.children) {
      el.classList.toggle('sel', selected?.uid === el.dataset.uid);
      const playableNow = legal.some((a) => a.uid === el.dataset.uid && a.type !== 'attack');
      el.classList.toggle('can', canAct && playableNow);
    }
  }

  // ---- action sheet -------------------------------------------------------
  function clearSelection() {
    selected = null;
    targeting = null;
    sheet.hidden = true;
    arena.highlight([]);
    updateHandSelection();
  }
  function buildSheet() {
    if (!selected || !duel) return clearSelection();
    const uid = selected.uid;
    const def = cardById(duel.cards[uid].id);
    const mine = legal.filter((a) => a.uid === uid);
    const btns = [];
    const add = (label, fn, cls = '') => btns.push(h('button', { class: `control-btn sheet-btn ${cls}`, onclick: fn }, h('span', { class: 'control-label' }, label)));
    const byType = (t) => mine.filter((a) => a.type === t);
    for (const a of byType('summon')) add(T.actions.summon, () => act(a), 'primary');
    for (const a of byType('activate')) add(a.eff === 'ign' ? 'تأثير' : T.actions.activate, () => act(a), 'primary');
    for (const a of byType('flip')) add(T.actions.flip, () => act(a), 'primary');
    const attacks = byType('attack');
    if (attacks.length) {
      const direct = attacks.find((a) => a.target === null);
      if (attacks.some((a) => a.target)) add(T.actions.attack, () => startTargeting(uid), 'danger');
      if (direct) add(T.actions.direct, () => act(direct), 'danger');
    }
    for (const a of byType('set')) add(T.actions.set, () => act(a));
    for (const a of byType('setST')) add(T.actions.setST, () => act(a));
    for (const a of byType('position')) add(T.actions.position, () => act(a));
    const reason = !mine.length ? whyNot(uid, def) : null;
    fill(sheet, 
      h('div', { class: 'sheet-head' }, h('span', { class: 'sheet-name', dir: 'ltr' }, def.name), h('button', { class: 'icon-btn small', 'aria-label': 'info', onclick: () => openDetail(uid) }, icon('info'))),
      reason ? h('div', { class: 'sheet-reason' }, reason) : null,
      h('div', { class: 'controls-row sheet-row' }, ...btns)
    );
    sheet.hidden = false;
    updateHandSelection();
  }
  function whyNot(uid, def) {
    if (!canAct) return T.illegal.waitOpponent;
    const c = duel.cards[uid];
    let probe;
    if (c.loc === 'hand') probe = isMonster(def) ? { type: 'summon', uid } : { type: 'activate', uid, eff: 0 };
    else if (c.loc === 'mz') probe = duel.phase === 'battle' ? { type: 'attack', uid, target: null } : { type: 'position', uid };
    else probe = { type: 'activate', uid, eff: 0 };
    return T.illegal[explainIllegal(duel, 0, probe)] || T.illegal.illegal;
  }
  function startTargeting(uid) {
    targeting = uid;
    const targets = legal.filter((a) => a.type === 'attack' && a.uid === uid && a.target);
    arena.highlight(targets.map((a) => ({ ...zoneOf(a.target), color: '#ff5a4d' })));
    fill(sheet, h('div', { class: 'sheet-reason' }, 'اختر وحش الخصم المراد مهاجمته'), h('div', { class: 'controls-row sheet-row' }, h('button', { class: 'control-btn sheet-btn', onclick: clearSelection }, h('span', { class: 'control-label' }, T.cancel))));
  }
  function zoneOf(uid) {
    const z = view?.zones?.[uid];
    return z ? { p: z.p, loc: z.loc, i: z.i } : { p: 1, loc: 'mz', i: 0 };
  }
  function act(a) {
    clearSelection();
    onAct(a);
  }

  // ---- phase controls ------------------------------------------------------
  function phaseAction(which) {
    if (!canAct || duel.pending) return;
    const moves = legal.filter((a) => a.type === 'phase');
    let a;
    if (which === 0) a = moves.find((m) => m.to === (duel.phase === 'main1' ? 'battle' : duel.phase === 'battle' ? 'main2' : 'end')) || moves.find((m) => m.to === 'end');
    else a = moves.find((m) => m.to === 'end');
    if (a) act(a);
  }
  function renderPhaseButtons() {
    const show = canAct && !duel?.pending && duel?.turnPlayer === 0;
    phaseBtn.disabled = !show;
    phaseBtn.classList.toggle('idle', !show);
    let label = T.endTurn;
    if (duel?.phase === 'main1' && legal.some((a) => a.type === 'phase' && a.to === 'battle')) label = T.toBattle;
    else if (duel?.phase === 'battle') label = T.toMain2;
    phaseBtn.firstChild.textContent = label;
    phaseAlt.hidden = !(show && duel.phase === 'main1' && label === T.toBattle);
  }

  // ---- prompts ---------------------------------------------------------------
  function renderPrompt() {
    const pd = duel?.pending;
    const mine = canAct && pd && pd.player === 0;
    const key = mine ? `${pd.type}|${pd.title}|${pd.options?.join(',')}|${pd.chainTop || ''}|${duel.seq}` : '';
    if (key === promptKey) return;
    promptKey = key;
    chosen = new Set();
    if (!mine) {
      prompt.hidden = true;
      return;
    }
    clearSelection();
    if (pd.type === 'respond') buildRespond(pd);
    else buildChoose(pd);
    prompt.hidden = false;
  }
  function contextLine(pd) {
    const w = pd.window || {};
    if (w.kind === 'attack') {
      const a = duel.cards[w.attacker];
      return `${T.joey} يهاجم بـ ${cardById(a?.id)?.name || '?'}`;
    }
    if (w.kind === 'summon') return `${w.p === 1 ? T.joey : T.you} استدعى ${cardById(duel.cards[w.uids[0]]?.id)?.name || ''}`;
    if (w.kind === 'phase') return `${T.joey}: ${T.phases[w.phase]}`;
    const top = duel.chain[duel.chain.length - 1];
    if (top) return `${top.p === 1 ? T.joey : T.you} فعّل ${cardById(top.id)?.name || ''}`;
    return '';
  }
  function buildRespond(pd) {
    const opts = legal.filter((a) => a.type === 'activate');
    fill(prompt, 
      h('div', { class: 'prompt-title' }, T.respondTitle),
      h('div', { class: 'prompt-sub', dir: 'auto' }, contextLine(pd)),
      h('div', { class: 'card-row' }, ...opts.map((a) => cardChoice(a.uid, () => onAct(a), false))),
      h('div', { class: 'controls-row' }, h('button', { class: 'control-btn', onclick: () => onAct({ type: 'pass' }) }, h('span', { class: 'control-label' }, T.pass)))
    );
  }
  function optionLabel(o, pd) {
    if (o === 'yes') return T.yes;
    if (o === 'no') return T.no;
    if (o === 'atk') return pd.title === 'statChoice' ? 'ATK +700' : T.atk;
    if (o === 'def') return pd.title === 'statChoice' ? 'DEF +700' : T.def;
    if (o === 'stop') return T.stop;
    if (o === 'direct') return T.directOpt;
    return null;
  }
  function buildChoose(pd) {
    const title = T.choose[pd.title] || T.choose.choose;
    const confirm = h('button', { class: 'control-btn primary', onclick: () => submitChoice(pd) }, h('span', { class: 'control-label' }, T.confirm));
    const counter = h('span', { class: 'prompt-count' });
    const refresh = () => {
      confirm.disabled = chosen.size < pd.min || chosen.size > pd.max;
      counter.textContent = pd.max > 1 ? `${chosen.size} / ${pd.max}` : '';
    };
    const items = pd.options.map((o) => {
      const lbl = optionLabel(o, pd);
      if (lbl) {
        return h('button', { class: 'control-btn option-btn', onclick: () => onAct({ type: 'choose', values: [o] }) }, h('span', { class: 'control-label' }, lbl));
      }
      return cardChoice(o, (el) => {
        if (pd.max === 1) return onAct({ type: 'choose', values: [o] });
        if (chosen.has(o)) chosen.delete(o);
        else if (chosen.size < pd.max) chosen.add(o);
        el.classList.toggle('sel', chosen.has(o));
        refresh();
      });
    });
    const multi = pd.max > 1 || (pd.min === 0 && pd.kind === 'card');
    const extra = [];
    if (pd.data?.level) extra.push(h('span', { class: 'prompt-count' }, `★ ${pd.data.level}`));
    fill(prompt, 
      h('div', { class: 'prompt-title' }, title, counter, ...extra),
      h('div', { class: pd.kind === 'option' && items.every((x) => x.tagName === 'BUTTON' && x.classList.contains('option-btn')) ? 'controls-row' : 'card-row' }, ...items),
      multi || pd.cancel ? h('div', { class: 'controls-row' }, pd.cancel ? h('button', { class: 'control-btn', onclick: () => onAct({ type: 'cancel' }) }, h('span', { class: 'control-label' }, T.cancel)) : null, multi ? confirm : null) : null
    );
    refresh();
  }
  function submitChoice(pd) {
    if (chosen.size < pd.min || chosen.size > pd.max) return;
    onAct({ type: 'choose', values: [...chosen] });
  }
  function cardChoice(uid, onPick, selectable = true) {
    const c = duel.cards[uid];
    const known = c.ctrl === 0 || c.owner === 0 || c.faceUp || c.loc === 'gy' || c.loc === 'ban';
    const id = c.id;
    const el = h('button', { class: 'choice-card' }, h('img', { src: known ? cardImg(id) : arena.backUrl, alt: known ? cardById(id)?.name : '' }), h('span', { class: 'choice-side' }, c.ctrl === 1 && c.loc !== 'hand' ? T.joey : ''));
    el.addEventListener('click', () => onPick(el));
    let tHold = null;
    el.addEventListener('pointerdown', () => (holdTarget = { uid, el, fire: () => known && openDetail(uid) }));
    el.addEventListener('pointerup', () => (holdTarget = null));
    void selectable;
    void tHold;
    return el;
  }

  // ---- details -------------------------------------------------------------
  function cardInfo(id, uid) {
    const def = cardById(id);
    const stars = def.level ? h('span', { class: 'pip-row' }, ...Array.from({ length: def.level }, () => atlasCell(atlases.icons, 'star', 'pip star-pip'))) : null;
    const type = def.kind === 'monster' ? `${def.attr} · ${def.race}${def.frame !== 'normal' ? ` / ${def.frame}` : ''}` : `${def.sub} ${def.kind === 'spell' ? 'Spell' : 'Trap'}`;
    const st = supportStatus(def);
    const note = effectOf(id)?.note;
    let live = null;
    if (uid && duel?.cards[uid]?.loc === 'mz') {
      const z = view?.zones?.[uid];
      if (z && z.up) live = h('div', { class: 'detail-live' }, h('span', { class: 'atk' }, `ATK ${z.atk}`), h('span', { class: 'def' }, `DEF ${z.def}`));
    }
    const cut = def.kind === 'monster' ? getCreatureCanvas(id) : null;
    return h(
      'div',
      { class: 'detail-card' },
      h('div', { class: 'detail-art' }, h('img', { src: cardImg(id), alt: def.name }), cut ? h('img', { class: 'detail-creature', src: cut, alt: '' }) : null),
      h('div', { class: 'detail-body' }, h('div', { class: 'detail-name', dir: 'ltr' }, def.name), h('div', { class: 'detail-type', dir: 'ltr' }, type), stars, def.kind === 'monster' ? h('div', { class: 'detail-stats', dir: 'ltr' }, `ATK ${def.atk ?? '?'} / DEF ${def.def ?? '?'}`) : null, live, h('div', { class: 'detail-text', dir: 'ltr' }, def.desc), note ? h('div', { class: 'detail-note', dir: 'ltr' }, `2004: ${note}`) : null, h('div', { class: `status-chip ${st}` }, T.status[st]))
    );
  }
  function openDetail(uid, idOverride) {
    const c = uid ? duel?.cards[uid] : null;
    const id = idOverride ?? c?.id;
    if (!id || id <= 0) return;
    if (c && c.ctrl === 1 && !c.faceUp && c.loc !== 'gy') return;
    fill(detail, h('div', { class: 'detail-panel' }, h('button', { class: 'icon-btn close', 'aria-label': 'close', onclick: closeDetail }, icon('close')), cardInfo(id, uid)));
    detail.hidden = false;
  }
  function closeDetail() {
    detail.hidden = true;
  }
  function showPile(p, loc) {
    const list = loc === 'gy' ? duel.players[p].gy : duel.players[p].extra;
    if (!list.length) return;
    fill(detail, 
      h('div', { class: 'detail-panel pile' }, h('button', { class: 'icon-btn close', 'aria-label': 'close', onclick: closeDetail }, icon('close')), h('div', { class: 'pile-title' }, loc === 'gy' ? `المقبرة · ${p === 0 ? T.you : T.joey}` : 'مجموعة الدمج'), h('div', { class: 'pile-grid' }, ...list.slice().reverse().map((u) => h('button', { class: 'choice-card', onclick: () => openDetail(null, duel.cards[u].id) }, h('img', { src: cardImg(duel.cards[u].id), alt: '' })))))
    );
    detail.hidden = false;
  }

  // ---- per-frame -------------------------------------------------------------
  function update(dt) {
    for (const k of Object.keys(timers)) if (timers[k] > 0) timers[k] -= dt;
    if (timers.toast <= 0) toastEl.hidden = true;
    if (timers.banner <= 0) bannerEl.hidden = true;
    if (timers.act <= 0) actBanner.hidden = true;
    if (timers.speech <= 0) speech.hidden = true;
    if (timers.callout <= 0) callout.hidden = true;
    if (timers.coin <= 0) coinEl.hidden = true;
    for (const p of [0, 1]) if (timers[`lp${p}`] <= 0) (p === 0 ? myLp : oppLp).parentElement.classList.remove('hurt', 'healed');
    for (const p of [0, 1]) {
      const d = lpTarget[p] - lpShown[p];
      if (Math.abs(d) < 1) lpShown[p] = lpTarget[p];
      else lpShown[p] += Math.sign(d) * Math.max(Math.abs(d) * Math.min(1, dt * 6), Math.min(Math.abs(d), 40));
    }
    for (let i = floatTimers.length - 1; i >= 0; i--) {
      floatTimers[i].t -= dt;
      if (floatTimers[i].t <= 0) {
        floatTimers[i].el.remove();
        floatTimers.splice(i, 1);
      }
    }
    if (holdTarget) {
      holdT += dt;
      if (holdT > 0.45) {
        holdTarget.fire();
        holdTarget = null;
      }
    } else holdT = 0;
    if (press) {
      press.t += dt;
      if (press.t > 0.45 && !press.long) {
        press.long = true;
        const hit = arena.pick(press.x, press.y);
        if (hit?.kind === 'card') openDetail(hit.uid);
      }
    }
    shakeAmp = timers.shake > 0 ? shakeAmp : 0;
  }

  // Called by the game each frame with what the player may do.
  function render(state) {
    duel = state.duel;
    canAct = state.canAct;
    if (state.version !== legalVersion) {
      legalVersion = state.version;
      legal = canAct ? getActions(duel, 0) : [];
      if (selected && !legal.length) clearSelection();
      if (selected && duel.cards[selected.uid] && !['hand', 'mz', 'sz', 'fz'].includes(duel.cards[selected.uid].loc)) clearSelection();
      if (selected) buildSheet();
      updateHandSelection();
    }
    renderPrompt();
    renderPhaseButtons();
    myLp.textContent = Math.round(lpShown[0]);
    oppLp.textContent = Math.round(lpShown[1]);
    myLp.classList.toggle('low', lpShown[0] <= 2000);
    oppLp.classList.toggle('low', lpShown[1] <= 2000);
    fill(rankStars, ...Array.from({ length: state.rank || 1 }, () => atlasCell(atlases.icons, 'star', 'pip')));
    // shake
    const s = shakeAmp * 8;
    root.style.setProperty('--shake-x', `${s ? (Math.random() - 0.5) * s : 0}px`);
    root.style.setProperty('--shake-y', `${s ? (Math.random() - 0.5) * s : 0}px`);
    renderPlates();
    // keep the board between the HUD bands
    const r = root.getBoundingClientRect();
    const tb = top.getBoundingClientRect();
    const bb = bottom.getBoundingClientRect();
    if (r.height && tb.height && bb.height) arena.setInsets(tb.bottom - r.top + 14, r.bottom - bb.top + 6);
    else if (r.height) arena.setInsets(Math.min(110, r.height * 0.14), Math.min(220, r.height * 0.26));
  }

  function renderPlates() {
    const zones = arena.lastSnap()?.zones || {};
    const seen = new Set();
    for (const [uid, z] of Object.entries(zones)) {
      if (z.loc !== 'mz' || !z.up) continue;
      seen.add(uid);
      let pl = plates.get(uid);
      if (!pl) {
        const atk = h('span', { class: 'atk' });
        const def = h('span', { class: 'def' });
        const el = h('div', { class: 'mon-plate' }, atk, h('span', { class: 'slash' }, '/'), def);
        labels.append(el);
        pl = { el, atk, def, base: cardById(z.id) };
        plates.set(uid, pl);
      }
      pl.atk.textContent = z.atk;
      pl.def.textContent = z.def;
      pl.atk.className = `atk ${z.atk > (pl.base.atk ?? 0) ? 'up' : z.atk < (pl.base.atk ?? 0) ? 'down' : ''}`;
      pl.def.className = `def ${z.def > (pl.base.def ?? 0) ? 'up' : z.def < (pl.base.def ?? 0) ? 'down' : ''}`;
      pl.el.classList.toggle('defpos', z.pos === 'def');
      const e = arena.cards.get(uid);
      const pos = e ? e.g.position.clone() : arena.zonePos(z.p, 'mz', z.i);
      pos.z += 0.78;
      const sp = arena.project(pos);
      pl.el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -50%)`;
    }
    for (const [uid, pl] of plates) {
      if (!seen.has(uid)) {
        pl.el.remove();
        plates.delete(uid);
      }
    }
  }

  function reset() {
    clearSelection();
    handKey = '';
    promptKey = '';
    for (const pl of plates.values()) pl.el.remove();
    plates.clear();
    lpShown[0] = lpShown[1] = lpTarget[0] = lpTarget[1] = 8000;
    setFace('confident');
    prompt.hidden = true;
  }
  function setLpInstant(lp) {
    lpShown[0] = lpTarget[0] = lp[0];
    lpShown[1] = lpTarget[1] = lp[1];
  }
  function setVisible(v) {
    ui.hidden = !v;
    labels.hidden = !v;
  }

  return {
    onSnap,
    onDraw,
    onPhase,
    banner,
    activation,
    monsterCallout,
    joeySays,
    setFace,
    toast,
    aim,
    lpChange,
    shake,
    battleNumbers,
    reveal,
    coin,
    die,
    statPulse,
    openDetail,
    closeDetail,
    detailOpen: () => !detail.hidden,
    update,
    render,
    reset,
    setLpInstant,
    setVisible,
    el: ui,
    cardInfo,
    sizes: () => ({ top: top.getBoundingClientRect(), bottom: bottom.getBoundingClientRect() }),
  };
}

export { actionKey };
