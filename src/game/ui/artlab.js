// Art Lab: the manual correction workflow for living monsters. Pick a
// creature, see its mask over the original artwork, paint or erase the mask,
// set the head anchor, motion profile, hover and size, preview the summon and
// attack on the real arena, approve, and export the corrected mask + rig so
// the change is saved and auditable in the project.
import { h, icon, cardImg } from './dom.js';
import { cardById } from '../../engine/cards.js';
import { PROFILES, profileFor, floats as floatsFor, creatureHeight } from '../arena/creature.js';
import rigs from '../../data/creature-rigs.json';

const PROFILE_NAMES = { dragon: 'تنين/مجنّح', warrior: 'محارب', caster: 'ساحر', aquatic: 'مائي', machine: 'آلة', beast: 'وحش', fiend: 'شيطان', small: 'صغير', rock: 'صخري', generic: 'عام' };

export function createArtLab({ game, sdk }) {
  const edits = {}; // id -> { profile, floats, height, anchors, approved, maskDataUrl }
  let selected = null;

  function rigOf(id) {
    const def = cardById(id);
    const base = rigs[id] || {};
    const e = edits[id] || {};
    return {
      profile: e.profile ?? base.profile ?? profileFor(def),
      floats: e.floats ?? base.floats ?? floatsFor(def, profileFor(def)),
      height: e.height ?? base.height ?? creatureHeight(def),
      approved: e.approved ?? base.approved !== false,
      anchors: e.anchors ?? base.anchors ?? null,
    };
  }

  function build() {
    const ids = game.creatureIds();
    if (!selected) selected = ids[0];
    const list = h('div', { class: 'lab-list' }, ...ids.map((id) => {
      const b = h('button', { class: `lab-thumb ${id === selected ? 'on' : ''} ${rigOf(id).approved ? '' : 'review'}`, onclick: () => {
        selected = id;
        game.showScreen('artlab');
      } }, h('img', { src: cardImg(id), alt: cardById(id).name, loading: 'lazy' }));
      return b;
    }));
    return h('div', { class: 'panel-screen lab' }, h('div', { class: 'screen-head' }, h('button', { class: 'icon-btn back', 'aria-label': 'back', onclick: () => game.showScreen('home') }, icon('back')), h('h2', {}, 'مختبر الرسوم')), list, editor(selected));
  }

  function editor(id) {
    const def = cardById(id);
    const rig = rigOf(id);
    const S = 624;
    const view = h('canvas', { class: 'lab-canvas', width: S, height: S });
    const g = view.getContext('2d');
    const mask = document.createElement('canvas');
    mask.width = mask.height = S;
    const mg = mask.getContext('2d');
    const art = new Image();
    const maskImg = new Image();
    let mode = 'paint';
    let brush = 22;
    let overlay = 0.5;
    let painting = false;
    const score = h('span', { class: 'chip' }, '…');
    let loaded = 0;
    const draw = () => {
      if (loaded < 2) return;
      g.clearRect(0, 0, S, S);
      g.globalAlpha = 1;
      g.drawImage(art, 0, 0, S, S);
      // tint where the mask is opaque
      const tint = document.createElement('canvas');
      tint.width = tint.height = S;
      const tg = tint.getContext('2d');
      tg.drawImage(mask, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = '#22ffaa';
      tg.fillRect(0, 0, S, S);
      g.globalAlpha = overlay;
      g.drawImage(tint, 0, 0);
      g.globalAlpha = 1;
      const a = rig.anchors?.head;
      if (a) {
        g.strokeStyle = '#ffb547';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(a.ax * S, a.ay * S, 14, 0, Math.PI * 2);
        g.stroke();
      }
    };
    art.onload = () => (++loaded, loaded === 2 && init());
    maskImg.onload = () => (++loaded, loaded === 2 && init());
    art.src = `${import.meta.env.BASE_URL}cards/art/${id}.jpg`;
    maskImg.src = edits[id]?.maskDataUrl || game.creatureAsset(id);
    function init() {
      mg.drawImage(maskImg, 0, 0, S, S);
      // keep only alpha: fill opaque pixels white
      mg.globalCompositeOperation = 'source-in';
      mg.fillStyle = '#ffffff';
      mg.fillRect(0, 0, S, S);
      mg.globalCompositeOperation = 'source-over';
      game.cutoutScore(id).then((sc) => (score.textContent = sc == null ? '—' : `تطابق ${Math.round(sc * 100)}%`));
      draw();
    }
    const at = (e) => {
      const r = view.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
    };
    const dab = (e) => {
      const p = at(e);
      if (mode === 'head') {
        const anchors = { ...(rig.anchors || {}), head: { ax: p.x / S, ay: p.y / S } };
        edits[id] = { ...(edits[id] || {}), anchors };
        rig.anchors = anchors;
        draw();
        return;
      }
      mg.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
      mg.fillStyle = '#ffffff';
      mg.beginPath();
      mg.arc(p.x, p.y, brush, 0, Math.PI * 2);
      mg.fill();
      mg.globalCompositeOperation = 'source-over';
      draw();
    };
    view.addEventListener('pointerdown', (e) => {
      painting = true;
      view.setPointerCapture(e.pointerId);
      dab(e);
    });
    view.addEventListener('pointermove', (e) => painting && mode !== 'head' && dab(e));
    view.addEventListener('pointerup', () => {
      if (painting && mode !== 'head') edits[id] = { ...(edits[id] || {}), maskDataUrl: mask.toDataURL('image/png') };
      painting = false;
    });
    const btn = (label, fn, on = false) => h('button', { class: `control-btn ${on ? 'primary' : ''}`, onclick: fn }, h('span', { class: 'control-label' }, label));
    const toolRow = h('div', { class: 'controls-row' }, btn('رسم', () => ((mode = 'paint'), game.showScreen('artlab')), mode === 'paint'), btn('مسح', () => ((mode = 'erase'), setTool())), btn('الرأس', () => ((mode = 'head'), setTool())), btn('−', () => (brush = Math.max(4, brush - 6))), btn('+', () => (brush = Math.min(80, brush + 6))), btn('شفافية', () => ((overlay = overlay > 0.2 ? 0 : 0.5), draw())));
    function setTool() {
      for (const b of toolRow.children) b.classList.remove('primary');
      toolRow.children[{ paint: 0, erase: 1, head: 2 }[mode]].classList.add('primary');
    }
    const profRow = h('div', { class: 'controls-row lab-profiles' }, ...Object.keys(PROFILES).map((k) => btn(PROFILE_NAMES[k], () => {
      edits[id] = { ...(edits[id] || {}), profile: k };
      game.showScreen('artlab');
    }, rig.profile === k)));
    const meta = h('div', { class: 'controls-row' }, btn(rig.floats ? 'يطير' : 'يقف', () => {
      edits[id] = { ...(edits[id] || {}), floats: !rig.floats };
      game.showScreen('artlab');
    }), btn(`الحجم ${rig.height.toFixed(2)}`, () => {
      const next = rig.height >= 2.6 ? 1.0 : rig.height + 0.2;
      edits[id] = { ...(edits[id] || {}), height: Math.round(next * 100) / 100 };
      game.showScreen('artlab');
    }), btn(rig.approved ? 'معتمد' : 'للمراجعة', () => {
      edits[id] = { ...(edits[id] || {}), approved: !rig.approved };
      game.showScreen('artlab');
    }, rig.approved));
    const actions = h('div', { class: 'controls-row' }, btn('معاينة الاستدعاء', () => game.previewCreature(id, edits[id]), true), btn('حفظ وتصدير', () => exportEdits(id)));
    return h('div', { class: 'lab-editor' }, h('div', { class: 'lab-name', dir: 'ltr' }, def.name, ' ', score), view, actions, toolRow, profRow, meta, h('div', { class: 'small-print' }, 'الأخضر = ما يخرج من البطاقة. البكسلات نفسها من الرسم الأصلي دائمًا.'));
  }

  async function exportEdits(id) {
    const e = edits[id] || {};
    const record = { id, name: cardById(id).name, ...rigOf(id), maskEdited: !!e.maskDataUrl, editedAt: new Date().toISOString() };
    delete record.maskDataUrl;
    const files = [[`creature-rig-${id}.json`, new Blob([JSON.stringify(record, null, 1)], { type: 'application/json' })]];
    if (e.maskDataUrl) {
      const blob = await (await fetch(e.maskDataUrl)).blob();
      files.push([`creature-mask-${id}.png`, blob]);
    }
    for (const [name, blob] of files) {
      try {
        await sdk.device.fileSystem.saveFile(blob, name);
      } catch {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
      }
    }
    game.applyCreatureEdit(id, e);
  }

  return { build, edits, rigOf };
}
