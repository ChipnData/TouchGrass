'use strict';
/* Theme system: built-in themes, accent override, background picture,
   and import/export of themes as small JSON files. */

const THEME_KEYS = ['bg', 'rail', 'surface', 'surface-2', 'line', 'line-2', 'text', 'muted', 'muted-2', 'accent', 'accent-ink', 'danger'];

const THEMES = [
  { id: 'meadow', name: 'Meadow', vars: {
    bg: '#0F1712', rail: '#121C16', surface: '#17231B', 'surface-2': '#1F2E24', line: '#24352A', 'line-2': '#30453A',
    text: '#ECF1E4', muted: '#A2B39D', 'muted-2': '#BBC9B5', accent: '#8FD460', 'accent-ink': '#0F1712', danger: '#FF8A80' } },
  { id: 'picnic', name: 'Picnic', light: true, vars: {
    bg: '#F3F0E6', rail: '#EAE5D6', surface: '#FFFFFF', 'surface-2': '#EFEBDF', line: '#E0D9C7', 'line-2': '#CFC6B0',
    text: '#22261E', muted: '#5C6355', 'muted-2': '#454B3F', accent: '#3B8A2C', 'accent-ink': '#FFFFFF', danger: '#B3261E' } },
  { id: 'campfire', name: 'Campfire', vars: {
    bg: '#16110D', rail: '#1B1510', surface: '#221A13', 'surface-2': '#2C2219', line: '#35291E', 'line-2': '#473626',
    text: '#F5ECE2', muted: '#BBA898', 'muted-2': '#D0BFB0', accent: '#FF9F43', 'accent-ink': '#16110D', danger: '#FF8A80' } },
  { id: 'lake', name: 'Lake', vars: {
    bg: '#0E0F12', rail: '#121318', surface: '#16181D', 'surface-2': '#1E2129', line: '#22252C', 'line-2': '#2C3038',
    text: '#E8E9EC', muted: '#9AA0AA', 'muted-2': '#B4B9C2', accent: '#7CC4FF', 'accent-ink': '#0E0F12', danger: '#FF8A80' } },
  { id: 'night', name: 'Night Sky', vars: {
    bg: '#000000', rail: '#07070A', surface: '#0D0D12', 'surface-2': '#16161E', line: '#1C1C26', 'line-2': '#2A2A38',
    text: '#EDEBFA', muted: '#A09DB8', 'muted-2': '#BCB9D2', accent: '#B9A8FF', 'accent-ink': '#0D0B1A', danger: '#FF8A80' } },
  { id: 'sunset', name: 'Sunset', vars: {
    bg: '#170F1F', rail: '#1C1226', surface: '#21162D', 'surface-2': '#2B1D3A', line: '#342446', 'line-2': '#46315C',
    text: '#F7ECF6', muted: '#C1A9C3', 'muted-2': '#D6C2D6', accent: '#FF6FB5', 'accent-ink': '#170F1F', danger: '#FF8A80' } },
  { id: 'contrast', name: 'High Contrast', vars: {
    bg: '#000000', rail: '#000000', surface: '#0A0A0A', 'surface-2': '#1A1A1A', line: '#8A8A8A', 'line-2': '#C8C8C8',
    text: '#FFFFFF', muted: '#E0E0E0', 'muted-2': '#F0F0F0', accent: '#FFE600', 'accent-ink': '#000000', danger: '#FF6B6B' } },
];

function allThemes() {
  return THEMES.concat(data.customThemes || []);
}
function currentTheme() {
  const id = data.theme.id || 'meadow';
  return allThemes().find((t) => t.id === id) || THEMES[0];
}

function readableInk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#101410' : '#FFFFFF';
}

function applyTheme() {
  const t = currentTheme();
  const root = document.documentElement;
  const vars = { ...t.vars };
  if (data.theme.accent) {
    vars.accent = data.theme.accent;
    vars['accent-ink'] = readableInk(data.theme.accent);
  }
  for (const k of THEME_KEYS) if (vars[k]) root.style.setProperty(`--${k}`, vars[k]);
  if (t.light) root.setAttribute('data-light', ''); else root.removeAttribute('data-light');

  const bg = data.theme.bg ? fileUrl(data.theme.bg) : null;
  root.style.setProperty('--bg-image', bg ? `url("${bg}")` : 'none');
  root.style.setProperty('--bg-blur', `${data.theme.blur ?? 12}px`);
  root.style.setProperty('--bg-dim', String((data.theme.dim ?? 60) / 100));
  document.body.classList.toggle('has-bg', !!bg);
}

