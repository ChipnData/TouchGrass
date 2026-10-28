'use strict';
/* Games library: model, rendering, actions, custom games, scanning, art. */

let list = [];
let selId = null;
let query = '';
let scanning = false;
let heroGame = null;

// ---------------------------------------------------------------------------
// Model
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
    g.fav = fav.has(g.id);
    g.hidden = hid.has(g.id);
    g.added = data.firstSeen[g.id] || 0;
  }
  all = out;
  byId = new Map(all.map((g) => [g.id, g]));
}

function hasCover(g) {
  return !!(data.covers[g.id] || (data.art[g.id] && data.art[g.id].cover) || g.cover);
}

function matches(g, q) {
  if (!q) return true;
  const t = norm(g.title);
  if (q.split(' ').every((w) => t.includes(w))) return true;
  const initials = t.split(' ').map((w) => w[0]).join('');
  return initials.startsWith(q.replace(/ /g, ''));
}

function sorter(mode) {
  const az = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const inst = (a, b) => (b.installed - a.installed);
  switch (mode) {
    case 'az': return az;
    case 'added': return (a, b) => (b.added || 0) - (a.added || 0) || az(a, b);
    case 'playtime': return (a, b) => (b.playtimeMin || 0) - (a.playtimeMin || 0) || az(a, b);
    case 'source': return (a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) || az(a, b);
    default: return (a, b) => inst(a, b) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || az(a, b);
  }
}

function visibleBase() {
  return all.filter((g) => (S('showHidden') || !g.hidden) && (!S('installedOnly') || g.installed));
}
function collectionById(id) { return data.collections.find((c) => c.id === id); }

function refresh() {
  rebuild();
  renderLibrary();
  if (typeof renderStore === 'function' && currentView === 'store') renderStore();
  if (typeof bs !== 'undefined' && bs.active) bsRender();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function meta(g) {
  if (running.has(g.id)) return 'Playing now';
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
  fillCover(cv, g);
  cv.append(el('span', `badge src-${g.source}`, BADGE[g.source] || g.source));
  if (running.has(g.id)) cv.append(el('span', 'playing-badge', 'PLAYING'));
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
    const b = el('button', 'chip', s);
    b.append(el('span', 'n', String(n)));
    b.setAttribute('aria-pressed', String(s === cur));
    b.onclick = () => setSource(s);
    wrap.append(b);
  }
  wrap.append(el('span', 'chip-sep'));
  const curColl = S('collection');
  for (const c of data.collections) {
    const b = el('button', 'chip coll', c.name);
    b.append(el('span', 'n', String(c.games.filter((id) => byId.has(id)).length)));
    b.setAttribute('aria-pressed', String(c.id === curColl));
    b.title = 'Collection — right-click to rename or delete';
    b.onclick = () => { setS('collection', c.id === curColl ? null : c.id); selId = null; renderLibrary(); };
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu([
        { label: 'Rename…', run: () => renameCollection(c) },
        { label: 'Delete collection', danger: true, run: () => deleteCollection(c) },
      ], { x: e.clientX, y: e.clientY });
    });
    wrap.append(b);
  }
  const add = el('button', 'chip coll', '+ Collection');
  add.title = 'New collection';
  add.onclick = () => newCollection();
  wrap.append(add);
}

function setSource(s) {
  setS('source', s);
  selId = null;
  renderLibrary();
}

function renderLibrary() {
  const src = S('source');
  const coll = S('collection') ? collectionById(S('collection')) : null;
  if (S('collection') && !coll) data.settings.collection = null;
  const q = norm(query);
  const base = visibleBase();
  const counts = { All: base.length };
  for (const g of base) counts[g.source] = (counts[g.source] || 0) + 1;
  renderChips(counts);

  const inColl = coll ? new Set(coll.games) : null;
  const shown = base.filter((g) => (src === 'All' || g.source === src) && (!inColl || inColl.has(g.id)) && matches(g, q));
  shown.sort(sorter(S('sort')));
  const pinned = q ? [] : shown.filter((g) => g.fav);
  const rest = q ? shown : shown.filter((g) => !g.fav);
  list = pinned.concat(rest);

  $('#count').textContent = shown.length === base.length
    ? `${base.length} game${base.length === 1 ? '' : 's'}`
    : `${shown.length} of ${base.length}`;

  heroGame = null;
  if (!q && src === 'All' && !coll) {
    heroGame = base.find((g) => running.has(g.id))
      || base.filter((g) => g.installed && g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
  }
  $('#hero').hidden = !heroGame;
  if (heroGame) {
    $('#hero .eyebrow').textContent = running.has(heroGame.id) ? 'Playing now' : 'Continue playing';
    fillCover($('#hero-cover'), heroGame);
    $('#hero-title').textContent = heroGame.title;
    const m = $('#hero-meta');
    m.replaceChildren(srcTag(heroGame.source));
    if (running.has(heroGame.id)) m.append(el('span', null, 'Playing now'));
    else if (heroGame.lastPlayed) m.append(el('span', null, `Last played ${rel(heroGame.lastPlayed).toLowerCase()}`));
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
        el('span', null, 'Touch Grass finds Steam, Epic, GOG, Battle.net, Xbox, EA, Ubisoft, Amazon and Humble games automatically. Add anything else with + or by dragging an .exe onto this window.'),
        btn('Add a game', 'btn primary', () => openAdd()),
      );
    } else if (q) {
      empty.append(el('b', null, `No matches for “${query}”`), el('span', null, 'Press Esc to clear the search.'));
    } else if (coll) {
      empty.append(el('b', null, `“${coll.name}” is empty`), el('span', null, 'Open any game and tick this collection to add it.'));
    } else {
      empty.append(el('b', null, 'Nothing here'), el('span', null, 'Try another filter or turn off “Installed only”.'));
    }
  }

  if (!list.some((g) => g.id === selId)) selId = list[0] ? list[0].id : null;
  markSel(false);
  renderNowPlaying();
}

