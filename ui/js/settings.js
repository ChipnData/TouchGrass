'use strict';
/* Settings screen. */

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
  invoke('get_autostart').then((v) => { auto.checked = v; syncStartupHint(); }).catch(() => {});
  auto.addEventListener('change', async () => {
    try {
      const actual = await invoke('set_autostart', { enabled: auto.checked });
      auto.checked = actual;
      toast(actual ? 'Touch Grass will start with Windows' : 'Touch Grass won’t start with Windows');
    } catch (e) { auto.checked = !auto.checked; err(e); }
    syncStartupHint();
  });

  const mode = $('#s-startup-mode');
  mode.value = S('startupMode');
  mode.addEventListener('change', async () => {
    if (mode.value === 'bigscreen') {
      const ok = await confirmBox(
        'Start in Big Screen?',
        'When Windows starts, Touch Grass will open full screen, like a console. You can always get back to the desktop from the power menu (☰ on a controller, or the power button at the top right) → Exit Big Screen.',
        'Use Big Screen',
      );
      if (!ok) { mode.value = S('startupMode'); return; }
    }
    setS('startupMode', mode.value);
    syncStartupHint();
  });

  $('#s-rescan').onclick = () => scan();
  $('#s-covers').onclick = () => findMissingCovers(true);
  $('#s-quit').onclick = () => invoke('quit_app');
  $('#s-update').onclick = () => checkForUpdates(true);
  $('#s-export').onclick = async () => {
    const ok = await invoke('save_json_file', { defaultName: 'touch-grass-backup.json', content: backupData() }).catch(err);
    if (ok) toast('Backup saved');
  };
  $('#s-import').onclick = restoreBackup;
  $$('[data-link]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    invoke('open_link', { url: a.dataset.link }).catch(err);
  }));
  $('#app-version').textContent = `Touch Grass ${ctx.version || ''}`.trim();
  initThemeControls();
}

function syncStartupHint() {
  const on = $('#s-autostart').checked;
  $('#startup-hint').textContent = on
    ? 'Takes effect the next time you sign in to Windows.'
    : 'Only applies when “Start with Windows” is on.';
}

function onSetting(k, v, inp) {
  if (k === 'closeToTray') invoke('set_close_to_tray', { enabled: v });
  if (k === 'controllerSummon') invoke('set_controller_summon', { enabled: v });
  if (k === 'hotkey') invoke('set_hotkey', { enabled: v }).catch((e) => { err(e); inp.checked = false; setS(k, false); });
  if (k === 'tileSize') document.documentElement.dataset.tile = v;
  if (k === 'showHidden') refresh();
  if ((k === 'steamApiKey' || k === 'steamId') && S('steamApiKey')) scan();
  if (k === 'sgdbKey' && v) { data.coverMiss = {}; findMissingCovers(false); }
  if (k === 'autoUpdate' && v) checkForUpdates(false);
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
  const n = all.filter((g) => !hasCover(g)).length;
  $('#cover-report').textContent = n ? `${n} game${n === 1 ? '' : 's'} using a generated tile.` : 'Every game has cover art.';
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------
async function checkForUpdates(manual) {
  const state = $('#update-state');
  if (manual) state.textContent = 'Checking…';
  try {
    const u = await invoke('check_update');
    if (!u) {
      state.textContent = `You’re up to date (${ctx.version}).`;
      if (manual) toast('Touch Grass is up to date');
      return;
    }
    state.textContent = `Version ${u.version} is available.`;
    toast(`Touch Grass ${u.version} is available`, { action: ['Update now', installUpdate] });
  } catch (e) {
    state.textContent = 'Couldn’t check for updates.';
    if (manual) toast(`Couldn’t check for updates: ${e}`, { err: true });
  }
}
async function installUpdate() {
  toast('Downloading the update… Touch Grass will restart by itself.');
  try { await invoke('install_update'); } catch (e) { err(e); }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
function backupData() {
  const copy = JSON.parse(JSON.stringify(data));
  delete copy.cache;
  delete copy.gpCache;
  delete copy.art;
  copy.touchGrassBackup = 1;
  copy.backupAt = new Date().toISOString();
  return copy;
}
async function restoreBackup() {
  const p = await invoke('pick_file', { kind: 'backup' }).catch(err);
  if (!p) return;
  try {
    const b = await invoke('read_json_file', { path: p, kind: 'backup' });
    const ok = await confirmBox('Restore this backup?', 'Your current settings, custom games, pins, collections, websites and themes will be replaced with the ones in the backup.', 'Restore');
    if (!ok) return;
    const keep = { cache: data.cache, art: data.art, gpCache: data.gpCache };
    data = normalizeData({ ...b, ...keep });
    delete data.touchGrassBackup;
    await invoke('save_data', { data });
    location.reload();
  } catch (e) { err(e); }
}
