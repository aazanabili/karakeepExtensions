import { resolveLang, makeT, applyI18n, applyTheme, relTime } from '../lib/i18n.js';

let lang;
let t;

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false }));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function render(state) {
  const { sync, activity, settings } = state;
  const pill = $('#state-pill');
  const error = $('#sync-error');
  error.hidden = true;
  error.textContent = '';

  const configured = settings.driver === 'local' || (settings.serverUrl && settings.apiKey);
  if (!configured) {
    pill.textContent = t('notConfigured');
    pill.className = 'pill error';
  } else if (sync.lastError && sync.dirty) {
    pill.textContent = t('syncError');
    pill.className = 'pill error';
    pill.title = sync.lastError;
    error.textContent = sync.lastError;
    error.hidden = false;
  } else if (sync.dirty) {
    pill.textContent = t('syncPending');
    pill.className = 'pill pending';
  } else {
    pill.textContent = t('syncOk');
    pill.className = 'pill ok';
  }

  $('#last-sync').textContent = sync.lastSync ? relTime(sync.lastSync, lang) : t('never');

  const ul = $('#activity');
  const rows = (activity || []).slice(0, 15);
  $('#empty-log').hidden = rows.length > 0;
  ul.innerHTML = rows.map((a) => `
    <li>
      <span class="kind ${esc(a.kind)}">${esc(a.kind)}</span>
      <span class="msg" title="${esc(a.msg)}">${esc(a.msg)}</span>
      <span class="when">${esc(relTime(a.ts, lang))}</span>
    </li>`).join('');
}

async function load() {
  const state = await send({ type: 'getState' });
  if (state && !state.error) render(state);
}

$('#btn-sync').addEventListener('click', async (e) => {
  const syncBtn = e.currentTarget; // currentTarget is null after the first await
  syncBtn.disabled = true;
  $('#state-pill').textContent = t('syncingNow');
  await send({ type: 'syncNow' });
  await load();
  syncBtn.disabled = false;
});

$('#btn-dash').addEventListener('click', () => chrome.tabs.create({}));
$('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') load(); });

(async () => {
  const state = await send({ type: 'getState' });
  const settings = state?.settings || {};
  lang = resolveLang(settings);
  t = makeT(lang);
  applyTheme(settings.theme || 'auto');
  applyI18n(document, t, lang);
  if (state && !state.error) render(state);
})();
