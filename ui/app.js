'use strict';

// ---------------------------------------------------------------------------
// Tauri bridge
// ---------------------------------------------------------------------------
const TAURI = window.__TAURI__;
const invoke = TAURI.core.invoke;
const convertFileSrc = TAURI.core.convertFileSrc;
const listen = TAURI.event.listen;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SOURCES = ['All', 'Steam', 'Epic', 'Battle.net', 'Xbox', 'Custom'];
const BADGE = { Steam: 'STEAM', Epic: 'EPIC', 'Battle.net': 'B.NET', Xbox: 'XBOX', Custom: 'CUSTOM' };
const DEFAULTS = {
  startMinimized: true, closeToTray: true, hotkey: true, minimizeOnLaunch: false,
  rescanOnStart: true, showHidden: false, tileSize: 'm',
  steamApiKey: '', steamId: '', sgdbKey: '',
  sort: 'recent', installedOnly: false, source: 'All',
};
const STORES = [
  { name: 'Steam', src: 'Steam', desc: 'Sales, wishlist and new releases.',
    links: [['Open store', 'https://store.steampowered.com/'], ['Specials', 'https://store.steampowered.com/specials']] },
  { name: 'Epic Games', src: 'Epic', desc: 'Includes the weekly free games.',
    links: [['Open store', 'https://store.epicgames.com/en-US/'], ['Free games', 'https://store.epicgames.com/en-US/free-games']] },
  { name: 'Xbox', src: 'Xbox', desc: 'PC Game Pass and Microsoft Store games.',
    links: [['Open store', 'https://www.xbox.com/en-US/games/all-games'], ['Game Pass', 'https://www.xbox.com/en-US/xbox-game-pass/games']] },
  { name: 'Battle.net', src: 'Battle.net', desc: 'Blizzard and Activision games.',
    links: [['Open shop', 'https://shop.battle.net/']] },
];
const GEN_COLORS = ['#2A3A52', '#3B3523', '#3A2230', '#26313A', '#1F2A2E', '#1E2742', '#2D2342', '#3A1E1E', '#3A2C1C', '#1D2C3A', '#1E3330', '#22302A', '#262A36', '#2F3A22', '#33263A'];
const SVG_PLAY = '<svg aria-hidden="true" viewBox="0 0 24 24" class="fill"><path d="M7 4v16l13-8z"/></svg>';
const SVG_STAR = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/></svg>';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let data = {
  settings: {}, custom: [], favorites: [], hidden: [], lastLaunched: {}, playtime: {},
  covers: {}, coverMiss: {}, cache: { games: [] },
};
let scanned = [];
let all = [];
let byId = new Map();
let list = [];
let selId = null;
let view = 'library';
let query = '';
let scanning = false;
let heroGame = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const S = (k) => (data.settings[k] !== undefined ? data.settings[k] : DEFAULTS[k]);
function setS(k, v) { data.settings[k] = v; save(); }

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    invoke('save_data', { data }).catch((e) => toast('Couldn’t save settings: ' + e, { err: true }));
  }, 300);
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function matches(g, q) {
  if (!q) return true;
  const t = norm(g.title);
  if (q.split(' ').every((w) => t.includes(w))) return true;
  const initials = t.split(' ').map((w) => w[0]).join('');
  return initials.startsWith(q.replace(/ /g, ''));
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
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
const dirname = (p) => p.replace(/[\\/][^\\/]*$/, '');
function titleFromPath(p) {
  const base = p.split(/[\\/]/).pop().replace(/\.(exe|lnk|url|bat|cmd)$/i, '');
  return base.replace(/[_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}
const err = (e) => toast(String(e), { err: true });

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
function toast(msg, opts = {}) {
  const t = el('div', 'toast' + (opts.err ? ' err' : ''));
  t.setAttribute('role', opts.err ? 'alert' : 'status');
  t.append(el('span', null, msg));
  if (opts.action) {
    const b = el('button', 'btn', opts.action[0]);
    b.onclick = () => { opts.action[1](); t.remove(); };
    t.append(b);
  }
  $('#toasts').append(t);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => t.remove(), opts.err ? 7000 : opts.action ? 6000 : 3200);
}

// ---------------------------------------------------------------------------
// Library model
// ---------------------------------------------------------------------------
function customToGame(c) {
  return {
    id: c.id, source: 'Custom', title: c.title, installed: true,
    launch: { kind: 'exe', path: c.path, args: c.args || '', cwd: null },
    installDir: dirname(c.path), cover: c.cover || null,
    playtimeMin: null, lastPlayed: null, storeUrl: null, sizeBytes: null,
  };
}

function rebuild() {
  const out = scanned.map((g) => ({ ...g })).concat(data.custom.map(customToGame));
  const fav = new Set(data.favorites);
  const hid = new Set(data.hidden);
  for (const g of out) {
    const ll = data.lastLaunched[g.id];
    if (ll && (!g.lastPlayed || ll > g.lastPlayed)) g.lastPlayed = ll;
    const pt = data.playtime[g.id];
    if (pt) g.playtimeMin = (g.playtimeMin || 0) + pt;
    if (data.covers[g.id]) g.cover = data.covers[g.id];
    g.fav = fav.has(g.id);
    g.hidden = hid.has(g.id);
  }
  all = out;
  byId = new Map(all.map((g) => [g.id, g]));
}

function sorter(mode) {
  const az = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const inst = (a, b) => (b.installed - a.installed);
  switch (mode) {
    case 'az': return az;
    case 'playtime': return (a, b) => (b.playtimeMin || 0) - (a.playtimeMin || 0) || az(a, b);
    case 'source': return (a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) || az(a, b);
    default: return (a, b) => inst(a, b) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || az(a, b);
  }
}

function refresh() { rebuild(); renderLibrary(); renderStores(); }

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function coverUrl(c) {
  if (!c) return null;
  if (/^https?:\/\//i.test(c)) return c;
  try { return convertFileSrc(c); } catch { return null; }
}

function genCover(g) {
  const d = el('div', 'gen', g.title);
  d.style.background = GEN_COLORS[hash(g.title) % GEN_COLORS.length];
  return d;
}

function coverEl(g) {
  const gen = genCover(g);
  const src = coverUrl(g.cover);
  if (!src) return gen;
  const img = new Image();
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.onerror = () => {
    const steamId = g.source === 'Steam' && g.id.split(':')[1];
    if (steamId && !img.dataset.fallback) {
      img.dataset.fallback = '1';
      img.src = `https://shared.steamstatic.com/store_item_assets/steam/apps/${steamId}/header.jpg`;
    } else {
      img.replaceWith(gen);
    }
  };
  img.src = src;
  return img;
}

function meta(g) {
  if (!g.installed) return g.playtimeMin ? `Not installed · ${fmtTime(g.playtimeMin)}` : 'Not installed';
  const parts = [rel(g.lastPlayed), fmtTime(g.playtimeMin)].filter(Boolean);
  return parts.length ? parts.join(' · ') : g.source === 'Custom' ? 'Custom game' : g.source;
}

function tile(g) {
  const t = el('div', 'tile');
  t.dataset.id = g.id;
  t.setAttribute('role', 'listitem');
  t.setAttribute('aria-label', `${g.title}, ${g.source}${g.installed ? '' : ', not installed'}`);
  if (!g.installed) t.classList.add('not-installed');
  if (g.hidden) t.classList.add('hidden-game');
  if (g.id === selId) t.classList.add('sel');

  const cv = el('div', 'cover');
  cv.append(coverEl(g), el('span', `badge src-${g.source}`, BADGE[g.source] || g.source));
  if (g.fav) { const p = el('span', 'pin'); p.innerHTML = SVG_STAR; cv.append(p); }
  const fab = el('button', 'play-fab');
  fab.innerHTML = SVG_PLAY;
  fab.dataset.act = 'play';
  fab.tabIndex = -1;
  fab.setAttribute('aria-label', `${g.installed ? 'Play' : 'Install'} ${g.title}`);
  cv.append(fab);

  const cap = el('div', 'cap');
  cap.append(el('span', 't', g.title), el('span', 'm', meta(g)));
  const more = el('button', 'more', '⋯');
  more.dataset.act = 'more';
  more.tabIndex = -1;
  more.setAttribute('aria-label', `Options for ${g.title}`);
  t.append(cv, cap, more);
  return t;
}

function renderChips(counts) {
  const cur = S('source');
  const wrap = $('#chips');
  wrap.replaceChildren();
  for (const s of SOURCES) {
    const n = counts[s] || 0;
    if (s !== 'All' && n === 0 && s !== cur) continue;
    const b = el('button', 'chip', s === 'Custom' ? 'Custom' : s);
    b.append(el('span', 'n', String(n)));
    b.setAttribute('aria-pressed', String(s === cur));
    b.onclick = () => setSource(s);
    wrap.append(b);
  }
}

function setSource(s) {
  setS('source', s);
  selId = null;
  renderLibrary();
}

function renderLibrary() {
  const src = S('source');
  const q = norm(query);
  const base = all.filter((g) => (S('showHidden') || !g.hidden) && (!S('installedOnly') || g.installed));
  const counts = { All: base.length };
  for (const g of base) counts[g.source] = (counts[g.source] || 0) + 1;
  renderChips(counts);

  const shown = base.filter((g) => (src === 'All' || g.source === src) && matches(g, q));
  shown.sort(sorter(S('sort')));
  const pinned = q ? [] : shown.filter((g) => g.fav);
  const rest = q ? shown : shown.filter((g) => !g.fav);
  list = pinned.concat(rest);

  $('#count').textContent = shown.length === base.length
    ? `${base.length} game${base.length === 1 ? '' : 's'}`
    : `${shown.length} of ${base.length}`;

  // Continue playing
  heroGame = null;
  if (!q && src === 'All') {
    heroGame = base.filter((g) => g.installed && g.lastPlayed)
      .sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
  }
  $('#hero').hidden = !heroGame;
  if (heroGame) {
    $('#hero-cover').replaceChildren(coverEl(heroGame));
    $('#hero-title').textContent = heroGame.title;
    const m = $('#hero-meta');
    m.replaceChildren(el('span', `tag src-${heroGame.source}`, BADGE[heroGame.source]));
    if (heroGame.lastPlayed) m.append(el('span', null, `Last played ${rel(heroGame.lastPlayed).toLowerCase()}`));
    if (heroGame.playtimeMin) m.append(el('span', null, `· ${fmtTime(heroGame.playtimeMin)}`));
  }

  $('#pinned-wrap').hidden = pinned.length === 0;
  $('#all-title').hidden = pinned.length === 0;
  const f1 = document.createDocumentFragment();
  pinned.forEach((g) => f1.append(tile(g)));
  $('#pinned').replaceChildren(f1);
  const f2 = document.createDocumentFragment();
  rest.forEach((g) => f2.append(tile(g)));
  $('#grid').replaceChildren(f2);

  const empty = $('#empty');
  empty.replaceChildren();
  empty.hidden = list.length > 0;
  if (!list.length) {
    if (!all.length) {
      empty.append(
        el('b', null, scanning ? 'Looking for your games…' : 'No games found yet'),
        el('span', null, 'Lumen finds Steam, Epic, Battle.net and Xbox games automatically. Add anything else with + or by dragging an .exe onto this window.'),
      );
      const b = el('button', 'btn primary', 'Add a game');
      b.onclick = () => openAdd();
      empty.append(b);
    } else if (q) {
      empty.append(el('b', null, `No matches for “${query}”`), el('span', null, 'Press Esc to clear the search.'));
    } else {
      empty.append(el('b', null, 'Nothing here'), el('span', null, 'Try another store filter or turn off “Installed only”.'));
    }
  }

  if (!list.some((g) => g.id === selId)) selId = list[0] ? list[0].id : null;
  markSel(false);
}

function renderStores() {
  const wrap = $('#stores');
  wrap.replaceChildren();
  for (const s of STORES) {
    const n = all.filter((g) => g.source === s.src && g.installed).length;
    const c = el('article', 'store');
    const h = el('h3', `src-${s.src}`, s.name);
    c.append(h, el('p', null, s.desc), el('span', 'muted small', `${n} installed`));
    const links = el('div', 'links');
    s.links.forEach(([label, url], i) => {
      const b = el('button', i === 0 ? 'btn primary' : 'btn', label);
      b.onclick = () => invoke('open_store', { url, title: s.name }).catch(err);
      links.append(b);
    });
    const ext = el('button', 'btn', 'Open in browser');
    ext.onclick = () => invoke('open_link', { url: s.links[0][1] }).catch(err);
    links.append(ext);
    c.append(links);
    wrap.append(c);
  }
}

// ---------------------------------------------------------------------------
// Selection & keyboard navigation
// ---------------------------------------------------------------------------
function tileFor(id) {
  return id ? document.querySelector(`.tile[data-id="${CSS.escape(id)}"]`) : null;
}
function markSel(scroll) {
  $$('.tile.sel').forEach((t) => t.classList.remove('sel'));
  const t = tileFor(selId);
  if (t) {
    t.classList.add('sel');
    if (scroll) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
function select(id, scroll = true) { selId = id; markSel(scroll); }

function move(dir) {
  const tiles = $$('#pinned .tile, #grid .tile');
  if (!tiles.length) return;
  const cur = tileFor(selId);
  if (!cur) { select(tiles[0].dataset.id); return; }
  const i = tiles.indexOf(cur);
  if (dir === 'left') { if (i > 0) select(tiles[i - 1].dataset.id); return; }
  if (dir === 'right') { if (i < tiles.length - 1) select(tiles[i + 1].dataset.id); return; }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best = null;
  let bd = Infinity;
  for (const t of tiles) {
    if (t === cur) continue;
    const q = t.getBoundingClientRect();
    const dy = dir === 'down' ? q.top - r.top : r.top - q.top;
    if (dy <= 4) continue;
    const d = dy * 3 + Math.abs(q.left + q.width / 2 - cx);
    if (d < bd) { bd = d; best = t; }
  }
  if (best) select(best.dataset.id);
  else if (dir === 'up') { $('main').scrollTo({ top: 0, behavior: 'smooth' }); $('#search').focus(); }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function launch(g) {
  if (!g) return;
  try {
    await invoke('launch_game', { id: g.id, launch: g.launch, track: g.source === 'Custom' });
    if (g.installed) {
      data.lastLaunched[g.id] = Math.floor(Date.now() / 1000);
      save();
      toast(`Launching ${g.title}…`);
      refresh();
      updateTray();
      if (S('minimizeOnLaunch')) setTimeout(() => invoke('hide_main'), 700);
    } else {
      toast(`Opening ${g.source} to install ${g.title}`);
    }
  } catch (e) {
    toast(`Couldn’t launch ${g.title}: ${e}`, { err: true });
  }
}

function toggleFav(g) {
  if (!g) return;
  const i = data.favorites.indexOf(g.id);
  if (i >= 0) data.favorites.splice(i, 1); else data.favorites.push(g.id);
  save();
  refresh();
  updateTray();
}

function toggleHidden(g) {
  const i = data.hidden.indexOf(g.id);
  if (i >= 0) {
    data.hidden.splice(i, 1);
  } else {
    data.hidden.push(g.id);
    toast(`Hid ${g.title}`, { action: ['Undo', () => toggleHidden(byId.get(g.id) || g)] });
  }
  save();
  refresh();
}

async function chooseCover(g) {
  const p = await invoke('pick_file', { kind: 'image' }).catch(err);
  if (!p) return;
  data.covers[g.id] = p;
  save();
  refresh();
}

async function findCover(g, manual) {
  const key = S('sgdbKey');
  if (!key) { if (manual) toast('Add a SteamGridDB key in Settings first'); return; }
  try {
    const url = await invoke('sgdb_cover', { key, title: g.title });
    if (url) { data.covers[g.id] = url; delete data.coverMiss[g.id]; save(); refresh(); }
    else { data.coverMiss[g.id] = true; save(); if (manual) toast(`No cover found for ${g.title}`); }
  } catch (e) { if (manual) err(e); }
}

let coverRun = false;
async function findMissingCovers(manual) {
  const key = S('sgdbKey');
  if (!key) { if (manual) toast('Add a SteamGridDB key first'); return; }
  if (coverRun) return;
  const todo = all.filter((g) => !g.cover && (manual || !data.coverMiss[g.id]));
  if (!todo.length) { if (manual) toast('Every game already has a cover'); return; }
  coverRun = true;
  $('#s-covers').disabled = true;
  let found = 0;
  for (const g of todo) {
    try {
      const url = await invoke('sgdb_cover', { key, title: g.title });
      if (url) { data.covers[g.id] = url; delete data.coverMiss[g.id]; found++; }
      else data.coverMiss[g.id] = true;
    } catch (e) { err(e); break; }
    if (found && found % 6 === 0) { rebuild(); renderLibrary(); }
    await sleep(120);
  }
  coverRun = false;
  $('#s-covers').disabled = false;
  save();
  refresh();
  reportCovers();
  if (manual || found) toast(`Found ${found} cover${found === 1 ? '' : 's'}`);
}

function updateTray() {
  const seen = new Set();
  const items = [];
  const push = (g) => { if (g && g.installed && !seen.has(g.id) && items.length < 8) { seen.add(g.id); items.push({ id: g.id, title: g.title }); } };
  all.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).forEach(push);
  all.filter((g) => g.fav).forEach(push);
  invoke('update_tray', { items }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function openMenu(g, anchor) {
  if (!g) return;
  const m = $('#ctx');
  m.replaceChildren();
  const add = (label, fn, cls) => {
    const b = el('button', cls || '', label);
    b.setAttribute('role', 'menuitem');
    b.onclick = () => { closeMenu(); fn(); };
    m.append(b);
  };
  const sep = () => m.append(el('hr'));
  add(g.installed ? 'Play' : 'Install', () => launch(g));
  add(g.fav ? 'Unpin' : 'Pin to top', () => toggleFav(g));
  sep();
  if (g.installDir) add('Open install folder', () => invoke('open_folder', { path: g.installDir }).catch(err));
  if (g.storeUrl) add('View store page', () => invoke('open_link', { url: g.storeUrl }).catch(err));
  add('Choose cover image…', () => chooseCover(g));
  if (S('sgdbKey')) add('Find cover online', () => findCover(g, true));
  if (data.covers[g.id]) add('Reset cover', () => { delete data.covers[g.id]; save(); refresh(); });
  sep();
  if (g.source === 'Custom') {
    add('Edit…', () => openAdd(data.custom.find((c) => c.id === g.id)));
    add('Remove from Lumen', () => removeCustom(g), 'danger');
  }
  add(g.hidden ? 'Unhide' : 'Hide from library', () => toggleHidden(g));

  m.hidden = false;
  let x; let y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = r.left; y = r.bottom + 4;
    if (y + m.offsetHeight > innerHeight - 8) y = r.top - m.offsetHeight - 4;
  } else {
    x = anchor.x; y = anchor.y;
    if (y + m.offsetHeight > innerHeight - 8) y = y - m.offsetHeight;
  }
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(8, y)}px`;
  m.querySelector('button').focus();
}
function closeMenu() { $('#ctx').hidden = true; }
function menuKeys(e) {
  const items = $$('#ctx button');
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
}

// ---------------------------------------------------------------------------
// Custom games
// ---------------------------------------------------------------------------
let editing = null;
function openAdd(c, presetPath) {
  editing = c || null;
  $('#add-title').textContent = c ? 'Edit game' : 'Add a game';
  $('#f-save').textContent = c ? 'Save' : 'Add game';
  $('#f-path').value = (c && c.path) || presetPath || '';
  $('#f-title').value = (c && c.title) || (presetPath ? titleFromPath(presetPath) : '');
  $('#f-args').value = (c && c.args) || '';
  $('#f-cover').value = (c && c.cover) || '';
  const d = $('#add-dialog');
  if (!d.open) d.showModal();
  if (!$('#f-path').value) browseExe(); else $('#f-title').focus();
}
async function browseExe() {
  const p = await invoke('pick_file', { kind: 'game' }).catch(err);
  if (!p) return;
  $('#f-path').value = p;
  if (!$('#f-title').value.trim()) $('#f-title').value = titleFromPath(p);
  $('#f-title').focus();
  $('#f-title').select();
}
function addCustom({ path, title, args = '', cover = '' }) {
  const c = { id: `custom:${crypto.randomUUID()}`, title, path, args, cover, added: Date.now() };
  data.custom.push(c);
  return c;
}
function saveAdd(e) {
  e.preventDefault();
  const path = $('#f-path').value.trim();
  const title = $('#f-title').value.trim();
  if (!path) { browseExe(); return; }
  if (!title) { $('#f-title').focus(); return; }
  const args = $('#f-args').value.trim();
  const cover = $('#f-cover').value.trim();
  let c;
  if (editing) {
    c = editing;
    Object.assign(c, { path, title, args, cover });
    if (cover) data.covers[c.id] = cover; else delete data.covers[c.id];
  } else {
    c = addCustom({ path, title, args, cover });
  }
  $('#add-dialog').close();
  save();
  refresh();
  select(c.id);
  toast(editing ? `Saved ${title}` : `Added ${title}`);
  if (!cover && S('sgdbKey')) findCover(byId.get(c.id), false);
  editing = null;
}
function removeCustom(g) {
  const idx = data.custom.findIndex((c) => c.id === g.id);
  if (idx < 0) return;
  const [c] = data.custom.splice(idx, 1);
  save();
  refresh();
  toast(`Removed ${g.title}`, { action: ['Undo', () => { data.custom.splice(idx, 0, c); save(); refresh(); }] });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------
async function scan() {
  if (scanning) return;
  scanning = true;
  $('#rescan').classList.add('spin');
  $('#scan-state').textContent = 'Scanning…';
  try {
    const r = await invoke('scan_library', {
      opts: { steamApiKey: S('steamApiKey') || null, steamId: S('steamId') || null },
    });
    scanned = r.games;
    data.cache = { games: r.games, at: Date.now() };
    if (r.steamId) data.detectedSteamId = r.steamId;
    data.lastScan = { at: Date.now(), sources: r.sources, warnings: r.warnings, count: r.games.length };
    save();
    refresh();
    updateTray();
    reportScan();
    r.warnings.forEach((w) => toast(w, { err: true }));
    findMissingCovers(false);
  } catch (e) {
    toast(`Scan failed: ${e}`, { err: true });
  } finally {
    scanning = false;
    $('#rescan').classList.remove('spin');
    $('#scan-state').textContent = '';
    if (!all.length) renderLibrary();
  }
}

function reportScan() {
  const s = data.lastScan;
  $('#scan-report').textContent = s
    ? `${new Date(s.at).toLocaleString()} · ${s.count} games from ${s.sources.length ? s.sources.join(', ') : 'no stores found'}${s.warnings.length ? ` · ${s.warnings.length} warning(s)` : ''}`
    : 'Not scanned yet.';
  $('#steamid-hint').textContent = data.detectedSteamId
    ? `Detected from the Steam app: ${data.detectedSteamId}. Leave empty to use it.`
    : 'Detected automatically from the Steam app when possible.';
}
function reportCovers() {
  const n = all.filter((g) => !g.cover).length;
  $('#cover-report').textContent = n ? `${n} game${n === 1 ? '' : 's'} using a generated tile.` : 'Every game has cover art.';
}

// ---------------------------------------------------------------------------
// Views & settings
// ---------------------------------------------------------------------------
function showView(v) {
  view = v;
  for (const name of ['library', 'stores', 'settings']) $(`#view-${name}`).hidden = name !== v;
  $$('.rail-btn[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === v);
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  closeMenu();
  $('main').scrollTop = 0;
  if (v === 'settings') { reportScan(); reportCovers(); }
}

function initSettings() {
  $$('[data-setting]').forEach((inp) => {
    const k = inp.dataset.setting;
    if (inp.type === 'checkbox') inp.checked = !!S(k); else inp.value = S(k) || '';
    inp.addEventListener('change', () => {
      const v = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
      setS(k, v);
      onSetting(k, v, inp);
    });
  });
  const auto = $('#s-autostart');
  invoke('get_autostart').then((v) => { auto.checked = v; }).catch(() => {});
  auto.addEventListener('change', async () => {
    try {
      const actual = await invoke('set_autostart', { enabled: auto.checked });
      auto.checked = actual;
      toast(actual ? 'Lumen will start with Windows' : 'Lumen won’t start with Windows');
    } catch (e) {
      auto.checked = !auto.checked;
      err(e);
    }
  });
  $('#s-rescan').onclick = () => scan();
  $('#s-covers').onclick = () => findMissingCovers(true);
  $('#s-quit').onclick = () => invoke('quit_app');
  $$('[data-link]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    invoke('open_link', { url: a.dataset.link }).catch(err);
  }));
}

function onSetting(k, v, inp) {
  if (k === 'closeToTray') invoke('set_close_to_tray', { enabled: v });
  if (k === 'hotkey') {
    invoke('set_hotkey', { enabled: v }).catch((e) => { err(e); inp.checked = false; setS(k, false); });
  }
  if (k === 'tileSize') document.documentElement.dataset.tile = v;
  if (k === 'showHidden') refresh();
  if ((k === 'steamApiKey' || k === 'steamId') && S('steamApiKey')) scan();
  if (k === 'sgdbKey' && v) { data.coverMiss = {}; findMissingCovers(false); }
}

// ---------------------------------------------------------------------------
// Controller support (polls only while a pad is connected and Lumen is visible)
// ---------------------------------------------------------------------------
const pad = { raf: null, prev: [], dir: null, next: 0 };
function padStart() { if (!pad.raf) pad.raf = requestAnimationFrame(padLoop); }
function padPressed(p, i) { return !!(p.buttons[i] && p.buttons[i].pressed); }
function padAction(i) {
  if (!$('#add-dialog').open) {
    const menuOpen = !$('#ctx').hidden;
    if (i === 0) { // A
      if (menuOpen) document.activeElement.click();
      else if (view === 'library') launch(byId.get(selId));
    } else if (i === 1) { // B
      if (menuOpen) closeMenu();
      else if (view !== 'library') showView('library');
      else if (query) { $('#search').value = ''; query = ''; renderLibrary(); }
    } else if (i === 2 && view === 'library') { // X
      if (menuOpen) closeMenu(); else openMenu(byId.get(selId), tileFor(selId) || { x: 200, y: 200 });
    } else if (i === 3 && view === 'library' && !menuOpen) toggleFav(byId.get(selId)); // Y
    else if ((i === 4 || i === 5) && view === 'library' && !menuOpen) { // LB / RB
      const avail = $$('#chips .chip').map((c) => c.firstChild.textContent);
      const cur = avail.indexOf(S('source'));
      const n = (cur + (i === 5 ? 1 : -1) + avail.length) % avail.length;
      setSource(avail[n]);
    }
  }
}
function padLoop(t) {
  pad.raf = null;
  const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
  // Stop polling when unfocused; the window 'focus' handler restarts it.
  if (!p || !document.hasFocus()) { pad.prev = []; pad.dir = null; return; }
  {
    for (const i of [0, 1, 2, 3, 4, 5]) {
      const down = padPressed(p, i);
      if (down && !pad.prev[i]) padAction(i);
      pad.prev[i] = down;
    }
    const ax = p.axes[0] || 0;
    const ay = p.axes[1] || 0;
    let dir = null;
    if (padPressed(p, 12) || ay < -0.5) dir = 'up';
    else if (padPressed(p, 13) || ay > 0.5) dir = 'down';
    else if (padPressed(p, 14) || ax < -0.5) dir = 'left';
    else if (padPressed(p, 15) || ax > 0.5) dir = 'right';
    if (dir !== pad.dir) { pad.dir = dir; pad.next = t + 380; if (dir) padMove(dir); }
    else if (dir && t >= pad.next) { pad.next = t + 110; padMove(dir); }
  }
  pad.raf = requestAnimationFrame(padLoop);
}
function padMove(dir) {
  if (!$('#ctx').hidden) {
    const items = $$('#ctx button');
    const i = items.indexOf(document.activeElement);
    if (dir === 'down') items[(i + 1) % items.length].focus();
    if (dir === 'up') items[(i - 1 + items.length) % items.length].focus();
    return;
  }
  if (view === 'library') { if (document.activeElement === $('#search')) $('#search').blur(); move(dir); }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bindEvents() {
  $$('.rail-btn[data-view]').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  $('#rail-add').onclick = () => openAdd();

  const search = $('#search');
  search.addEventListener('input', () => { query = search.value; selId = null; renderLibrary(); });
  $('#sort').value = S('sort');
  $('#sort').addEventListener('change', (e) => { setS('sort', e.target.value); renderLibrary(); });
  const io = $('#installed-only');
  io.setAttribute('aria-pressed', String(!!S('installedOnly')));
  io.onclick = () => { setS('installedOnly', !S('installedOnly')); io.setAttribute('aria-pressed', String(!!S('installedOnly'))); selId = null; renderLibrary(); };
  $('#rescan').onclick = () => scan();
  $('#surprise').onclick = () => {
    const pool = list.filter((g) => g.installed);
    if (!pool.length) { toast('No installed games to pick from'); return; }
    const g = pool[Math.floor(Math.random() * pool.length)];
    select(g.id);
    toast(`How about ${g.title}?`, { action: ['Play', () => launch(g)] });
  };
  $('#hero-play').onclick = () => launch(heroGame);
  $('#hero-more').onclick = (e) => openMenu(heroGame, e.currentTarget);

  // Tiles (event delegation)
  for (const id of ['#grid', '#pinned']) {
    const g = $(id);
    g.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const game = byId.get(t.dataset.id);
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'play') launch(game);
      else if (act && act.dataset.act === 'more') { select(game.id, false); openMenu(game, act); }
      else select(game.id, false);
    });
    g.addEventListener('dblclick', (e) => {
      const t = e.target.closest('.tile');
      if (t && !e.target.closest('[data-act]')) launch(byId.get(t.dataset.id));
    });
    g.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      e.preventDefault();
      select(t.dataset.id, false);
      openMenu(byId.get(t.dataset.id), { x: e.clientX, y: e.clientY });
    });
  }
  // Block the WebView's own context menu elsewhere (it offers "Reload" etc.).
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) closeMenu(); });
  $('main').addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('blur', closeMenu);

  // Add dialog
  $('#add-form').addEventListener('submit', saveAdd);
  $('#f-browse').onclick = browseExe;
  $('#f-cancel').onclick = () => { $('#add-dialog').close(); editing = null; };
  $('#f-cover-browse').onclick = async () => {
    const p = await invoke('pick_file', { kind: 'image' }).catch(err);
    if (p) $('#f-cover').value = p;
  };
  $('#f-cover-clear').onclick = () => { $('#f-cover').value = ''; };

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if ($('#add-dialog').open) return;
    if (!$('#ctx').hidden) { menuKeys(e); return; }
    const k = e.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;
    if (e.ctrlKey && lower === 'k') { e.preventDefault(); showView('library'); search.focus(); search.select(); return; }
    if (e.ctrlKey && k === ',') { e.preventDefault(); showView('settings'); return; }
    if (e.ctrlKey && lower === 'n') { e.preventDefault(); openAdd(); return; }
    if (k === 'F5') { e.preventDefault(); scan(); return; }
    if (e.ctrlKey && lower === 'r') { e.preventDefault(); return; } // no accidental page reloads
    if (view !== 'library') { if (k === 'Escape') showView('library'); return; }

    if (e.target === search) {
      if (k === 'Enter') { e.preventDefault(); if (query && selId) launch(byId.get(selId)); else search.blur(); }
      else if (k === 'ArrowDown') { e.preventDefault(); search.blur(); markSel(true); }
      else if (k === 'Escape') {
        e.preventDefault();
        if (search.value) { search.value = ''; query = ''; selId = null; renderLibrary(); } else search.blur();
      }
      return;
    }
    if (e.target.closest('input, select, textarea')) return;

    const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (dirs[k]) { e.preventDefault(); move(dirs[k]); return; }
    if (k === 'Enter' && !e.target.closest('button')) { e.preventDefault(); launch(byId.get(selId)); return; }
    if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) {
      e.preventDefault();
      const t = tileFor(selId);
      if (t) openMenu(byId.get(selId), t.querySelector('.more'));
      return;
    }
    if (e.ctrlKey && lower === 'd') { e.preventDefault(); toggleFav(byId.get(selId)); return; }
    if (k === 'Escape' && query) { search.value = ''; query = ''; selId = null; renderLibrary(); return; }
    // Type anywhere to search.
    if (!e.ctrlKey && !e.altKey && !e.metaKey && k.length === 1 && k !== ' ') search.focus();
  });

  // Backend events
  listen('tray-launch', (e) => launch(byId.get(e.payload)));
  listen('focus-search', () => { showView('library'); search.focus(); search.select(); });
  listen('session-ended', (e) => {
    const { id, minutes } = e.payload;
    data.playtime[id] = (data.playtime[id] || 0) + minutes;
    save();
    refresh();
    const g = byId.get(id);
    if (g) toast(`Played ${g.title} for ${fmtTime(minutes)}`);
  });

  // Drag & drop .exe / shortcuts onto the window
  listen('tauri://drag-enter', () => { $('#drop').hidden = false; });
  listen('tauri://drag-leave', () => { $('#drop').hidden = true; });
  listen('tauri://drag-drop', (e) => {
    $('#drop').hidden = true;
    const paths = ((e.payload && e.payload.paths) || []).filter((p) => /\.(exe|lnk|url|bat|cmd)$/i.test(p));
    if (!paths.length) { toast('Drop an .exe or a shortcut to add a game'); return; }
    if (paths.length === 1) { openAdd(null, paths[0]); return; }
    paths.forEach((p) => addCustom({ path: p, title: titleFromPath(p) }));
    save();
    refresh();
    toast(`Added ${paths.length} games`);
    findMissingCovers(false);
  });

  window.addEventListener('gamepadconnected', () => { toast('Controller connected'); padStart(); });
  window.addEventListener('focus', () => { if ([...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean)) padStart(); });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function init() {
  try {
    const d = await invoke('load_data');
    if (d && typeof d === 'object') data = Object.assign(data, d);
  } catch (e) { err(e); }
  for (const k of ['settings', 'lastLaunched', 'playtime', 'covers', 'coverMiss']) {
    if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) data[k] = {};
  }
  for (const k of ['custom', 'favorites', 'hidden']) if (!Array.isArray(data[k])) data[k] = [];
  if (!data.cache || !Array.isArray(data.cache.games)) data.cache = { games: [] };
  scanned = data.cache.games;

  document.documentElement.dataset.tile = S('tileSize');
  initSettings();
  bindEvents();
  refresh();
  updateTray();
  reportScan();
  reportCovers();
  if (S('rescanOnStart') || !scanned.length) scan();
}

init();
