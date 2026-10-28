'use strict';
/* App start-up, navigation between screens, and event wiring. */

let currentView = 'games';

function showView(v) {
  currentView = v;
  for (const name of ['games', 'programs', 'store', 'settings']) $(`#view-${name}`).hidden = name !== v;
  $$('.rail-btn[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === v);
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  closeMenu();
  $('#main').scrollTop = 0;
  if (v === 'settings') { reportScan(); reportCovers(); }
  if (v === 'programs') {
    renderPrograms();
    const stale = !data.programs.at || Date.now() - data.programs.at > 3 * 86400e3;
    if (stale) scanPrograms(false);
  }
  if (v === 'store') renderStore();
}

function bindEvents() {
  $$('.rail-btn[data-view]').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  $('#rail-bigscreen').onclick = () => enterBigScreen();

  // Games toolbar
  const search = $('#search');
  search.addEventListener('input', () => { query = search.value; selId = null; renderLibrary(); });
  $('#sort').value = S('sort');
  $('#sort').addEventListener('change', (e) => { setS('sort', e.target.value); renderLibrary(); });
  const io = $('#installed-only');
  io.setAttribute('aria-pressed', String(!!S('installedOnly')));
  io.onclick = () => { setS('installedOnly', !S('installedOnly')); io.setAttribute('aria-pressed', String(!!S('installedOnly'))); selId = null; renderLibrary(); };
  $('#rescan').onclick = () => scan();
  $('#add-game').onclick = () => openAdd();
  $('#surprise').onclick = () => {
    const pool = list.filter((g) => g.installed);
    if (!pool.length) { toast('No installed games to pick from'); return; }
    const g = pool[Math.floor(Math.random() * pool.length)];
    select(g.id);
    toast(`How about ${g.title}?`, { action: ['Play', () => launch(g)] });
  };
  $('#hero-play').onclick = () => launch(heroGame);
  $('#hero-details').onclick = () => openDetails(heroGame);

  // Tiles (event delegation)
  for (const id of ['#grid', '#pinned']) {
    const g = $(id);
    g.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const game = byId.get(t.dataset.id);
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'play') launch(game);
      else if (act && act.dataset.act === 'more') { select(game.id, false); gameMenu(game, act); }
      else { select(game.id, false); openDetails(game); }
    });
    g.addEventListener('dblclick', (e) => {
      const t = e.target.closest('.tile');
      if (t && !e.target.closest('[data-act]')) { $('#details').close(); launch(byId.get(t.dataset.id)); }
    });
    g.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      e.preventDefault();
      select(t.dataset.id, false);
      gameMenu(byId.get(t.dataset.id), { x: e.clientX, y: e.clientY });
    });
  }
  // Block the WebView's own context menu elsewhere (it offers "Reload" etc.).
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) closeMenu(); });
  $('#main').addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('blur', closeMenu);

  // Programs & store
  $('#manage-apps').onclick = openAppsDialog;
  $('#add-site').onclick = () => openSiteDialog();
  $$('#store-tabs [role="tab"]').forEach((t) => { t.onclick = () => { storeTab = t.dataset.tab; renderStore(); }; });

  // Add-game dialog
  $('#add-form').addEventListener('submit', saveAdd);
  $('#f-browse').onclick = browseExe;
  $('#f-cancel').onclick = () => { $('#add-dialog').close(); editing = null; };

  document.addEventListener('keydown', onKeyDown);

  // Backend events
  listen('tray-launch', (e) => launch(byId.get(e.payload)));
  listen('focus-search', () => { if (bs.active) return; showView('games'); $('#search').focus(); $('#search').select(); });
  listen('enter-bigscreen', () => enterBigScreen());
  listen('controller-summon', () => enterBigScreen());
  listen('session-ended', (e) => {
    const { id, minutes } = e.payload;
    data.playtime[id] = (data.playtime[id] || 0) + minutes;
    running.delete(id);
    save(); refresh();
    const g = byId.get(id);
    if (g) toast(`Played ${g.title} for ${fmtTime(minutes)}`);
  });

  // Drag & drop .exe / shortcuts onto the window
  listen('tauri://drag-enter', () => { if (!bs.active) $('#drop').hidden = false; });
  listen('tauri://drag-leave', () => { $('#drop').hidden = true; });
  listen('tauri://drag-drop', (e) => {
    $('#drop').hidden = true;
    if (bs.active) return;
    const paths = ((e.payload && e.payload.paths) || []).filter((p) => /\.(exe|lnk|url|bat|cmd)$/i.test(p));
    if (!paths.length) { toast('Drop an .exe or a shortcut to add a game'); return; }
    if (paths.length === 1) { showView('games'); openAdd(null, paths[0]); return; }
    paths.forEach((p) => addCustom({ path: p, title: titleFromPath(p) }));
    save(); refresh();
    toast(`Added ${paths.length} games`);
    findMissingCovers(false);
  });

  window.addEventListener('gamepadconnected', () => {
    if (!bs.active) toast('Controller connected — press ☰ (Menu) for Big Screen');
    padStart();
  });
  window.addEventListener('focus', () => { if (anyPad()) padStart(); pollRunning(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollRunning(); });
}

async function init() {
  try { data = normalizeData(await invoke('load_data')); } catch (e) { data = normalizeData({}); err(e); }
  try { ctx = await invoke('launch_context'); } catch { /* older backend */ }
  scanned = data.cache.games;

  applyTheme();
  document.documentElement.dataset.tile = S('tileSize');
  bindEvents();
  initSettings();
  rebuild();
  renderLibrary();
  updateTray();
  reportScan();
  reportCovers();

  if (ctx.autostarted && S('startupMode') === 'bigscreen') enterBigScreen();
  if (S('rescanOnStart') || !scanned.length) scan();
  else { resolveSteamArt(); pollRunning(); }
  if (S('autoUpdate')) setTimeout(() => checkForUpdates(false), 15000);
}

init();
