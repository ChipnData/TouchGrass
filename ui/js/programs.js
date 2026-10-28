'use strict';
/* Programs tab: apps from the Start menu (each switched on or off by the
   user) and one-click website tiles. */

// Apps switched on automatically the first time they're found.
const DEFAULT_APPS = /^(google chrome|microsoft edge|(mozilla )?firefox|brave( browser)?|opera( gx)?( browser)?|vivaldi|discord|spotify|netflix|whatsapp|telegram( desktop)?|zoom( workplace)?|vlc media player|obs studio|file explorer|calculator|disney\+|prime video|microsoft teams|signal)$/i;

const SITE_PRESETS = [
  ['Facebook', 'https://www.facebook.com'], ['Instagram', 'https://www.instagram.com'],
  ['YouTube', 'https://www.youtube.com'], ['Gmail', 'https://mail.google.com'],
  ['Outlook', 'https://outlook.live.com'], ['Netflix', 'https://www.netflix.com'],
  ['Amazon', 'https://www.amazon.com'], ['Google', 'https://www.google.com'],
  ['Reddit', 'https://www.reddit.com'], ['X', 'https://x.com'],
  ['TikTok', 'https://www.tiktok.com'], ['WhatsApp', 'https://web.whatsapp.com'],
  ['Twitch', 'https://www.twitch.tv'], ['Disney+', 'https://www.disneyplus.com'],
  ['Spotify', 'https://open.spotify.com'], ['Pinterest', 'https://www.pinterest.com'],
  ['Weather', 'https://weather.com'], ['Google News', 'https://news.google.com'],
];

let progScanning = false;

function enabledPrograms() {
  return data.programs.list.filter((p) => data.programs.enabled[p.id]);
}

async function scanPrograms(manual) {
  if (progScanning) return;
  progScanning = true;
  const st = $('#prog-state');
  st.textContent = data.programs.list.length ? 'Checking for new apps…' : 'Finding your apps… (the first time takes a moment)';
  renderPrograms();
  try {
    const found = await invoke('scan_programs');
    let added = 0;
    for (const p of found) {
      if (data.programs.enabled[p.id] === undefined) {
        data.programs.enabled[p.id] = DEFAULT_APPS.test(p.name);
        if (data.programs.list.length) added++;
      }
    }
    data.programs.list = found;
    data.programs.at = Date.now();
    save();
    if (manual) toast(added ? `Found ${added} new app${added === 1 ? '' : 's'}` : 'Apps are up to date');
  } catch (e) { err(e); }
  progScanning = false;
  st.textContent = '';
  renderPrograms();
  if ($('#apps-dialog').open) renderAppsDialog();
  if (typeof bs !== 'undefined' && bs.active) bsRender();
}

function launchProgram(p) {
  invoke('launch_program', { id: p.id }).then(() => toast(`Opening ${p.name}…`)).catch(err);
}
function openSite(s) {
  invoke('open_website', { url: s.url, appWindow: !!s.app }).then(() => toast(`Opening ${s.name}…`)).catch(err);
}

function appTile(name, icon, onOpen, onMenu) {
  const b = el('button', 'app-tile');
  b.type = 'button';
  b.append(icon, el('span', 'nm', name));
  b.onclick = onOpen;
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); });
  return b;
}

function renderPrograms() {
  const ag = $('#app-grid');
  ag.replaceChildren();
  const apps = enabledPrograms();
  for (const p of apps) {
    ag.append(appTile(p.name, iconEl([fileUrl(p.icon)], p.name), () => launchProgram(p), (at) => openMenu([
      { label: 'Open', run: () => launchProgram(p) },
      { label: 'Remove from Programs', run: () => { data.programs.enabled[p.id] = false; save(); renderPrograms(); } },
    ], at)));
  }
  if (!apps.length) {
    const box = el('div', 'app-empty');
    box.append(el('span', null, progScanning ? 'Looking for apps on this PC…' : 'No apps chosen yet.'));
    if (!progScanning) box.append(btn('Choose apps', 'btn primary', openAppsDialog));
    ag.append(box);
  }

  const sg = $('#site-grid');
  sg.replaceChildren();
  for (const s of data.websites) {
    sg.append(appTile(s.name, iconEl(siteIconSrcs(s.url), s.name), () => openSite(s), (at) => openMenu([
      { label: 'Open', run: () => openSite(s) },
      { label: s.app ? 'Open in normal browser instead' : 'Open as app window instead', run: () => { s.app = !s.app; save(); toast(s.app ? `${s.name} will open as an app window` : `${s.name} will open in your browser`); } },
      { label: 'Edit…', run: () => openSiteDialog(s) },
      { label: 'Remove', danger: true, run: () => { data.websites = data.websites.filter((x) => x !== s); save(); renderPrograms(); } },
    ], at)));
  }
  if (!data.websites.length) {
    const box = el('div', 'app-empty');
    box.append(el('span', null, 'Add one-click buttons for the sites you use most — Facebook, YouTube, email and so on.'), btn('Add website', 'btn primary', () => openSiteDialog()));
    sg.append(box);
  }
}

// ---------------------------------------------------------------------------
// Choose apps dialog
// ---------------------------------------------------------------------------
let appsFilter = '';
function openAppsDialog() {
  appsFilter = '';
  renderAppsDialog();
  $('#apps-dialog').showModal();
  if (!data.programs.list.length) scanPrograms(false);
}

