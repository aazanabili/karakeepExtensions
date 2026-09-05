// New Tab dashboard: instant render from cache, silent background refresh, fuzzy search,
// one-click session restore. Dark/light + AR/EN follow the shared settings.

import { getSettings, getCache, saveSettings } from '../lib/settings.js';
import { resolveLang, makeT, applyI18n, applyTheme, relTime } from '../lib/i18n.js';
import { faviconUrl, hostOf, GROUP_COLORS } from '../lib/normalize.js';
import { loadHandle, saveHandle, requestPerm } from '../lib/drivers/localfs.js';

let settings;
let cache;
let lang;
let t;
let query = '';
let visibleLists = []; // filtered lists currently rendered

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const emptyEl = $('#empty');
const searchEl = $('#search');
const hintEl = $('#search-hint');
const statusEl = $('#status');
const bannerEl = $('#banner');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Subsequence fuzzy match (case-insensitive), substring counts as match too. */
function fuzzy(q, s) {
  q = q.trim().toLowerCase();
  s = (s || '').toLowerCase();
  if (!q) return true;
  if (s.includes(q)) return true;
  let i = 0;
  for (const ch of s) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

function send(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false }));
}

// ---- Rendering ---------------------------------------------------------------

function sortLists(lists) {
  const non = settings.nonListName || 'non';
  return [...lists].sort((a, b) => {
    if (a.name === non) return 1;
    if (b.name === non) return -1;
    return a.name.localeCompare(b.name);
  });
}

function filterLists(lists) {
  if (!query.trim()) return lists.map((l) => ({ ...l, shownItems: l.items }));
  const out = [];
  for (const l of lists) {
    if (fuzzy(query, l.name)) {
      out.push({ ...l, shownItems: l.items });
      continue;
    }
    const items = l.items.filter((i) => fuzzy(query, i.title) || fuzzy(query, i.url));
    if (items.length) out.push({ ...l, shownItems: items });
  }
  return out;
}

function render() {
  visibleLists = sortLists(filterLists(cache.lists || []));

  emptyEl.hidden = visibleLists.length > 0;
  grid.innerHTML = visibleLists.map((list, li) => {
    const color = GROUP_COLORS[list.color] || 'var(--muted)';
    const liveBadge = list.live === false
      ? `<span class="live-badge archived">${esc(t('archivedBadge'))}</span>`
      : `<span class="live-badge live">${esc(t('liveBadge'))}</span>`;
    const items = list.shownItems.map((item) => `
      <li class="link-item" data-url="${esc(item.url)}" title="${esc(item.url)}">
        <img src="${esc(faviconUrl(item.url))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="link-text">
          <span class="link-title">${esc(item.title || item.url)}</span>
          <span class="link-host">${esc(hostOf(item.url))}</span>
        </span>
      </li>`).join('');

    return `
    <section class="card" data-list="${esc(list.name)}">
      <div class="card-head">
        <span class="color-dot" style="background:${esc(color)}"></span>
        <span class="card-name" title="${esc(list.name)}">${esc(list.name)}</span>
        ${liveBadge}
        <span class="count-badge">${list.items.length} ${esc(t('linksLabel'))}</span>
      </div>
      <div class="card-meta">${esc(t('updated'))}: ${esc(relTime(list.updatedAt, lang) || '—')}</div>
      <div class="card-actions">
        <button data-act="window" data-li="${li}">${esc(t('openInNewWindow'))}</button>
        <button data-act="here" data-li="${li}">${esc(t('openHere'))}</button>
        <button data-act="copy" data-li="${li}">${esc(t('copyAll'))}</button>
      </div>
      <ul class="links">${items}</ul>
    </section>`;
  }).join('');

  renderHint();
}

function renderHint() {
  if (!query.trim()) {
    hintEl.hidden = true;
    return;
  }
  const total = visibleLists.reduce((n, l) => n + l.shownItems.length, 0);
  if (total === 0) {
    hintEl.textContent = t('noResults');
    hintEl.hidden = false;
  } else {
    hintEl.hidden = true;
  }
}

async function renderStatus() {
  const r = await send({ type: 'getState' });
  const st = r?.sync || {};
  if (st.lastError && st.dirty) {
    statusEl.textContent = t('syncError');
    statusEl.className = 'status-pill error';
    statusEl.title = st.lastError;
  } else if (st.dirty) {
    statusEl.textContent = t('syncPending');
    statusEl.className = 'status-pill pending';
    statusEl.title = '';
  } else {
    statusEl.textContent = t('syncOk');
    statusEl.className = 'status-pill ok';
    statusEl.title = `${t('lastSync')}: ${st.lastSync ? relTime(st.lastSync, lang) : t('never')}`;
  }
}