function renderThemeGrid() {
  const grid = $('#theme-grid');
  grid.replaceChildren();
  const cur = currentTheme().id;
  for (const t of allThemes()) {
    const b = el('button', 'theme-card');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(t.id === cur));
    const sw = el('div', 'sw');
    sw.style.background = t.vars.bg;
    sw.style.border = `1px solid ${t.vars['line-2']}`;
    for (const k of ['surface-2', 'accent', 'text']) { const i = el('i'); i.style.background = t.vars[k]; sw.append(i); }
    b.append(sw, el('span', null, t.name + (t.id === 'meadow' ? ' (default)' : '')));
    b.onclick = () => { data.theme.id = t.id; save(); applyTheme(); renderThemeGrid(); syncThemeControls(); };
    if (t.custom) {
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMenu([{ label: `Delete “${t.name}”`, danger: true, run: () => {
          data.customThemes = data.customThemes.filter((x) => x.id !== t.id);
          if (data.theme.id === t.id) data.theme.id = 'meadow';
          save(); applyTheme(); renderThemeGrid();
        } }], { x: e.clientX, y: e.clientY });
      });
    }
    grid.append(b);
  }
}

function syncThemeControls() {
  $('#t-accent').value = data.theme.accent || currentTheme().vars.accent;
  $('#t-blur').value = data.theme.blur ?? 12;
  $('#t-dim').value = data.theme.dim ?? 60;
  $('#t-bg-name').textContent = data.theme.bg ? data.theme.bg.split(/[\\/]/).pop() : 'None';
}

function initThemeControls() {
  renderThemeGrid();
  syncThemeControls();
  $('#t-accent').addEventListener('input', (e) => { data.theme.accent = e.target.value; applyTheme(); });
  $('#t-accent').addEventListener('change', save);
  $('#t-accent-reset').onclick = () => { delete data.theme.accent; save(); applyTheme(); syncThemeControls(); };
  $('#t-blur').addEventListener('input', (e) => { data.theme.blur = Number(e.target.value); applyTheme(); save(); });
  $('#t-dim').addEventListener('input', (e) => { data.theme.dim = Number(e.target.value); applyTheme(); save(); });
  $('#t-bg-pick').onclick = async () => {
    const p = await invoke('pick_file', { kind: 'image' }).catch(err);
    if (!p) return;
    data.theme.bg = p; save(); applyTheme(); syncThemeControls();
  };
  $('#t-bg-clear').onclick = () => { delete data.theme.bg; save(); applyTheme(); syncThemeControls(); };
  $('#t-export').onclick = async () => {
    const t = currentTheme();
    const vars = { ...t.vars };
    if (data.theme.accent) { vars.accent = data.theme.accent; vars['accent-ink'] = readableInk(data.theme.accent); }
    const name = data.theme.accent ? `${t.name} (custom)` : t.name;
    const ok = await invoke('save_json_file', {
      defaultName: `${name.replace(/[^\w -]+/g, '')}.touchgrass-theme.json`,
      content: { touchGrassTheme: 1, name, light: !!t.light, vars },
    }).catch(err);
    if (ok) toast('Theme saved');
  };
  $('#t-import').onclick = async () => {
    const p = await invoke('pick_file', { kind: 'theme' }).catch(err);
    if (!p) return;
    try {
      const j = await invoke('read_json_file', { path: p, kind: 'theme' });
      const t = validateTheme(j);
      data.customThemes.push(t);
      data.theme.id = t.id;
      delete data.theme.accent;
      save(); applyTheme(); renderThemeGrid(); syncThemeControls();
      toast(`Added theme “${t.name}”`);
    } catch (e) { err(e); }
  };
}

function validateTheme(j) {
  if (!j || j.touchGrassTheme !== 1 || typeof j.vars !== 'object') throw new Error('That file isn’t a Touch Grass theme');
  const vars = {};
  for (const k of THEME_KEYS) {
    const v = j.vars[k];
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) vars[k] = v;
  }
  for (const k of ['bg', 'surface', 'text', 'accent']) if (!vars[k]) throw new Error('That theme is missing colors');
  for (const k of THEME_KEYS) if (!vars[k]) vars[k] = THEMES[0].vars[k];
  const name = String(j.name || 'Imported theme').slice(0, 40);
  return { id: `custom:${uid()}`, name, light: !!j.light, custom: true, vars };
}
