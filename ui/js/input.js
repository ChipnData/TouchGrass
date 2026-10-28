'use strict';
/* Keyboard and controller input for the desktop window and Big Screen. */

function openDialog() { return $$('dialog').find((d) => d.open) || null; }

function dialogFocusStep(d, step) {
  const items = $$('button:not([disabled]), input, select, a[href]', d).filter((e) => e.offsetParent !== null);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  items[(i + step + items.length) % items.length].focus();
}

function onKeyDown(e) {
  if (bs.active) { if (!openDialog()) bsKey(e); return; }
  if (openDialog()) return;
  if (!$('#ctx').hidden) { menuKeys(e); return; }
  const k = e.key;
  const lower = k.length === 1 ? k.toLowerCase() : k;
  const search = $('#search');
  if (k === 'F11') { e.preventDefault(); enterBigScreen(); return; }
  if (e.ctrlKey && lower === 'k') { e.preventDefault(); showView('games'); search.focus(); search.select(); return; }
  if (e.ctrlKey && k === ',') { e.preventDefault(); showView('settings'); return; }
  if (e.ctrlKey && lower === 'n') { e.preventDefault(); openAdd(); return; }
  if (k === 'F5') { e.preventDefault(); if (currentView === 'programs') scanPrograms(true); else scan(); return; }
  if (e.ctrlKey && lower === 'r') { e.preventDefault(); return; } // no accidental page reloads
  if (currentView !== 'games') { if (k === 'Escape' && !e.target.closest('input')) showView('games'); return; }

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
  if (k === ' ' && !e.target.closest('button')) { e.preventDefault(); openDetails(byId.get(selId)); return; }
  if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) {
    e.preventDefault();
    const t = tileFor(selId);
    if (t) gameMenu(byId.get(selId), t.querySelector('.more'));
    return;
  }
  if (e.ctrlKey && lower === 'd') { e.preventDefault(); toggleFav(byId.get(selId)); return; }
  if (k === 'Escape' && query) { search.value = ''; query = ''; selId = null; renderLibrary(); return; }
  // Type anywhere to search.
  if (!e.ctrlKey && !e.altKey && !e.metaKey && k.length === 1 && k !== ' ') search.focus();
}

// ---------------------------------------------------------------------------
// Controller (polls only while a pad is connected and the window has focus)
// ---------------------------------------------------------------------------
const pad = { raf: null, prev: [], dir: null, next: 0 };
function padStart() { if (!pad.raf) pad.raf = requestAnimationFrame(padLoop); }
function padPressed(p, i) { return !!(p.buttons[i] && p.buttons[i].pressed); }

function padButton(i) {
  if (bs.active && !openDialog()) { bsPad(i); return; }
  const d = openDialog();
  if (d) {
    if (i === 0 && document.activeElement && d.contains(document.activeElement)) document.activeElement.click();
    else if (i === 1) d.close();
    return;
  }
  const menuOpen = !$('#ctx').hidden;
  if (i === 9) { enterBigScreen(); return; }
  if (i === 0) {
    if (menuOpen) document.activeElement.click();
    else if (currentView === 'games') launch(byId.get(selId));
    else if (document.activeElement && document.activeElement.closest('#main')) document.activeElement.click();
  } else if (i === 1) {
    if (menuOpen) closeMenu();
    else if (currentView !== 'games') showView('games');
    else if (query) { $('#search').value = ''; query = ''; renderLibrary(); }
  } else if (i === 2 && currentView === 'games') {
    if (menuOpen) closeMenu();
    else { const t = tileFor(selId); gameMenu(byId.get(selId), t ? t.querySelector('.more') : { x: 200, y: 200 }); }
  } else if (i === 3 && currentView === 'games' && !menuOpen) toggleFav(byId.get(selId));
  else if ((i === 4 || i === 5) && currentView === 'games' && !menuOpen) {
    const avail = $$('#chips .chip:not(.coll)').map((c) => c.firstChild.textContent);
    const cur = avail.indexOf(S('source'));
    setSource(avail[(cur + (i === 5 ? 1 : -1) + avail.length) % avail.length]);
  }
}

function padDir(dir) {
  if (bs.active && !openDialog()) { bsMove(dir); return; }
  const d = openDialog();
  if (d) { dialogFocusStep(d, dir === 'down' || dir === 'right' ? 1 : -1); return; }
  if (!$('#ctx').hidden) {
    const items = $$('#ctx button');
    const i = items.indexOf(document.activeElement);
    if (dir === 'down') items[(i + 1) % items.length].focus();
    if (dir === 'up') items[(i - 1 + items.length) % items.length].focus();
    return;
  }
  if (currentView === 'games') { if (document.activeElement === $('#search')) $('#search').blur(); move(dir); }
}

function padLoop(t) {
  pad.raf = null;
  const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
  // Stop polling when unfocused; the window 'focus' handler restarts it.
  if (!p || !document.hasFocus()) { pad.prev = []; pad.dir = null; return; }
  for (const i of [0, 1, 2, 3, 4, 5, 9]) {
    const down = padPressed(p, i);
    if (down && !pad.prev[i]) padButton(i);
    pad.prev[i] = down;
  }
  const ax = p.axes[0] || 0;
  const ay = p.axes[1] || 0;
  let dir = null;
  if (padPressed(p, 12) || ay < -0.5) dir = 'up';
  else if (padPressed(p, 13) || ay > 0.5) dir = 'down';
  else if (padPressed(p, 14) || ax < -0.5) dir = 'left';
  else if (padPressed(p, 15) || ax > 0.5) dir = 'right';
  if (dir !== pad.dir) { pad.dir = dir; pad.next = t + 380; if (dir) padDir(dir); }
  else if (dir && t >= pad.next) { pad.next = t + 110; padDir(dir); }
  pad.raf = requestAnimationFrame(padLoop);
}

function anyPad() { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean); }
