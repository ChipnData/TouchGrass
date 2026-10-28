'use strict';
/* Big Screen: a full-screen, controller-first view (console mode). */

const bs = { active: false, tab: 'home', query: '', source: 'All', clock: null, built: false, layerReturn: null };
const BS_TABS = [['home', 'Home'], ['games', 'Games'], ['apps', 'Apps'], ['store', 'Store']];
const BS_KEYS = ['1234567890', 'qwertyuiop', 'asdfghjkl\'', 'zxcvbnm-.:'];

const ICON_SEARCH = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICON_POWER = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>';

function bsBuild() {
  if (bs.built) return;
  bs.built = true;
  const root = $('#bs');
  root.innerHTML = '';
  const bg = el('div', 'bs-bg');
  bg.id = 'bs-bg';
  const top = el('header', 'bs-top');
  const tabs = el('nav', 'bs-tabs');
  tabs.setAttribute('aria-label', 'Big Screen sections');
  for (const [id, label] of BS_TABS) {
    const b = el('button', 'bs-tab', label);
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.key = `tab:${id}`;
    b.dataset.tab = id;
    b.onclick = () => bsSetTab(id);
    tabs.append(b);
  }
  const playing = el('button', 'bs-playing');
  playing.type = 'button';
  playing.id = 'bs-playing';
  playing.dataset.nav = '';
  playing.dataset.key = 'playing';
  playing.hidden = true;
  const clock = el('span', 'bs-clock');
  clock.id = 'bs-clock';
  const search = el('button', 'bs-icon');
  search.type = 'button';
  search.innerHTML = ICON_SEARCH;
  search.setAttribute('aria-label', 'Search');
  search.dataset.nav = '';
  search.dataset.key = 'search';
  search.onclick = () => bsOpenSearch();
  const power = el('button', 'bs-icon');
  power.type = 'button';
  power.innerHTML = ICON_POWER;
  power.setAttribute('aria-label', 'Power');
  power.dataset.nav = '';
  power.dataset.key = 'power';
  power.onclick = () => bsPowerMenu();
  top.append(tabs, el('span', 'spacer'), playing, clock, search, power);

  const main = el('main', 'bs-main');
  main.id = 'bs-main';
  const hints = el('footer', 'bs-hints');
  for (const [k, t] of [['A', 'Select'], ['B', 'Back'], ['X', 'Options'], ['Y', 'Search'], ['LB RB', 'Sections'], ['☰', 'Menu']]) {
    const h = el('span');
    h.append(el('kbd', null, k), document.createTextNode(` ${t}`));
    hints.append(h);
  }
  const layer = el('div', 'bs-layer');
  layer.id = 'bs-layer';
  layer.hidden = true;
  const osk = el('div', 'bs-osk');
  osk.id = 'bs-osk';
  osk.hidden = true;
  root.append(bg, top, main, hints, layer, osk);
}

async function enterBigScreen() {
  if (bs.active) { bsFocusFirst(); return; }
  bsBuild();
  bs.active = true;
  closeMenu();
  $$('dialog[open]').forEach((d) => d.close());
  $('#bs').hidden = false;
  $('#app').setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-bs');
  await invoke('set_fullscreen', { on: true }).catch(() => {});
  bsTick();
  bs.clock = setInterval(bsTick, 15000);
  bsRender();
  bsFocusFirst();
  pollRunning();
}

async function exitBigScreen() {
  if (!bs.active) return;
  bs.active = false;
  clearInterval(bs.clock);
  $('#bs').hidden = true;
  $('#app').removeAttribute('aria-hidden');
  document.body.classList.remove('in-bs');
  await invoke('set_fullscreen', { on: false }).catch(() => {});
  renderLibrary();
}