// ---- Banner (folder permission / not configured) ------------------------------

function showBanner(text, btnText, onClick) {
  $('#banner-text').textContent = text;
  const btn = $('#banner-btn');
  btn.textContent = btnText;
  btn.onclick = onClick;
  bannerEl.hidden = false;
}

async function checkReadiness() {
  if (settings.driver === 'local') {
    const res = await send({ type: 'refreshCache' });
    if (!res?.ok && (res.reason === 'NEED_PERMISSION' || res.reason === 'NO_FOLDER')) {
      showBanner(t('folderNeeded'), t('grantRetry'), async () => {
        let handle = await loadHandle();
        if (!handle && 'showDirectoryPicker' in window) {
          try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
          await saveHandle(handle);
        }
        if (handle && (await requestPerm(handle)) === 'granted') {
          bannerEl.hidden = true;
          await send({ type: 'refreshCache' });
          await send({ type: 'syncNow' });
        }
      });
    }
  } else if (!settings.serverUrl || !settings.apiKey) {
    showBanner(t('notConfigured'), t('settings'), () => chrome.runtime.openOptionsPage());
  } else {
    send({ type: 'refreshCache' }); // silent background refresh
  }
}

// ---- Actions ------------------------------------------------------------------

grid.addEventListener('click', async (e) => {
  const linkEl = e.target.closest('.link-item');
  if (linkEl) {
    chrome.tabs.create({ url: linkEl.dataset.url, active: true });
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const list = visibleLists[Number(btn.dataset.li)];
  if (!list) return;

  if (btn.dataset.act === 'copy') {
    await navigator.clipboard.writeText(list.items.map((i) => i.url).join('\n'));
    btn.textContent = t('copied');
    setTimeout(() => { btn.textContent = t('copyAll'); }, 1500);
    return;
  }

  btn.disabled = true;
  const res = await send({ type: 'restore', name: list.name, mode: btn.dataset.act === 'here' ? 'current' : 'window' });
  btn.disabled = false;
  if (!res?.ok) console.warn('restore failed', res);
});

searchEl.addEventListener('input', () => {
  query = searchEl.value;
  render();
});

searchEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const total = visibleLists.reduce((n, l) => n + l.shownItems.length, 0);
  if (total === 0 && query.trim()) {
    // No local results -> hand off to the default search engine.
    try {
      chrome.search.query({ text: query.trim(), disposition: 'CURRENT_TAB' });
    } catch {
      window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query.trim());
    }
  } else {
    const first = grid.querySelector('.link-item');
    if (first) chrome.tabs.create({ url: first.dataset.url, active: true });
  }
});

$('#btn-refresh').addEventListener('click', async () => {
  await send({ type: 'refreshCache' });
  cache = await getCache();
  render();
});

$('#btn-sync').addEventListener('click', async (e) => {
  const syncBtn = e.currentTarget; // currentTarget is null after the first await
  syncBtn.disabled = true;
  statusEl.textContent = t('syncingNow');
  await send({ type: 'syncNow' });
  cache = await getCache();
  syncBtn.disabled = false;
  render();
  renderStatus();
});

$('#btn-theme').addEventListener('click', async () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  settings = await saveSettings({ theme: dark ? 'light' : 'dark' });
  applyTheme(settings.theme);
});

$('#btn-lang').addEventListener('click', async () => {
  settings = await saveSettings({ lang: lang === 'ar' ? 'en' : 'ar' });
  lang = resolveLang(settings);
  t = makeT(lang);
  applyI18n(document, t, lang);
  render();
  renderStatus();
});

$('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

// Live updates: any cache/sync change re-renders (e.g. after background refresh).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cache) {
    cache = changes.cache.newValue || { lists: [], fetchedAt: 0 };
    render();
  }
  if (changes.sync) renderStatus();
});

// ---- Init ----------------------------------------------------------------------

(async () => {
  settings = await getSettings();
  cache = await getCache();
  lang = resolveLang(settings);
  t = makeT(lang);
  applyTheme(settings.theme);
  applyI18n(document, t, lang);
  render();          // zero-latency paint from cache
  renderStatus();
  checkReadiness();  // silent refresh / banners
  searchEl.focus();
})();