function renderAppsDialog() {
  const body = $('#apps-body');
  body.replaceChildren();
  const head = el('div', 'dialog-head');
  const h = el('h2', null, 'Choose apps');
  h.id = 'ap-title';
  head.append(h, btn('Rescan', 'btn', () => scanPrograms(true)), btn('✕', 'x-btn', () => $('#apps-dialog').close()));
  body.append(head, el('p', 'muted', 'Switch on the apps you want on the Programs tab. Browsers and popular apps start switched on.'));

  const search = el('input', 'plain');
  search.type = 'search';
  search.placeholder = 'Filter apps';
  search.value = appsFilter;
  search.style.width = '100%';
  search.addEventListener('input', () => { appsFilter = search.value; drawRows(); });
  body.append(search);
  const listBox = el('div', 'app-list');
  body.append(listBox);

  function drawRows() {
    listBox.replaceChildren();
    if (progScanning && !data.programs.list.length) { listBox.append(el('div', 'app-row', 'Finding your apps…')); return; }
    const q = norm(appsFilter);
    const items = data.programs.list.filter((p) => !q || norm(p.name).includes(q));
    for (const p of items) {
      const row = el('label', 'app-row');
      const sw = el('input');
      sw.type = 'checkbox';
      sw.setAttribute('role', 'switch');
      sw.checked = !!data.programs.enabled[p.id];
      sw.onchange = () => { data.programs.enabled[p.id] = sw.checked; save(); renderPrograms(); };
      row.append(iconEl([fileUrl(p.icon)], p.name), el('span', 'nm', p.name), sw);
      listBox.append(row);
    }
    if (!items.length) listBox.append(el('div', 'app-row', 'No apps match.'));
  }
  drawRows();
  setTimeout(() => search.focus(), 30);
}

// ---------------------------------------------------------------------------
// Website dialog
// ---------------------------------------------------------------------------
function cleanUrl(u) {
  let s = (u || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { const x = new URL(s); return x.hostname.includes('.') ? x.href : null; } catch { return null; }
}

function openSiteDialog(existing) {
  const body = $('#site-body');
  body.replaceChildren();
  const head = el('div', 'dialog-head');
  const h = el('h2', null, existing ? `Edit ${existing.name}` : 'Add websites');
  h.id = 's-title';
  head.append(h, btn('✕', 'x-btn', () => $('#site-dialog').close()));
  body.append(head);

  const have = new Set(data.websites.map((s) => s.url.replace(/\/$/, '')));
  const picks = [];
  if (!existing) {
    body.append(el('h3', 'section-title', 'Popular'));
    const grid = el('div', 'preset-grid');
    for (const [name, url] of SITE_PRESETS) {
      if (have.has(url)) continue;
      const lab = el('label', 'preset');
      const cb = el('input');
      cb.type = 'checkbox';
      picks.push([cb, name, url]);
      lab.append(cb, iconEl(siteIconSrcs(url), name), el('span', null, name));
      grid.append(lab);
    }
    body.append(grid, el('h3', 'section-title', 'Or add any site'));
    body.lastChild.style.marginTop = '18px';
  }

  const nameF = el('label', 'field');
  const nameI = el('input');
  nameI.type = 'text';
  nameI.placeholder = 'e.g. My bank';
  nameI.value = existing ? existing.name : '';
  nameF.append(el('span', null, 'Name'), nameI);
  const urlF = el('label', 'field');
  const urlI = el('input');
  urlI.type = 'url';
  urlI.placeholder = 'e.g. mybank.com';
  urlI.value = existing ? existing.url : '';
  urlF.append(el('span', null, 'Web address'), urlI);
  const appRow = el('label', 'check-row');
  const appCb = el('input');
  appCb.type = 'checkbox';
  appCb.checked = existing ? !!existing.app : false;
  const appTxt = el('span');
  appTxt.append(el('b', null, 'Open as an app window'), el('br'), el('small', 'muted', 'A clean window with no tabs or address bar — simpler for anyone who finds browsers confusing.'));
  appRow.append(appCb, appTxt);
  body.append(nameF, urlF, appRow);

  const actions = el('div', 'dialog-actions');
  actions.append(btn('Cancel', 'btn', () => $('#site-dialog').close()), btn(existing ? 'Save' : 'Add', 'btn primary', () => {
    const typed = urlI.value.trim();
    const url = typed ? cleanUrl(typed) : null;
    if (typed && !url) { toast('That web address doesn’t look right', { err: true }); urlI.focus(); return; }
    if (existing) {
      if (!url) { urlI.focus(); return; }
      existing.url = url;
      existing.name = nameI.value.trim() || new URL(url).hostname.replace(/^www\./, '');
      existing.app = appCb.checked;
    } else {
      let n = 0;
      for (const [cb, name, u] of picks) if (cb.checked) { data.websites.push({ id: uid(), name, url: u, app: appCb.checked }); n++; }
      if (url) { data.websites.push({ id: uid(), name: nameI.value.trim() || new URL(url).hostname.replace(/^www\./, ''), url, app: appCb.checked }); n++; }
      if (!n) { toast('Tick a site or type a web address'); return; }
    }
    save();
    renderPrograms();
    $('#site-dialog').close();
  }));
  body.append(actions);
  $('#site-dialog').showModal();
}