function srcTag(source) {
  const t = el('span', 'tag', BADGE[source] || source);
  const dot = el('i');
  dot.style.background = SRC_DOT[source] || '#999';
  t.prepend(dot);
  return t;
}

// ---------------------------------------------------------------------------
// Selection & keyboard navigation
// ---------------------------------------------------------------------------
function tileFor(id) {
  return id ? document.querySelector(`#view-games .tile[data-id="${CSS.escape(id)}"]`) : null;
}
function markSel(scroll) {
  $$('#view-games .tile.sel').forEach((t) => t.classList.remove('sel'));
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
  else if (dir === 'up') { $('#main').scrollTo({ top: 0, behavior: 'smooth' }); $('#search').focus(); }
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
      if (g.source === 'Custom') running.set(g.id, []);
      save();
      toast(`Launching ${g.title}…`);
      refresh();
      updateTray();
      if (S('minimizeOnLaunch') && !(typeof bs !== 'undefined' && bs.active)) setTimeout(() => invoke('hide_main'), 700);
      setTimeout(pollRunning, 8000);
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
  save(); refresh(); updateTray();
}

function toggleHidden(g) {
  const i = data.hidden.indexOf(g.id);
  if (i >= 0) data.hidden.splice(i, 1);
  else {
    data.hidden.push(g.id);
    toast(`Hid ${g.title}`, { action: ['Undo', () => toggleHidden(byId.get(g.id) || g)] });
  }
  save(); refresh();
}

async function closeGame(g) {
  const pids = running.get(g.id) || [];
  if (!pids.length) { toast('Close it from the game itself'); return; }
  const ok = await confirmBox(`Close ${g.title}?`, 'This force-closes the game. Anything you haven’t saved will be lost.', 'Close game', true);
  if (!ok) return;
  await invoke('close_game', { pids }).catch(err);
  running.delete(g.id);
  setTimeout(pollRunning, 1500);
  refresh();
}

function uninstall(g) {
  if (g.source === 'Steam') return invoke('open_uri', { uri: `steam://uninstall/${g.id.split(':')[1]}` }).catch(err);
  if (g.source === 'Custom') return removeCustom(g);
  toast(`Find “${g.title}” in the list that opens and choose Uninstall`);
  return invoke('open_uri', { uri: 'ms-settings:appsfeatures' }).catch(err);
}

