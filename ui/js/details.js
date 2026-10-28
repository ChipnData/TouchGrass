'use strict';
/* Game details dialog and the cover-art picker. */

let detailsId = null;

function openDetails(g) {
  if (!g) return;
  detailsId = g.id;
  renderDetails();
  const d = $('#details');
  if (!d.open) d.showModal();
  const play = $('#d-play');
  if (play) play.focus();
}

function renderDetails() {
  const g = byId.get(detailsId);
  const body = $('#details-body');
  if (!g) { $('#details').close(); return; }
  body.replaceChildren();

  const cover = el('div', 'd-cover');
  fillCover(cover, g);

  const main = el('div', 'd-main');
  const head = el('div', 'dialog-head');
  const h = el('h2', null, g.title);
  h.id = 'd-title';
  const x = btn('✕', 'x-btn', () => $('#details').close());
  x.setAttribute('aria-label', 'Close');
  head.append(h, x);

  const m = el('div', 'd-meta');
  m.append(srcTag(g.source), el('span', null, g.installed ? 'Installed' : 'Not installed'));
  if (g.sizeBytes) m.append(el('span', null, `· ${fmtSize(g.sizeBytes)}`));
  if (g.hidden) m.append(el('span', null, '· Hidden'));

  const stats = el('div', 'd-stats');
  const stat = (v, l) => { const s = el('div', 'd-stat'); s.append(el('b', null, v || '—'), el('span', null, l)); stats.append(s); };
  stat(fmtTime(g.playtimeMin), g.source === 'Steam' || g.source === 'Custom' ? 'Played' : 'Played (tracked here)');
  stat(rel(g.lastPlayed), 'Last played');
  stat(g.added > 1 ? rel(g.added) : '', 'Added');

  const actions = el('div', 'd-actions');
  const play = btn(g.installed ? 'Play' : `Install on ${g.source}`, 'btn primary big', () => { launch(g); $('#details').close(); });
  play.id = 'd-play';
  if (g.installed) play.insertAdjacentHTML('afterbegin', SVG_PLAY);
  actions.append(
    play,
    btn(g.fav ? 'Unpin' : 'Pin to top', 'btn big', () => { toggleFav(g); renderDetails(); }),
    btn('Change cover', 'btn big', () => openCoverPicker(g)),
  );

  main.append(head, m);
  if (running.has(g.id)) {
    const r = el('div', 'd-running');
    r.append(el('b', null, 'Playing now'), el('span', 'spacer'));
    if ((running.get(g.id) || []).length) r.append(btn('Close game', 'btn small danger', async () => { await closeGame(g); renderDetails(); }));
    main.append(r);
  }
  main.append(stats, actions);

  // Collections
  const cs = el('div', 'd-section');
  cs.append(el('h3', null, 'Collections'));
  const cl = el('div', 'd-colls');
  for (const c of data.collections) {
    const on = c.games.includes(g.id);
    const b = el('button', 'chip coll', c.name);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => { toggleInCollection(c, g); renderDetails(); };
    cl.append(b);
  }
  cl.append(btn('+ New collection', 'chip coll', async () => { const c = await newCollection(g); if (c) renderDetails(); }));
  cs.append(cl);
  main.append(cs);

  // Manage
  const ms = el('div', 'd-section');
  ms.append(el('h3', null, 'Manage'));
  const ml = el('div', 'd-actions');
  if (g.installDir) ml.append(btn('Open folder', 'btn small', () => invoke('open_folder', { path: g.installDir }).catch(err)));
  if (g.storeUrl) ml.append(btn('Store page', 'btn small', () => invoke('open_link', { url: g.storeUrl }).catch(err)));
  if (g.source === 'Custom') {
    ml.append(btn('Edit', 'btn small', () => { $('#details').close(); openAdd(data.custom.find((c) => c.id === g.id)); }));
    ml.append(btn('Remove', 'btn small danger', () => { $('#details').close(); removeCustom(g); }));
  } else if (g.installed) {
    ml.append(btn('Uninstall', 'btn small', () => uninstall(g)));
  }
  ml.append(btn(g.hidden ? 'Unhide' : 'Hide', 'btn small', () => { toggleHidden(g); renderDetails(); }));
  ms.append(ml);
  if (g.source === 'Custom' && g.launch.args) ms.append(el('p', 'muted small', `Launch options: ${g.launch.args}`));
  main.append(ms);

  body.append(cover, main);
}

// ---------------------------------------------------------------------------
// Cover picker
// ---------------------------------------------------------------------------
let coverFor = null;

function openCoverPicker(g) {
  coverFor = g.id;
  renderCoverPicker(g.title);
  const d = $('#cover-dialog');
  if (!d.open) d.showModal();
}

