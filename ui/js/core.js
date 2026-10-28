'use strict';
/* Shared state, helpers and image handling used by every screen. */

const TAURI = window.__TAURI__;
const invoke = TAURI.core.invoke;
const convertFileSrc = TAURI.core.convertFileSrc;
const listen = TAURI.event.listen;

const SOURCES = ['All', 'Steam', 'Epic', 'GOG', 'Battle.net', 'Xbox', 'EA', 'Ubisoft', 'Amazon', 'Humble', 'Custom'];
const BADGE = {
  Steam: 'STEAM', Epic: 'EPIC', GOG: 'GOG', 'Battle.net': 'B.NET', Xbox: 'XBOX', EA: 'EA',
  Ubisoft: 'UBISOFT', Amazon: 'AMAZON', Humble: 'HUMBLE', Custom: 'CUSTOM',
};
const SRC_DOT = {
  Steam: '#8FC1FF', Epic: '#C9C9C9', GOG: '#B98CFF', 'Battle.net': '#4FA8FF', Xbox: '#5DC95D', EA: '#FF6B61',
  Ubisoft: '#6E95FF', Amazon: '#FFAA33', Humble: '#FF7A5C', Custom: '#E8B04A',
};
const DEFAULTS = {
  closeToTray: true, hotkey: true, controllerSummon: true, minimizeOnLaunch: false,
  rescanOnStart: true, showHidden: false, tileSize: 'm', autoUpdate: true,
  steamApiKey: '', steamId: '', sgdbKey: '', startupMode: 'tray',
  sort: 'recent', installedOnly: false, source: 'All', collection: null,
};
const GEN_COLORS = ['#2A3A52', '#3B3523', '#3A2230', '#26313A', '#1F2A2E', '#1E2742', '#2D2342', '#3A1E1E', '#3A2C1C', '#1D2C3A', '#1E3330', '#22302A', '#262A36', '#2F3A22', '#33263A'];
const SVG_PLAY = '<svg aria-hidden="true" viewBox="0 0 24 24" class="fill"><path d="M7 4v16l13-8z"/></svg>';
const SVG_STAR = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/></svg>';

