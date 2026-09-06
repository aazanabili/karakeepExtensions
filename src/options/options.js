import { getSettings, saveSettings, K } from '../lib/settings.js';
import { resolveLang, makeT, applyI18n, applyTheme } from '../lib/i18n.js';
import { KarakeepDriver } from '../lib/drivers/karakeep.js';
import { saveHandle, loadHandle, queryPerm, requestPerm } from '../lib/drivers/localfs.js';

let lang;
let t;

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false }));

function result(el, ok, msgKey, extra = '') {
  el.textContent = t(msgKey) + (extra ? `: ${extra}` : '');
  el.className = 'test-result ' + (ok ? 'ok-text' : 'err-text');
}

function toggleDriverSections(driver) {
  $('#fs-karakeep').hidden = driver !== 'karakeep';
  $('#fs-local').hidden = driver !== 'local';
}

// ---- Load / save --------------------------------------------------------------

async function load() {
  const s = await getSettings();
  document.querySelector(`input[name="driver"][value="${s.driver}"]`).checked = true;
  $('#server-url').value = s.serverUrl;
  $('#api-key').value = s.apiKey;
  $('#delete-mode').value = s.deleteMode;
  $('#non-name').value = s.nonListName;
  $('#theme').value = s.theme;
  $('#lang').value = s.lang;
  toggleDriverSections(s.driver);
  refreshFolderStatus();
}

async function save() {
  const driver = document.querySelector('input[name="driver"]:checked')?.value || 'karakeep';
  const serverUrl = $('#server-url').value.trim();

  // Host permission must exist before the background can call the server.
  // The Save click is a user gesture, so we can request it here (not only via Test).
  if (driver === 'karakeep' && serverUrl) {
    try {
      const origin = new URL(serverUrl).origin + '/*';
      const has = await chrome.permissions.contains({ origins: [origin] });
      if (!has) {
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) result($('#test-result'), false, 'testFail', 'permission denied');
      }
    } catch { /* invalid URL — validation below will surface it */ }
  }

  const s = await saveSettings({
    driver,
    serverUrl,
    apiKey: $('#api-key').value.trim(),
    deleteMode: $('#delete-mode').value,
    nonListName: $('#non-name').value.trim() || 'non',
    theme: $('#theme').value,
    lang: $('#lang').value
  });
  await send({ type: 'settingsChanged' });
  $('#saved').hidden = false;
  setTimeout(() => { $('#saved').hidden = true; }, 2000);
  return s;
}

// ---- Karakeep: permission + test ------------------------------------------------

$('#btn-test').addEventListener('click', async () => {
  const out = $('#test-result');
  const url = $('#server-url').value.trim();
  const key = $('#api-key').value.trim();
  if (!url || !key) { result(out, false, 'testFail', 'missing URL/key'); return; }

  // Request host access for exactly this server (optional_host_permissions).
  try {
    const origin = new URL(url).origin + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) { result(out, false, 'testFail', 'permission denied'); return; }
  } catch (e) {
    result(out, false, 'testFail', String(e?.message || e));
    return;
  }

  try {
    const driver = new KarakeepDriver(url, key);
    const lists = await driver.getLists();
    result(out, true, 'testOk', `${lists.length} lists`);
  } catch (e) {
    result(out, false, 'testFail', String(e?.message || e));
  }
});

// ---- Local folder ---------------------------------------------------------------

async function refreshFolderStatus() {
  const el = $('#folder-status');
  const handle = await loadHandle();
  if (!handle) { el.textContent = ''; el.onclick = null; return; }
  const perm = await queryPerm(handle);
  if (perm === 'granted') {
    el.textContent = `${t('folderOk')}: ${handle.name}`;
    el.className = 'test-result ok-text';
    el.onclick = null;
    el.style.cursor = 'default';
  } else {
    // 'prompt' or 'denied' — needs a user gesture to (re)grant
    el.textContent = `${handle.name} — ${t('permOnce')}`;
    el.className = 'test-result err-text';
    el.style.cursor = 'pointer';
    el.onclick = async () => {
      if ((await requestPerm(handle)) === 'granted') refreshFolderStatus();
    };
  }
}

$('#btn-folder').addEventListener('click', async () => {
  if (!('showDirectoryPicker' in window)) return;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(handle);
    await refreshFolderStatus();
  } catch {
    // user cancelled
  }
});

// Open chrome://extensions page for THIS extension so user can grant permanent
// file access manually (the only reliable persistent method for extensions).
$('#btn-ext-settings').addEventListener('click', async () => {
  const isEdge = navigator.userAgent.includes('Edg/');
  const url = (isEdge ? 'edge://extensions/' : 'chrome://extensions/') + '?id=' + chrome.runtime.id;
  await chrome.tabs.create({ url });
});

// ---- Backup (export / import) -----------------------------------------------------

$('#btn-export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tabsync-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import-file').addEventListener('change', async (e) => {
  const out = $('#import-result');
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const allowed = [
      K.SETTINGS, K.CACHE, K.META, K.ACTIVITY, K.MANAGED, K.KNOWN_FILES,
      K.QUICK_LINKS, K.QUICK_LINKS_MIGRATED, K.SEARCH_ENGINE
    ];
    const clean = {};
    for (const key of allowed) if (data[key] !== undefined) clean[key] = data[key];
    if (!Object.keys(clean).length) throw new Error('empty');
    await chrome.storage.local.set(clean);
    result(out, true, 'importOk');
    await load();
    await send({ type: 'settingsChanged' });
  } catch {
    result(out, false, 'importFail');
  }
  e.target.value = '';
});

// ---- Wiring ------------------------------------------------------------------------

document.querySelectorAll('input[name="driver"]').forEach((r) =>
  r.addEventListener('change', (e) => toggleDriverSections(e.target.value)));

$('#btn-save').addEventListener('click', save);

(async () => {
  const s = await getSettings();
  lang = resolveLang(s);
  t = makeT(lang);
  applyTheme(s.theme);
  applyI18n(document, t, lang);
  await load();
})();