async function setCover(url) {
  const g = byId.get(coverFor);
  if (!g) return;
  data.covers[g.id] = url;
  save();
  refresh();
  $('#cover-dialog').close();
  if ($('#details').open) renderDetails();
  toast(`Cover updated for ${g.title}`);
}

function renderCoverPicker(term) {
  const g = byId.get(coverFor);
  const body = $('#cover-body');
  body.replaceChildren();
  const head = el('div', 'dialog-head');
  const h = el('h2', null, `Cover for ${g ? g.title : ''}`);
  h.id = 'c-title';
  head.append(h, btn('✕', 'x-btn', () => $('#cover-dialog').close()));
  body.append(head);

  const fileRow = el('div', 'd-actions');
  fileRow.append(btn('Choose a picture from this PC…', 'btn', async () => {
    const p = await invoke('pick_file', { kind: 'image' }).catch(err);
    if (p) setCover(p);
  }));
  if (g && data.covers[g.id]) {
    fileRow.append(btn('Reset to default', 'btn', () => {
      delete data.covers[g.id]; save(); refresh(); $('#cover-dialog').close(); if ($('#details').open) renderDetails();
    }));
  }

  const key = S('sgdbKey');
  if (!key) {
    const box = el('div', 'notice');
    box.append(
      el('p', null, 'Touch Grass can search SteamGridDB, a free community art library, for covers. It needs a free key, set up once:'),
    );
    const ol = el('ol');
    for (const s of ['Sign in at steamgriddb.com (a Steam login works).', 'Open Preferences → API and press “Generate API key”.', 'Paste the key below.']) ol.append(el('li', null, s));
    box.append(ol);
    const row = el('div', 'pick');
    const input = el('input');
    input.type = 'password';
    input.placeholder = 'Paste your SteamGridDB key';
    row.append(input,
      btn('Open steamgriddb.com', 'btn', () => invoke('open_link', { url: 'https://www.steamgriddb.com/profile/preferences/api' }).catch(err)),
      btn('Save key', 'btn primary', () => {
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        setS('sgdbKey', v);
        const s = $('[data-setting="sgdbKey"]');
        if (s) s.value = v;
        renderCoverPicker(term);
      }));
    box.append(row);
    body.append(box, fileRow);
    return;
  }

  const search = el('form', 'pick');
  const input = el('input');
  input.type = 'text';
  input.value = term;
  input.setAttribute('aria-label', 'Search SteamGridDB');
  search.append(input, btn('Search', 'btn primary'));
  search.querySelector('button').type = 'submit';
  search.onsubmit = (e) => { e.preventDefault(); loadSgdb(input.value.trim()); };
  const games = el('div', 'sgdb-games');
  games.id = 'sgdb-games';
  const grid = el('div', 'cover-pick');
  grid.id = 'sgdb-grid';
  body.append(search, games, grid, fileRow);
  loadSgdb(term);
}

async function loadSgdb(term) {
  const key = S('sgdbKey');
  const games = $('#sgdb-games');
  const grid = $('#sgdb-grid');
  if (!games || !term) return;
  games.replaceChildren(el('span', 'muted', 'Searching…'));
  grid.replaceChildren();
  try {
    const found = await invoke('sgdb_search', { key, term });
    games.replaceChildren();
    if (!found.length) { games.append(el('span', 'muted', 'No matches. Try a shorter name.')); return; }
    const pick = async (sg, b) => {
      $$('#sgdb-games .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      grid.replaceChildren(el('span', 'muted', 'Loading covers…'));
      try {
        const imgs = await invoke('sgdb_grids', { key, gameId: sg.id });
        grid.replaceChildren();
        if (!imgs.length) { grid.append(el('span', 'muted', 'No portrait covers for this one yet.')); return; }
        for (const im of imgs) {
          const c = el('button');
          c.type = 'button';
          c.setAttribute('aria-label', 'Use this cover');
          const img = new Image();
          img.loading = 'lazy';
          img.alt = '';
          img.src = im.thumb;
          c.append(img);
          c.onclick = () => setCover(im.url);
          grid.append(c);
        }
      } catch (e) { grid.replaceChildren(el('span', 'muted', String(e))); }
    };
    found.forEach((sg, i) => {
      const b = el('button', 'chip', sg.year ? `${sg.name} (${sg.year})` : sg.name);
      b.type = 'button';
      b.onclick = () => pick(sg, b);
      games.append(b);
      if (i === 0) pick(sg, b);
    });
  } catch (e) {
    games.replaceChildren(el('span', 'muted', String(e)));
  }
}
