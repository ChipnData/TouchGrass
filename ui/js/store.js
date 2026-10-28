'use strict';
/* Store tab: store apps/websites, cross-store deals, free games, Game Pass. */

const STORE_LIST = [
  { name: 'Steam', src: 'Steam', web: 'https://store.steampowered.com/', desc: 'The biggest PC store. Sales most weeks.' },
  { name: 'Epic Games', src: 'Epic', web: 'https://store.epicgames.com/en-US/', desc: 'Gives away free games every week.' },
  { name: 'GOG', src: 'GOG', web: 'https://www.gog.com/', desc: 'DRM-free games you keep forever, including classics.' },
  { name: 'Xbox / Game Pass', src: 'Xbox', web: 'https://www.xbox.com/en-US/games/all-games', desc: 'PC Game Pass and Microsoft Store games.', app: 'always' },
  { name: 'Battle.net', src: 'Battle.net', web: 'https://shop.battle.net/', desc: 'Blizzard and Activision games.' },
  { name: 'EA', src: 'EA', web: 'https://www.ea.com/games', desc: 'EA games and EA Play.', app: 'never' },
  { name: 'Ubisoft', src: 'Ubisoft', web: 'https://store.ubisoft.com/', desc: 'Ubisoft games and Ubisoft+.' },
  { name: 'Humble', src: 'Humble', web: 'https://www.humblebundle.com/store', desc: 'Bundles and deals that support charity.', app: 'never' },
  { name: 'Amazon Games', src: 'Amazon', web: 'https://gaming.amazon.com/', desc: 'Free games with Prime.' },
];
const DEAL_STORES = [['All stores', null], ['Steam', '1'], ['GOG', '7'], ['Humble', '11'], ['Epic', '25'], ['Fanatical', '15'], ['Green Man Gaming', '3']];
const DEAL_SORTS = [['Deal Rating', 'Best deals'], ['Savings', 'Biggest discount'], ['Price', 'Lowest price'], ['Recent', 'Newest deals'], ['Reviews', 'Best reviewed']];

let storeTab = 'stores';
const store = { dealStore: null, dealSort: 'Deal Rating', dealPage: 0, deals: [], dealNames: null, gpQuery: '' };
const memo = new Map();

async function cached(key, ms, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  return v;
}

function storeDetected(src) {
  return !!(data.lastScan && data.lastScan.sources && data.lastScan.sources.includes(src));
}
function ownedTitles() { return new Set(all.map((g) => norm(g.title))); }

/** Fills an art box from a list of URLs, falling back to the title. */
function fillArt(box, urls, title) {
  const list = urls.filter(Boolean);
  let i = 0;
  if (!list.length) { box.prepend(genCover(title)); return; }
  const img = new Image();
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => { if (++i < list.length) img.src = list[i]; else img.replaceWith(genCover(title)); };
  img.src = list[0];
  box.prepend(img);
}

// ---------------------------------------------------------------------------
// Data (shared with Big Screen)
// ---------------------------------------------------------------------------
function getDeals(storeId, sort, page, freeOnly = false) {
  return cached(`deals:${storeId}:${sort}:${page}:${freeOnly}`, 30 * 60e3, () =>
    invoke('deals', { storeId, sort, page, freeOnly }));
}
async function getDealStoreNames() {
  if (store.dealNames) return store.dealNames;
  try {
    const list = await cached('dealstores', 24 * 3600e3, () => invoke('deal_stores'));
    store.dealNames = Object.fromEntries(list.map((s) => [String(s.storeID), s.storeName]));
  } catch { store.dealNames = {}; }
  return store.dealNames;
}
function getEpicFree() { return cached('epicfree', 30 * 60e3, () => invoke('epic_free')); }
async function getGamePass() {
  const c = data.gpCache;
  if (c && Array.isArray(c.games) && c.games.length && Date.now() - c.at < 24 * 3600e3) return c.games;
  const games = await invoke('gamepass');
  data.gpCache = { at: Date.now(), games };
  save();
  return games;
}