function bsTick() {
  const c = $('#bs-clock');
  if (c) c.textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function bsSetTab(id) {
  bs.tab = id;
  bsRender();
  bsFocusFirst();
}
function bsCycleTab(step) {
  const i = BS_TABS.findIndex(([id]) => id === bs.tab);
  bsSetTab(BS_TABS[(i + step + BS_TABS.length) % BS_TABS.length][0]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function bsCard(g, key) {
  const b = el('button', 'bs-card');
  b.type = 'button';
  b.dataset.nav = '';
  b.dataset.key = key;
  b.dataset.id = g.id;
  b.setAttribute('aria-label', `${g.title}${g.installed ? '' : ', not installed'}`);
  const cv = el('div', 'cover');
  fillCover(cv, g);
  cv.append(el('span', `badge src-${g.source}`, BADGE[g.source] || g.source));
  if (running.has(g.id)) cv.append(el('span', 'playing-badge', 'PLAYING'));
  if (!g.installed) b.classList.add('not-installed');
  b.append(cv, el('span', 'bs-card-t', g.title));
  b.onclick = () => launch(g);
  b.addEventListener('focus', () => bsBackdrop(g));
  return b;
}

function bsAppCard(name, icon, key, onOpen) {
  const b = el('button', 'bs-app');
  b.type = 'button';
  b.dataset.nav = '';
  b.dataset.key = key;
  b.append(icon, el('span', 'nm', name));
  b.onclick = onOpen;
  return b;
}

function bsRow(title, items) {
  if (!items.length) return null;
  const s = el('section', 'bs-row');
  s.append(el('h2', null, title));
  const strip = el('div', 'bs-strip');
  items.forEach((i) => strip.append(i));
  s.append(strip);
  return s;
}

function bsBackdrop(g) {
  const bg = $('#bs-bg');
  if (!bg) return;
  const art = data.art[g.id] || {};
  const url = fileUrl(data.covers[g.id] || art.header || art.cover || g.cover);
  bg.style.backgroundImage = url ? `url("${url}")` : 'none';
}

function bsRender() {
  if (!bs.active) return;
  const keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
  $$('#bs .bs-tab').forEach((t) => t.setAttribute('aria-current', String(t.dataset.tab === bs.tab)));
  const main = $('#bs-main');
  main.replaceChildren();
  if (bs.tab === 'home') bsHome(main);
  else if (bs.tab === 'games') bsGames(main);
  else if (bs.tab === 'apps') bsApps(main);
  else bsStore(main);
  bsPlaying();
  if (keep && $('#bs-layer').hidden && $('#bs-osk').hidden) {
    const again = $(`#bs [data-key="${CSS.escape(keep)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

function bsPlaying() {
  const p = $('#bs-playing');
  const ids = [...running.keys()].filter((id) => byId.has(id));
  p.hidden = !ids.length;
  if (!ids.length) return;
  const g = byId.get(ids[0]);
  p.textContent = `Playing ${g.title}`;
  p.onclick = () => bsGameOptions(g);
}

function installedVisible() {
  return all.filter((g) => g.installed && !g.hidden);
}

function bsHome(main) {
  const base = installedVisible();
  const recent = base.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  const playing = base.find((g) => running.has(g.id));
  const hero = playing || recent[0] || base[0];
  if (hero) {
    const h = el('section', 'bs-hero');
    const art = el('div', 'bs-hero-art');
    const a = data.art[hero.id] || {};
    const url = fileUrl(a.header || data.covers[hero.id] || a.cover || hero.cover);
    if (url) art.style.backgroundImage = `url("${url}")`;
    else art.append(genCover(hero.title));
    const info = el('div', 'bs-hero-info');
    info.append(el('span', 'eyebrow', recent[0] ? (running.has(hero.id) ? 'Playing now' : 'Continue playing') : 'Ready to play'));
    info.append(el('h1', null, hero.title));
    const meta = el('div', 'bs-hero-meta');
    meta.append(srcTag(hero.source));
    if (hero.lastPlayed) meta.append(el('span', null, rel(hero.lastPlayed)));
    if (hero.playtimeMin) meta.append(el('span', null, fmtTime(hero.playtimeMin)));
    info.append(meta);
    const acts = el('div', 'bs-hero-actions');
    const play = el('button', 'bs-btn primary', running.has(hero.id) ? 'Resume' : 'Play');
    play.type = 'button';
    play.dataset.nav = '';
    play.dataset.key = 'hero:play';
    play.onclick = () => launch(hero);
    play.addEventListener('focus', () => bsBackdrop(hero));
    const opt = el('button', 'bs-btn', 'Options');
    opt.type = 'button';
    opt.dataset.nav = '';
    opt.dataset.key = 'hero:opt';
    opt.onclick = () => bsGameOptions(hero);
    acts.append(play, opt);
    info.append(acts);
    h.append(art, info);
    main.append(h);
    bsBackdrop(hero);
  }
  const rows = [];
  rows.push(bsRow('Recently played', recent.filter((g) => g !== hero).slice(0, 15).map((g) => bsCard(g, `recent:${g.id}`))));
  rows.push(bsRow('Pinned', base.filter((g) => g.fav).map((g) => bsCard(g, `pin:${g.id}`))));
  for (const c of data.collections) {
    const set = new Set(c.games);
    rows.push(bsRow(c.name, base.filter((g) => set.has(g.id)).map((g) => bsCard(g, `coll:${c.id}:${g.id}`))));
  }
  const monthAgo = Date.now() / 1000 - 30 * 86400;
  rows.push(bsRow('Recently added', base.filter((g) => g.added > monthAgo).sort((a, b) => b.added - a.added).slice(0, 16).map((g) => bsCard(g, `added:${g.id}`))));
  const apps = enabledPrograms().map((p) => bsAppCard(p.name, iconEl([fileUrl(p.icon)], p.name), `app:${p.id}`, () => launchProgram(p)))
    .concat(data.websites.map((s) => bsAppCard(s.name, iconEl(siteIconSrcs(s.url), s.name), `site:${s.id}`, () => openSite(s))));
  rows.push(bsRow('Apps & websites', apps));
  rows.filter(Boolean).forEach((r) => main.append(r));
  if (!base.length) main.append(el('p', 'bs-empty', 'No installed games found yet. Exit Big Screen and use Rescan, or add a game.'));
}

function bsGames(main) {
  const chips = el('div', 'bs-chips');
  const base = installedVisible();
  const counts = { All: base.length };
  base.forEach((g) => { counts[g.source] = (counts[g.source] || 0) + 1; });
  if (bs.query) {
    const q = el('button', 'bs-chip active', `“${bs.query}”  ✕`);
    q.type = 'button';
    q.dataset.nav = '';
    q.dataset.key = 'chip:query';
    q.onclick = () => { bs.query = ''; bsRender(); bsFocusFirst(); };
    chips.append(q);
  }
  for (const s of SOURCES) {
    if (s !== 'All' && !counts[s]) continue;
    const c = el('button', 'bs-chip' + (bs.source === s ? ' active' : ''), `${s} ${counts[s] || 0}`);
    c.type = 'button';
    c.dataset.nav = '';
    c.dataset.key = `chip:${s}`;
    c.onclick = () => { bs.source = s; bsRender(); };
    chips.append(c);
  }
  main.append(chips);
  const q = norm(bs.query);
  const shown = base
    .filter((g) => (bs.source === 'All' || g.source === bs.source) && matches(g, q))
    .sort(sorter('recent'));
  const grid = el('div', 'bs-grid');
  shown.forEach((g) => grid.append(bsCard(g, `grid:${g.id}`)));
  main.append(grid);
  if (!shown.length) main.append(el('p', 'bs-empty', bs.query ? `Nothing matches “${bs.query}”.` : 'No games here.'));
}

function bsApps(main) {
  const grid = el('div', 'bs-appgrid');
  enabledPrograms().forEach((p) => grid.append(bsAppCard(p.name, iconEl([fileUrl(p.icon)], p.name), `app:${p.id}`, () => launchProgram(p))));
  data.websites.forEach((s) => grid.append(bsAppCard(s.name, iconEl(siteIconSrcs(s.url), s.name), `site:${s.id}`, () => openSite(s))));
  main.append(grid);
  if (!grid.children.length) main.append(el('p', 'bs-empty', 'No apps yet. Choose apps and add websites on the Programs tab in the normal window.'));
}

function bsStore(main) {
  const epicRow = el('section', 'bs-row');
  epicRow.append(el('h2', null, 'Free on Epic'));
  const epicStrip = el('div', 'bs-strip');
  epicStrip.append(el('span', 'bs-empty', 'Loading…'));
  epicRow.append(epicStrip);
  const dealRow = el('section', 'bs-row');
  dealRow.append(el('h2', null, 'Top deals'));
  const dealStrip = el('div', 'bs-strip');
  dealStrip.append(el('span', 'bs-empty', 'Loading…'));
  dealRow.append(dealStrip);
  const storesRow = el('section', 'bs-row');
  storesRow.append(el('h2', null, 'Store apps'));
  const storesStrip = el('div', 'bs-strip');
  for (const s of STORE_LIST) {
    if (!(s.app === 'always' || (s.app !== 'never' && storeDetected(s.src)))) continue;
    const ic = el('span', 'ico', s.name.charAt(0));
    ic.style.background = SRC_DOT[s.src];
    ic.style.color = '#101410';
    storesStrip.append(bsAppCard(s.name, ic, `store:${s.src}`, () => invoke('open_store_app', { store: s.src }).catch(err)));
  }
  storesRow.append(storesStrip);
  main.append(epicRow, dealRow, storesRow);

  const card = (title, img, badge, key, onOpen) => {
    const b = el('button', 'bs-card wide');
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.key = key;
    const cv = el('div', 'cover');
    fillArt(cv, img, title);
    if (badge) cv.append(el('span', 'badge', badge));
    b.append(cv, el('span', 'bs-card-t', title));
    b.onclick = onOpen;
    return b;
  };
  getEpicFree().then((list) => {
    epicStrip.replaceChildren();
    list.forEach((f, i) => epicStrip.append(card(f.title, [f.image], f.status === 'now' ? 'FREE NOW' : `FREE ${fmtDate(f.starts).toUpperCase()}`, `epic:${i}`, () => openEpicFree(f))));
    if (!list.length) epicStrip.append(el('span', 'bs-empty', 'Nothing free right now.'));
  }).catch(() => epicStrip.replaceChildren(el('span', 'bs-empty', 'Couldn’t load.')));
  getDeals(null, 'Deal Rating', 0).then((list) => {
    dealStrip.replaceChildren();
    list.slice(0, 24).forEach((d, i) => dealStrip.append(card(d.title, dealArt(d), `-${Math.round(Number(d.savings))}% ${money(d.salePrice)}`, `deal:${i}`, () => openDeal(d))));
  }).catch(() => dealStrip.replaceChildren(el('span', 'bs-empty', 'Couldn’t load deals.')));
}

// ---------------------------------------------------------------------------
// Focus & navigation
// ---------------------------------------------------------------------------
function bsScope() {
  if (!$('#bs-osk').hidden) return $('#bs-osk');
  if (!$('#bs-layer').hidden) return $('#bs-layer');
  return $('#bs');
}
function bsItems(scope) {
  return $$('[data-nav]', scope).filter((e) => e.offsetParent !== null && !e.closest('[hidden]'));
}
function bsFocusFirst() {
  const scope = bsScope();
  const items = bsItems(scope);
  const main = scope === $('#bs') ? items.find((e) => e.closest('#bs-main')) : null;
  const target = main || items[0];
  if (target) { target.focus({ preventScroll: true }); bsReveal(target); }
}
function bsReveal(t) {
  t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  if (t.closest('.bs-hero') || t.closest('.bs-top')) $('#bs-main').scrollTo({ top: 0, behavior: 'smooth' });
}

function bsMove(dir) {
  const scope = bsScope();
  const items = bsItems(scope);
  if (!items.length) return;
  const cur = document.activeElement;
  if (!items.includes(cur)) { bsFocusFirst(); return; }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const c of items) {
    if (c === cur) continue;
    const q = c.getBoundingClientRect();
    const qx = q.left + q.width / 2;
    const qy = q.top + q.height / 2;
    let primary;
    let secondary;
    if (dir === 'right') { if (qx <= cx + 2 || q.left < r.right - r.width * 0.5) continue; primary = q.left - r.right; secondary = Math.abs(qy - cy); }
    else if (dir === 'left') { if (qx >= cx - 2 || q.right > r.left + r.width * 0.5) continue; primary = r.left - q.right; secondary = Math.abs(qy - cy); }
    else if (dir === 'down') { if (qy <= cy + 2 || q.top < r.bottom - r.height * 0.5) continue; primary = q.top - r.bottom; secondary = Math.abs(qx - cx); }
    else { if (qy >= cy - 2 || q.bottom > r.top + r.height * 0.5) continue; primary = r.top - q.bottom; secondary = Math.abs(qx - cx); }
    const horizontal = dir === 'left' || dir === 'right';
    // Left/right only moves within the same row.
    if (horizontal && !(q.bottom > r.top + 4 && q.top < r.bottom - 4)) continue;
    const score = Math.max(0, primary) + secondary * (horizontal ? 3 : 0.6);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  if (best) { best.focus({ preventScroll: true }); bsReveal(best); }
}

function bsActivate() {
  const a = document.activeElement;
  if (a && a.closest('#bs') && a.matches('[data-nav]')) a.click();
}

function bsBack() {
  if (!$('#bs-osk').hidden) { bsCloseSearch(false); return; }
  if (!$('#bs-layer').hidden) { bsCloseLayer(); return; }
  if (bs.query && bs.tab === 'games') { bs.query = ''; bsRender(); bsFocusFirst(); return; }
  const a = document.activeElement;
  if (a && a.closest('#bs-main')) { const t = $(`#bs .bs-tab[data-tab="${bs.tab}"]`); if (t) { t.focus(); bsReveal(t); } return; }
  if (bs.tab !== 'home') bsSetTab('home');
}

function bsOptions() {
  const a = document.activeElement;
  const id = a && a.dataset ? a.dataset.id : null;
  if (id && byId.has(id)) bsGameOptions(byId.get(id));
  else if (a && a.dataset && a.dataset.key && a.dataset.key.startsWith('hero:')) a.parentElement.querySelector('[data-key="hero:opt"]').click();
  else bsPowerMenu();
}

// ---------------------------------------------------------------------------
// Layers: menus and confirm
// ---------------------------------------------------------------------------
function bsOpenLayer(title, items, sub) {
  const layer = $('#bs-layer');
  bs.layerReturn = document.activeElement;
  layer.replaceChildren();
  const box = el('div', 'bs-menu');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', title);
  box.append(el('h2', null, title));
  if (sub) box.append(el('p', null, sub));
  items.filter(Boolean).forEach((it, i) => {
    const b = el('button', 'bs-menu-item' + (it.danger ? ' danger' : ''), it.label);
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.key = `layer:${i}`;
    b.onclick = () => { if (!it.keepOpen) bsCloseLayer(); it.run(); };
    box.append(b);
  });
  layer.append(box);
  layer.hidden = false;
  const first = layer.querySelector('[data-nav]');
  if (first) first.focus();
}
function bsCloseLayer() {
  $('#bs-layer').hidden = true;
  const r = bs.layerReturn;
  bs.layerReturn = null;
  if (r && document.contains(r)) r.focus({ preventScroll: true }); else bsFocusFirst();
}
function bsConfirm(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    bsOpenLayer(title, [
      { label: 'Cancel', run: () => resolve(false) },
      { label: okLabel, danger: true, run: () => resolve(true) },
    ], text);
  });
}

function bsGameOptions(g) {
  const pids = running.get(g.id) || [];
  bsOpenLayer(g.title, [
    { label: g.installed ? (running.has(g.id) ? 'Resume' : 'Play') : `Install on ${g.source}`, run: () => launch(g) },
    pids.length ? { label: 'Close game', danger: true, run: () => closeGame(g) } : null,
    { label: g.fav ? 'Unpin' : 'Pin to Home', run: () => toggleFav(g) },
    { label: 'Hide from library', run: () => toggleHidden(g) },
    { label: 'Cancel', run: () => {} },
  ]);
}

function bsPowerMenu() {
  bsOpenLayer('Menu', [
    { label: 'Exit Big Screen', run: () => exitBigScreen() },
    { label: 'Sleep', run: () => invoke('power', { action: 'sleep' }).catch(err) },
    { label: 'Restart', run: async () => { if (await bsConfirm('Restart the PC?', 'Save anything open first.', 'Restart')) invoke('power', { action: 'restart' }).catch(err); } },
    { label: 'Shut down', run: async () => { if (await bsConfirm('Shut down the PC?', 'Save anything open first.', 'Shut down')) invoke('power', { action: 'shutdown' }).catch(err); } },
    { label: 'Sign out of Windows', run: async () => { if (await bsConfirm('Sign out?', 'Open apps will close.', 'Sign out')) invoke('power', { action: 'signout' }).catch(err); } },
    { label: 'Quit Touch Grass', run: () => invoke('quit_app') },
    { label: 'Cancel', run: () => {} },
  ]);
}

// ---------------------------------------------------------------------------
// Search with an on-screen keyboard
// ---------------------------------------------------------------------------
function bsOpenSearch(initial) {
  if (bs.tab !== 'games') { bs.tab = 'games'; bsRender(); }
  const osk = $('#bs-osk');
  osk.replaceChildren();
  const field = el('div', 'bs-osk-field');
  field.id = 'bs-osk-field';
  field.textContent = bs.query || '';
  osk.append(el('span', 'eyebrow', 'Search games'), field);
  const keys = el('div', 'bs-keys');
  const press = (k) => {
    if (k === '⌫') bs.query = bs.query.slice(0, -1);
    else if (k === 'Space') bs.query += ' ';
    else if (k === 'Clear') bs.query = '';
    else if (k === 'Done') { bsCloseSearch(true); return; }
    else bs.query += k;
    field.textContent = bs.query;
    bsRender();
  };
  BS_KEYS.forEach((row, ri) => {
    const r = el('div', 'bs-keyrow');
    for (const ch of row) {
      const b = el('button', 'bs-key', ch);
      b.type = 'button';
      b.dataset.nav = '';
      b.dataset.key = `k:${ri}:${ch}`;
      b.onclick = () => press(ch);
      r.append(b);
    }
    keys.append(r);
  });
  const r = el('div', 'bs-keyrow');
  for (const k of ['Space', '⌫', 'Clear', 'Done']) {
    const b = el('button', 'bs-key wide' + (k === 'Done' ? ' primary' : ''), k);
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.key = `k:x:${k}`;
    b.onclick = () => press(k);
    r.append(b);
  }
  keys.append(r);
  osk.append(keys);
  osk.hidden = false;
  if (initial) { bs.query += initial; field.textContent = bs.query; bsRender(); }
  const q = osk.querySelector('[data-key="k:1:q"]');
  if (q) q.focus();
}
function bsOskType(ch) {
  if (ch === 'Backspace') bs.query = bs.query.slice(0, -1);
  else bs.query += ch;
  const f = $('#bs-osk-field');
  if (f) f.textContent = bs.query;
  bsRender();
}
function bsCloseSearch(toResults) {
  $('#bs-osk').hidden = true;
  if (toResults) {
    const first = $('#bs-main .bs-grid [data-nav]');
    if (first) { first.focus(); bsReveal(first); return; }
  }
  bsFocusFirst();
}

// ---------------------------------------------------------------------------
// Input (called from input.js)
// ---------------------------------------------------------------------------
function bsKey(e) {
  const k = e.key;
  const oskOpen = !$('#bs-osk').hidden;
  const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (dirs[k]) { e.preventDefault(); bsMove(dirs[k]); return; }
  if (k === 'Enter' || k === ' ') { e.preventDefault(); bsActivate(); return; }
  if (k === 'Escape') { e.preventDefault(); bsBack(); return; }
  if (k === 'Backspace') { e.preventDefault(); if (oskOpen) bsOskType('Backspace'); else bsBack(); return; }
  if (k === 'Tab') { e.preventDefault(); bsCycleTab(e.shiftKey ? -1 : 1); return; }
  if (k === 'ContextMenu') { e.preventDefault(); bsOptions(); return; }
  if (k === 'F11') { e.preventDefault(); exitBigScreen(); return; }
  if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (oskOpen) bsOskType(k.toLowerCase());
    else if ($('#bs-layer').hidden) bsOpenSearch(k.toLowerCase());
  }
}

function bsPad(i) {
  if (i === 0) bsActivate();
  else if (i === 1) bsBack();
  else if (i === 2) { if (!$('#bs-osk').hidden) bsOskType('Backspace'); else if ($('#bs-layer').hidden) bsOptions(); }
  else if (i === 3) { if ($('#bs-osk').hidden && $('#bs-layer').hidden) bsOpenSearch(); else if (!$('#bs-osk').hidden) bsCloseSearch(true); }
  else if ((i === 4 || i === 5) && $('#bs-osk').hidden && $('#bs-layer').hidden) bsCycleTab(i === 5 ? 1 : -1);
  else if (i === 9) { if ($('#bs-layer').hidden) bsPowerMenu(); else bsCloseLayer(); }
}
