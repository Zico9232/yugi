// Small DOM helpers shared by the interface modules.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

// Tool icons: one viewBox, one stroke weight.
const PATHS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M14 6l6 6-6 6M20 12H4"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  log: '<path d="M6 5h12M6 10h12M6 15h8M6 20h5"/>',
  flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'tool-icon');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[name] || '';
  return s;
}

// Sprite cell from a generated atlas (frames.json) as a CSS background.
export function atlasCell(atlas, name, cls = '') {
  const el = h('span', { class: `atlas-cell ${cls}` });
  if (!atlas?.frames) return el;
  const f = atlas.frames.find((x) => x.name === name);
  if (!f) return el;
  const r = f.content || f.source;
  el.style.backgroundImage = `url("${atlas.url}")`;
  // percentage background placement keeps the cell inside any box size
  el.style.backgroundSize = `${(atlas.w / r.w) * 100}% ${(atlas.h / r.h) * 100}%`;
  el.style.backgroundPosition = `${(r.x / (atlas.w - r.w)) * 100}% ${(r.y / (atlas.h - r.h)) * 100}%`;
  el.style.aspectRatio = `${r.w} / ${r.h}`;
  return el;
}

export const cardImg = (id) => `${import.meta.env.BASE_URL}cards/s/${id}.jpg`;

// replaceChildren without the null/false placeholders conditional UI produces.
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}