function dealArt(d) {
  const a = d.steamAppID ? [`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${d.steamAppID}/header.jpg`] : [];
  return a.concat([d.thumb]);
}
function openDeal(d) {
  if (d.storeID === '1' && d.steamAppID) {
    if (storeDetected('Steam')) return invoke('open_uri', { uri: `steam://store/${d.steamAppID}` }).catch(err);
    return invoke('open_link', { url: `https://store.steampowered.com/app/${d.steamAppID}` }).catch(err);
  }
  return invoke('open_link', { url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID)}` }).catch(err);
}
function openEpicFree(f) {
  if (f.slug && storeDetected('Epic')) return invoke('open_uri', { uri: `com.epicgames.launcher://store/p/${encodeURIComponent(f.slug)}` }).catch(err);
  const url = f.slug ? `https://store.epicgames.com/en-US/p/${encodeURIComponent(f.slug)}` : 'https://store.epicgames.com/en-US/free-games';
  return invoke('open_link', { url }).catch(err);
}
function openGamePass(g) {
  invoke('open_uri', { uri: `ms-windows-store://pdp/?ProductId=${encodeURIComponent(g.id)}` }).catch(err);
}
function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const money = (v) => (Number(v) === 0 ? 'Free' : `$${Number(v).toFixed(2)}`);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderStore() {
  $$('#store-tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === storeTab)));
  const body = $('#store-body');
  body.replaceChildren();
  if (storeTab === 'stores') renderStoreCards(body);
  else if (storeTab === 'deals') renderDeals(body);
  else if (storeTab === 'free') renderFree(body);
  else renderGamePass(body);
}

function renderStoreCards(body) {
  body.append(el('p', 'lead', 'Open a store’s own app or its website. Buying, installing and updating still happen in each store’s app.'));
  const grid = el('div', 'store-grid');
  for (const s of STORE_LIST) {
    const c = el('article', 'store');
    const h = el('h3', null, s.name);
    const dot = el('i');
    Object.assign(dot.style, { width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block', background: SRC_DOT[s.src] });
    h.prepend(dot);
    const n = all.filter((g) => g.source === s.src && g.installed).length;
    c.append(h, el('p', null, s.desc), el('span', 'muted small', n ? `${n} installed` : ' '));
    const links = el('div', 'links');
    const showApp = s.app === 'always' || (s.app !== 'never' && storeDetected(s.src));
    if (showApp) links.append(btn('Open app', 'btn primary', () => invoke('open_store_app', { store: s.src }).catch(err)));
    links.append(btn('Open website', showApp ? 'btn' : 'btn primary', () => invoke('open_link', { url: s.web }).catch(err)));
    c.append(links);
    grid.append(c);
  }
  body.append(grid);
}

function dealCard(d, names, owned) {
  const b = el('button', 'deal');
  b.type = 'button';
  const art = el('div', 'art');
  fillArt(art, dealArt(d), d.title);
  if (owned.has(norm(d.title))) art.append(el('span', 'own', 'IN LIBRARY'));
  const info = el('div', 'info');
  info.append(el('span', 't', d.title));
  const price = el('div', 'price');
  const off = Math.round(Number(d.savings) || 0);
  if (off > 0) price.append(el('span', 'off', `-${off}%`));
  price.append(el('span', 'now', money(d.salePrice)));
  if (Number(d.normalPrice) > Number(d.salePrice)) price.append(el('s', null, money(d.normalPrice)));
  info.append(price, el('span', 'muted small', names[d.storeID] || 'Store'));
  b.append(art, info);
  b.title = d.storeID === '1' ? 'Opens in Steam' : 'Opens the store page in your browser';
  b.onclick = () => openDeal(d);
  return b;
}

async function renderDeals(body) {
  const bar = el('div', 'store-bar');
  for (const [label, id] of DEAL_STORES) {
    const c = el('button', 'chip', label);
    c.setAttribute('aria-pressed', String(store.dealStore === id));
    c.onclick = () => { store.dealStore = id; store.dealPage = 0; renderStore(); };
    bar.append(c);
  }
  const sortSel = el('select');
  sortSel.setAttribute('aria-label', 'Sort deals');
  for (const [v, l] of DEAL_SORTS) { const o = el('option', null, l); o.value = v; sortSel.append(o); }
  sortSel.value = store.dealSort;
  sortSel.onchange = () => { store.dealSort = sortSel.value; store.dealPage = 0; renderStore(); };
  const sortWrap = el('label', 'select');
  sortWrap.append(sortSel);
  bar.append(el('span', 'spacer'), sortWrap);
  body.append(bar);
  const grid = el('div', 'deal-grid');
  body.append(grid);
  grid.append(el('span', 'muted', 'Loading deals…'));
  const more = btn('Load more', 'btn load-more', async () => { store.dealPage++; more.disabled = true; await addPage(); more.disabled = false; });
  body.append(more, el('p', 'muted small', 'Prices in USD from CheapShark. Steam deals open in Steam; others open the store page in your browser.'));

  const names = await getDealStoreNames();
  const owned = ownedTitles();
  async function addPage() {
    try {
      const page = await getDeals(store.dealStore, store.dealSort, store.dealPage);
      if (store.dealPage === 0) grid.replaceChildren();
      page.forEach((d) => grid.append(dealCard(d, names, owned)));
      if (!page.length) more.hidden = true;
      if (!grid.children.length) grid.append(el('span', 'muted', 'No deals right now.'));
    } catch (e) {
      grid.replaceChildren(el('div', 'notice', `Couldn’t load deals: ${e}`));
      more.hidden = true;
    }
  }
  const pages = store.dealPage;
  store.dealPage = 0;
  await addPage();
  for (let p = 1; p <= pages; p++) { store.dealPage = p; await addPage(); }
}

async function renderFree(body) {
  body.append(el('h2', 'section-title', 'Free on Epic'));
  const epic = el('div', 'deal-grid');
  epic.append(el('span', 'muted', 'Loading…'));
  body.append(epic);
  const otherTitle = el('h2', 'section-title', 'Free to keep on other stores');
  otherTitle.style.marginTop = '24px';
  const other = el('div', 'deal-grid');
  other.append(el('span', 'muted', 'Loading…'));
  body.append(otherTitle, other);

  const owned = ownedTitles();
  getEpicFree().then((list) => {
    epic.replaceChildren();
    for (const f of list) {
      const b = el('button', 'deal tall');
      b.type = 'button';
      const art = el('div', 'art');
      fillArt(art, [f.image], f.title);
      art.append(el('span', 'when', f.status === 'now' ? `FREE UNTIL ${fmtDate(f.ends).toUpperCase()}` : `FREE ${fmtDate(f.starts).toUpperCase()}`));
      if (owned.has(norm(f.title))) art.append(el('span', 'own', 'IN LIBRARY'));
      const info = el('div', 'info');
      info.append(el('span', 't', f.title), el('span', 'muted small', f.status === 'now' ? 'Free now — claim it to keep it' : 'Coming soon'));
      b.append(art, info);
      b.onclick = () => openEpicFree(f);
      epic.append(b);
    }
    if (!list.length) epic.append(el('span', 'muted', 'No free games listed right now.'));
  }).catch((e) => epic.replaceChildren(el('div', 'notice', `Couldn’t load Epic’s free games: ${e}`)));

  Promise.all([getDeals(null, 'Recent', 0, true), getDealStoreNames()]).then(([list, names]) => {
    other.replaceChildren();
    const free = list.filter((d) => Number(d.salePrice) === 0 && d.storeID !== '25');
    free.forEach((d) => other.append(dealCard(d, names, owned)));
    if (!free.length) other.append(el('span', 'muted', 'Nothing free elsewhere at the moment.'));
  }).catch((e) => other.replaceChildren(el('div', 'notice', `Couldn’t load: ${e}`)));
}

async function renderGamePass(body) {
  const bar = el('div', 'store-bar');
  const search = el('label', 'search');
  search.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Search Game Pass';
  input.value = store.gpQuery;
  input.setAttribute('aria-label', 'Search Game Pass');
  search.append(input);
  const count = el('span', 'muted');
  bar.append(search, count, el('span', 'spacer'),
    btn('Open the Xbox app', 'btn', () => invoke('open_store_app', { store: 'Xbox' }).catch(err)));
  body.append(bar);
  const grid = el('div', 'deal-grid');
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(150px, 1fr))';
  grid.append(el('span', 'muted', 'Loading the PC Game Pass catalog…'));
  body.append(grid, el('p', 'muted small', 'Games currently in PC Game Pass (US). Clicking opens the game in the Microsoft Store, where Game Pass members can install it.'));

  let games;
  try { games = await getGamePass(); } catch (e) { grid.replaceChildren(el('div', 'notice', `Couldn’t load Game Pass: ${e}`)); return; }
  const owned = new Set(all.filter((g) => g.source === 'Xbox').map((g) => norm(g.title)));
  const draw = () => {
    const q = norm(store.gpQuery);
    const shown = games.filter((g) => !q || norm(g.title).includes(q));
    count.textContent = `${shown.length} games`;
    grid.replaceChildren();
    for (const g of shown) {
      const b = el('button', 'deal tall');
      b.type = 'button';
      const art = el('div', 'art');
      fillArt(art, [g.image], g.title);
      if (owned.has(norm(g.title))) art.append(el('span', 'own', 'INSTALLED'));
      const info = el('div', 'info');
      info.append(el('span', 't', g.title));
      b.append(art, info);
      b.onclick = () => openGamePass(g);
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMenu([{ label: 'Open in browser', run: () => invoke('open_link', { url: `https://www.xbox.com/en-US/games/store/x/${encodeURIComponent(g.id)}` }).catch(err) }], { x: e.clientX, y: e.clientY });
      });
      grid.append(b);
    }
  };
  input.addEventListener('input', () => { store.gpQuery = input.value; draw(); });
  draw();
}