function gameMenu(g, anchor) {
  openMenu([
    { label: g.installed ? 'Play' : 'Install', run: () => launch(g) },
    running.has(g.id) && running.get(g.id).length ? { label: 'Close game', run: () => closeGame(g) } : null,
    { label: 'Details…', run: () => openDetails(g) },
    { label: g.fav ? 'Unpin' : 'Pin to top', run: () => toggleFav(g) },
    '-',
    { label: 'Change cover…', run: () => openCoverPicker(g) },
    g.installDir ? { label: 'Open install folder', run: () => invoke('open_folder', { path: g.installDir }).catch(err) } : null,
    g.storeUrl ? { label: 'View store page', run: () => invoke('open_link', { url: g.storeUrl }).catch(err) } : null,
    '-',
    g.source === 'Custom' ? { label: 'Edit…', run: () => openAdd(data.custom.find((c) => c.id === g.id)) } : null,
    g.source === 'Custom' ? { label: 'Remove from Touch Grass', danger: true, run: () => removeCustom(g) } : null,
    { label: g.hidden ? 'Unhide' : 'Hide from library', run: () => toggleHidden(g) },
  ], anchor);
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
// Collections
// ---------------------------------------------------------------------------
async function promptText(title, value = '') {
  // A tiny inline prompt built on the confirm dialog.
  const d = $('#confirm');
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.style.width = '100%';
  const text = $('#cf-text');
  text.replaceChildren(input);
  setTimeout(() => { input.focus(); input.select(); }, 30);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#cf-yes').click(); } });
  const ok = await new Promise((resolve) => {
    $('#cf-title').textContent = title;
    const yes = $('#cf-yes');
    yes.textContent = 'Save';
    yes.className = 'btn primary';
    const done = (v) => { d.close(); resolve(v); };
    yes.onclick = () => done(true);
    $('#cf-no').onclick = () => done(false);
    d.oncancel = (e) => { e.preventDefault(); done(false); };
    d.showModal();
  });
  const v = input.value.trim();
  text.textContent = '';
  return ok && v ? v : null;
}

async function newCollection(withGame) {
  const name = await promptText('New collection');
  if (!name) return null;
  const c = { id: `coll:${uid()}`, name, games: withGame ? [withGame.id] : [] };
  data.collections.push(c);
  save(); refresh();
  return c;
}
async function renameCollection(c) {
  const name = await promptText('Rename collection', c.name);
  if (!name) return;
  c.name = name; save(); refresh();
}
async function deleteCollection(c) {
  const ok = await confirmBox(`Delete “${c.name}”?`, 'The games stay in your library; only the collection is removed.', 'Delete', true);
  if (!ok) return;
  data.collections = data.collections.filter((x) => x.id !== c.id);
  if (S('collection') === c.id) data.settings.collection = null;
  save(); refresh();
}
function toggleInCollection(c, g) {
  const i = c.games.indexOf(g.id);
  if (i >= 0) c.games.splice(i, 1); else c.games.push(g.id);
  save(); refresh();
}

// ---------------------------------------------------------------------------
// Custom games
// ---------------------------------------------------------------------------
let editing = null;
function titleFromPath(p) {
  const base = p.split(/[\\/]/).pop().replace(/\.(exe|lnk|url|bat|cmd)$/i, '');
  return base.replace(/[_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}
function openAdd(c, presetPath) {
  editing = c || null;
  $('#add-title').textContent = c ? 'Edit game' : 'Add a game';
  $('#f-save').textContent = c ? 'Save' : 'Add game';
  $('#f-path').value = (c && c.path) || presetPath || '';
  $('#f-title').value = (c && c.title) || (presetPath ? titleFromPath(presetPath) : '');
  $('#f-args').value = (c && c.args) || '';
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
function addCustom({ path, title, args = '' }) {
  const c = { id: `custom:${uid()}`, title, path, args, added: Date.now() };
  data.custom.push(c);
  data.firstSeen[c.id] = Math.floor(Date.now() / 1000);
  return c;
}
function saveAdd(e) {
  e.preventDefault();
  const path = $('#f-path').value.trim();
  const title = $('#f-title').value.trim();
  if (!path) { browseExe(); return; }
  if (!title) { $('#f-title').focus(); return; }
  const args = $('#f-args').value.trim();
  let c;
  const wasEditing = !!editing;
  if (editing) { c = editing; Object.assign(c, { path, title, args }); }
  else c = addCustom({ path, title, args });
  $('#add-dialog').close();
  save(); refresh(); select(c.id);
  toast(wasEditing ? `Saved ${title}` : `Added ${title}`);
  if (!wasEditing && S('sgdbKey')) autoCover(byId.get(c.id));
  editing = null;
}
function removeCustom(g) {
  const idx = data.custom.findIndex((c) => c.id === g.id);
  if (idx < 0) return;
  const [c] = data.custom.splice(idx, 1);
  save(); refresh();
  toast(`Removed ${g.title}`, { action: ['Undo', () => { data.custom.splice(idx, 0, c); save(); refresh(); }] });
}

// ---------------------------------------------------------------------------
// Scanning & art
// ---------------------------------------------------------------------------
async function scan() {
  if (scanning) return;
  scanning = true;
  $('#rescan').classList.add('spin');
  $('#scan-state').textContent = 'Scanning…';
  try {
    const r = await invoke('scan_library', { opts: { steamApiKey: S('steamApiKey') || null, steamId: S('steamId') || null } });
    scanned = r.games;
    const now = Math.floor(Date.now() / 1000);
    const firstScan = !data.lastScan;
    for (const g of r.games) if (!data.firstSeen[g.id]) data.firstSeen[g.id] = firstScan ? 1 : now;
    data.cache = { games: r.games, at: Date.now() };
    if (r.steamId) data.detectedSteamId = r.steamId;
    data.lastScan = { at: Date.now(), sources: r.sources, warnings: r.warnings, count: r.games.length };
    save(); refresh(); updateTray();
    if (typeof reportScan === 'function') reportScan();
    r.warnings.forEach((w) => toast(w, { err: true }));
    resolveSteamArt().then(() => findMissingCovers(false));
    pollRunning();
  } catch (e) {
    toast(`Scan failed: ${e}`, { err: true });
  } finally {
    scanning = false;
    $('#rescan').classList.remove('spin');
    $('#scan-state').textContent = '';
    if (!all.length) renderLibrary();
  }
}

/** Gets the real cover/header URLs for Steam games from Steam (cached for a week). */
async function resolveSteamArt() {
  const week = 7 * 86400 * 1000;
  const ids = scanned
    .filter((g) => g.source === 'Steam')
    .filter((g) => { const a = data.art[g.id]; return !a || Date.now() - (a.at || 0) > week; })
    .map((g) => Number(g.id.split(':')[1]))
    .filter(Boolean);
  if (!ids.length) return;
  try {
    const res = await invoke('steam_art', { appids: ids });
    const at = Date.now();
    for (const id of ids) {
      const a = res[id] || res[String(id)];
      data.art[`steam:${id}`] = { cover: a && a.cover, header: a && a.header, at };
    }
    save(); refresh();
  } catch (e) {
    console.warn('Steam art lookup failed', e);
  }
}

async function autoCover(g) {
  const key = S('sgdbKey');
  if (!key || !g) return;
  try {
    const url = await invoke('sgdb_cover', { key, title: g.title });
    if (url) { data.art[g.id] = { ...(data.art[g.id] || {}), cover: url, at: Date.now() }; delete data.coverMiss[g.id]; }
    else data.coverMiss[g.id] = true;
    save(); refresh();
  } catch (e) { /* quiet: user didn't ask */ }
}

let coverRun = false;
async function findMissingCovers(manual) {
  const key = S('sgdbKey');
  if (!key) { if (manual) toast('Add a SteamGridDB key first'); return; }
  if (coverRun) return;
  const todo = all.filter((g) => !hasCover(g) && (manual || !data.coverMiss[g.id]));
  if (!todo.length) { if (manual) toast('Every game already has a cover'); return; }
  coverRun = true;
  const b = $('#s-covers');
  if (b) b.disabled = true;
  let found = 0;
  for (const g of todo) {
    try {
      const url = await invoke('sgdb_cover', { key, title: g.title });
      if (url) { data.art[g.id] = { ...(data.art[g.id] || {}), cover: url, at: Date.now() }; delete data.coverMiss[g.id]; found++; }
      else data.coverMiss[g.id] = true;
    } catch (e) { if (manual) err(e); break; }
    if (found && found % 6 === 0) refresh();
    await sleep(120);
  }
  coverRun = false;
  if (b) b.disabled = false;
  save(); refresh();
  if (typeof reportCovers === 'function') reportCovers();
  if (manual || found) toast(`Found ${found} cover${found === 1 ? '' : 's'}`);
}

// ---------------------------------------------------------------------------
// Now playing (checked only while Touch Grass is in front)
// ---------------------------------------------------------------------------
let pollTimer = null;
async function pollRunning() {
  clearTimeout(pollTimer);
  const dirs = all
    .filter((g) => g.installed && g.installDir && g.source !== 'Custom')
    .map((g) => ({ id: g.id, dir: g.installDir }));
  try {
    const res = dirs.length ? await invoke('running_games', { dirs }) : [];
    const before = [...running.keys()].filter((k) => !k.startsWith('custom:')).sort().join();
    for (const k of [...running.keys()]) if (!k.startsWith('custom:')) running.delete(k);
    for (const r of res) running.set(r.id, r.pids);
    const after = [...running.keys()].filter((k) => !k.startsWith('custom:')).sort().join();
    if (before !== after) { renderLibrary(); if (typeof bs !== 'undefined' && bs.active) bsRender(); }
    renderNowPlaying();
  } catch (e) { /* ignore */ }
  if (document.visibilityState === 'visible' && document.hasFocus()) pollTimer = setTimeout(pollRunning, 10000);
}

function renderNowPlaying() {
  const b = $('#now-playing');
  const ids = [...running.keys()].filter((id) => byId.has(id));
  b.hidden = !ids.length;
  if (!ids.length) return;
  const g = byId.get(ids[0]);
  b.textContent = ids.length > 1 ? `Playing ${g.title} +${ids.length - 1}` : `Playing ${g.title}`;
  b.onclick = () => openDetails(g);
}