let data = {};
let ctx = { autostarted: false, version: '' };
let scanned = [];
let all = [];
let byId = new Map();
let running = new Map(); // game id -> pids (or [] for custom games we launched)

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, cls, onClick) {
  const b = el('button', cls || 'btn', label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
const S = (k) => (data.settings && data.settings[k] !== undefined ? data.settings[k] : DEFAULTS[k]);
function setS(k, v) { data.settings[k] = v; save(); }

function normalizeData(d) {
  const out = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  for (const k of ['settings', 'lastLaunched', 'playtime', 'covers', 'coverMiss', 'art', 'firstSeen', 'theme']) {
    if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = {};
  }
  for (const k of ['custom', 'favorites', 'hidden', 'collections', 'websites', 'customThemes']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!out.cache || !Array.isArray(out.cache.games)) out.cache = { games: [] };
  if (!out.programs || typeof out.programs !== 'object') out.programs = {};
  if (!Array.isArray(out.programs.list)) out.programs.list = [];
  if (!out.programs.enabled || typeof out.programs.enabled !== 'object') out.programs.enabled = {};
  // Settings from the Lumen days.
  if (out.settings.startupMode === undefined && out.settings.startMinimized === false) out.settings.startupMode = 'window';
  if (out.settings.source && !SOURCES.includes(out.settings.source)) out.settings.source = 'All';
  return out;
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    invoke('save_data', { data }).catch((e) => toast(`Couldn’t save settings: ${e}`, { err: true }));
  }, 300);
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[™®]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function fmtTime(min) {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return h < 10 ? `${h.toFixed(1).replace(/\.0$/, '')} h` : `${Math.round(h)} h`;
}
function rel(ts) {
  if (!ts) return '';
  const d = Date.now() / 1000 - ts;
  if (d < 3600) return 'Just now';
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  const days = Math.floor(d / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} wk ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function fmtSize(b) {
  if (!b) return '';
  const gb = b / 1073741824;
  return gb >= 1 ? `${gb.toFixed(gb < 10 ? 1 : 0)} GB` : `${Math.round(b / 1048576)} MB`;
}
const dirname = (p) => p.replace(/[\\/][^\\/]*$/, '');
const err = (e) => toast(String(e), { err: true });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ---------------------------------------------------------------------------
// Toasts & confirm
// ---------------------------------------------------------------------------
function toast(msg, opts = {}) {
  const t = el('div', 'toast' + (opts.err ? ' err' : ''));
  t.setAttribute('role', opts.err ? 'alert' : 'status');
  t.append(el('span', null, msg));
  if (opts.action) {
    const b = btn(opts.action[0], 'btn', () => { opts.action[1](); t.remove(); });
    t.append(b);
  }
  $('#toasts').append(t);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => t.remove(), opts.err ? 7000 : opts.action ? 7000 : 3200);
}

/** Desktop confirm dialog. Big Screen has its own (bsConfirm). */
function confirmBox(title, text, okLabel = 'OK', danger = false) {
  if (typeof bs !== 'undefined' && bs.active) return bsConfirm(title, text, okLabel);
  return new Promise((resolve) => {
    const d = $('#confirm');
    $('#cf-title').textContent = title;
    $('#cf-text').textContent = text;
    const yes = $('#cf-yes');
    yes.textContent = okLabel;
    yes.className = danger ? 'btn primary danger' : 'btn primary';
    const done = (v) => { d.close(); resolve(v); };
    yes.onclick = () => done(true);
    $('#cf-no').onclick = () => done(false);
    d.oncancel = (e) => { e.preventDefault(); done(false); };
    d.showModal();
    $('#cf-no').focus();
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
function fileUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  try { return convertFileSrc(p); } catch { return null; }
}

function genCover(title) {
  const d = el('div', 'gen', title);
  d.style.background = GEN_COLORS[hash(title) % GEN_COLORS.length];
  return d;
}

/** Ordered list of images to try for a game: [url, isLandscape]. */
function coverCandidates(g) {
  const art = data.art[g.id] || {};
  const list = [];
  const add = (u, land) => { const f = fileUrl(u); if (f && !list.some((x) => x[0] === f)) list.push([f, land]); };
  add(data.covers[g.id], false);
  add(art.cover, false);
  add(g.cover, false);
  add(art.header, true);
  if (g.source === 'Steam') add(`https://shared.steamstatic.com/store_item_assets/steam/apps/${g.id.split(':')[1]}/header.jpg`, true);
  return list;
}

/**
 * Fills `box` (a positioned element) with the best available art for `g`,
 * falling back through each candidate, then to a generated title tile.
 * Images that load but are tiny placeholders count as failures.
 */
function fillCover(box, g) {
  box.querySelectorAll('img, .gen, .land-bg').forEach((n) => n.remove());
  const list = coverCandidates(g);
  let i = 0;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  const giveUp = () => { img.remove(); box.prepend(genCover(g.title)); };
  const next = () => {
    if (i >= list.length) { giveUp(); return; }
    const [url, land] = list[i++];
    img.className = land ? 'land' : '';
    img.dataset.land = land ? '1' : '';
    img.src = url;
  };
  img.onerror = next;
  img.onload = () => {
    if (img.naturalWidth < 60 || img.naturalHeight < 60) { next(); return; }
    if (img.dataset.land) {
      const bg = el('div', 'land-bg');
      bg.style.backgroundImage = `url("${img.src}")`;
      box.prepend(bg);
    }
  };
  box.prepend(img);
  next();
}

/** A square icon for an app or website: image with letter fallback. */
function iconEl(srcs, name) {
  const box = el('span', 'ico');
  const letter = () => { box.replaceChildren(); box.textContent = (name || '?').trim().charAt(0).toUpperCase(); box.style.background = GEN_COLORS[hash(name) % GEN_COLORS.length]; box.style.color = '#F4F5F1'; };
  const list = srcs.filter(Boolean);
  if (!list.length) { letter(); return box; }
  const img = new Image();
  img.alt = '';
  let i = 0;
  img.onerror = () => { if (++i < list.length) img.src = list[i]; else letter(); };
  img.onload = () => { if (img.naturalWidth < 16) img.onerror(); };
  img.src = list[0];
  box.append(img);
  return box;
}
function siteIconSrcs(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return []; }
  return [`https://${host}/apple-touch-icon.png`, `https://icons.duckduckgo.com/ip3/${host}.ico`];
}

// ---------------------------------------------------------------------------
// Context menu (shared by games, programs, collections)
// ---------------------------------------------------------------------------
function openMenu(items, anchor) {
  const m = $('#ctx');
  m.replaceChildren();
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(el('hr')); continue; }
    const b = btn(it.label, it.danger ? 'danger' : '', () => { closeMenu(); it.run(); });
    b.setAttribute('role', 'menuitem');
    m.append(b);
  }
  while (m.lastChild && m.lastChild.tagName === 'HR') m.lastChild.remove();
  m.hidden = false;
  let x; let y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = r.left; y = r.bottom + 4;
    if (y + m.offsetHeight > innerHeight - 8) y = r.top - m.offsetHeight - 4;
  } else {
    x = anchor.x; y = anchor.y;
    if (y + m.offsetHeight > innerHeight - 8) y -= m.offsetHeight;
  }
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(8, y)}px`;
  const first = m.querySelector('button');
  if (first) first.focus();
}
function closeMenu() { $('#ctx').hidden = true; }
function menuKeys(e) {
  const items = $$('#ctx button');
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
}
