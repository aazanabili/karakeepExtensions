// New Tab dashboard: quick links, web search, list filtering, session restore.
// Dark/light + AR/EN follow the shared settings.

import { getSettings, getCache, saveSettings, getQuickLinks, setQuickLinks, getSearchEngine, setSearchEngine } from '../lib/settings.js';
import { resolveLang, makeT, applyI18n, applyTheme, relTime } from '../lib/i18n.js';
import { faviconUrl, hostOf, GROUP_COLORS } from '../lib/normalize.js';
import { ENGINES, buildSearchUrl } from '../lib/engines.js';
import { loadHandle, saveHandle, requestPerm } from '../lib/drivers/localfs.js';

let settings;
let cache;
let quickLinks;
let lang;
let t;
let filterQuery = '';
let visibleLists = [];

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const emptyEl = $('#empty');
const filterSearchEl = $('#filter-search');
const hintEl = $('#search-hint');
const statusEl = $('#status');
const bannerEl = $('#banner');
const webSearchEl = $('#web-search');
const engineTabsEl = $('#engine-tabs');
const quickLinksEl = $('#quick-links');
const quickModal = $('#quick-modal');

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

// ---- Web Search (Primary) -----------------------------------------------------

async function renderEngines() {
  const activeId = await getSearchEngine();
  engineTabsEl.innerHTML = ENGINES.map((e) => `
    <button class="engine-tab ${e.id === activeId ? 'active' : ''}" data-id="${e.id}">
      <img src="${esc(e.icon)}" alt="" onerror="this.style.display='none'">
      <span>${esc(e.name[lang] || e.name.en)}</span>
    </button>
  `).join('');
}

async function handleWebSearch() {
  const query = webSearchEl.value.trim();
  if (!query) return;
  const engineId = await getSearchEngine();
  const engine = ENGINES.find((e) => e.id === engineId) || ENGINES[0];
  const url = buildSearchUrl(engine, query, lang);
  chrome.tabs.create({ url, active: true });
}

engineTabsEl.addEventListener('click', async (e) => {
  const tab = e.target.closest('.engine-tab');
  if (!tab) return;
  await setSearchEngine(tab.dataset.id);
  renderEngines();
});

$('#btn-web-search').addEventListener('click', handleWebSearch);
webSearchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleWebSearch();
});

// ---- Quick Links ---------------------------------------------------------------

async function renderQuickLinks() {
  quickLinks = await getQuickLinks();
  quickLinksEl.innerHTML = quickLinks.map((link, i) => `
    <div class="quick-link-item" draggable="true" data-index="${i}" title="${esc(link.url)}">
      <img draggable="false" src="${esc(faviconUrl(link.url))}" alt="" onerror="this.style.visibility='hidden'">
      <span class="title">${esc(link.title || hostOf(link.url))}</span>
      <button class="edit-btn" data-index="${i}" title="${esc(t('edit'))}">✎</button>
      <button class="remove-btn" data-index="${i}" title="${esc(t('remove'))}">×</button>
    </div>
  `).join('');
}

async function saveQuickLink(title, url) {
  // Add protocol if missing
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    url = new URL(url).href; // validate
  } catch {
    return false;
  }
  const links = await getQuickLinks();
  if (editingIndex >= 0 && links[editingIndex]) {
    // Edit in place: keep id + createdAt
    links[editingIndex] = { ...links[editingIndex], title: title || hostOf(url), url };
  } else {
    links.push({ id: crypto.randomUUID(), title: title || hostOf(url), url, createdAt: Date.now() });
  }
  await setQuickLinks(links);
  quickLinks = links;
  await renderQuickLinks();
  send({ type: 'syncNow' }).catch(() => {}); // new URL is appended to server on next sync
  return true;
}

async function removeQuickLink(index) {
  quickLinks.splice(index, 1);
  await setQuickLinks(quickLinks);
  await renderQuickLinks();
  // Note: we don't remove from server (protected list = append-only)
}

quickLinksEl.addEventListener('click', async (e) => {
  const removeBtn = e.target.closest('.remove-btn');
  if (removeBtn) {
    e.stopPropagation();
    await removeQuickLink(Number(removeBtn.dataset.index));
    return;
  }
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    e.stopPropagation();
    openQuickModal(Number(editBtn.dataset.index));
    return;
  }
  const item = e.target.closest('.quick-link-item');
  if (item) {
    const link = quickLinks[Number(item.dataset.index)];
    if (link) chrome.tabs.create({ url: link.url, active: true });
  }
});

// ---- Quick Links: drag & drop reorder -----------------------------------------

let dragIndex = -1;

function clearDropIndicators() {
  quickLinksEl.querySelectorAll('.drop-before,.drop-after')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

/** Nearest item to the cursor + whether to insert before/after it (RTL-aware). */
function dropTargetAt(clientX, clientY) {
  const items = [...quickLinksEl.querySelectorAll('.quick-link-item:not(.dragging)')];
  if (!items.length) return null;
  const rtl = getComputedStyle(quickLinksEl).direction === 'rtl';
  let best = null;
  let bestDist = Infinity;
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (cx - clientX) ** 2 + (cy - clientY) ** 2;
    if (d < bestDist) { bestDist = d; best = { el, mid: cx }; }
  }
  const before = rtl ? clientX > best.mid : clientX < best.mid;
  return { el: best.el, index: Number(best.el.dataset.index), before };
}

quickLinksEl.addEventListener('dragstart', (e) => {
  if (e.target.closest('button')) { e.preventDefault(); return; }
  const item = e.target.closest('.quick-link-item');
  if (!item) return;
  dragIndex = Number(item.dataset.index);
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(dragIndex)); } catch { /* not required */ }
});

quickLinksEl.addEventListener('dragover', (e) => {
  if (dragIndex < 0) return;
  e.preventDefault(); // allow drop
  e.dataTransfer.dropEffect = 'move';
  clearDropIndicators();
  const target = dropTargetAt(e.clientX, e.clientY);
  if (target) target.el.classList.add(target.before ? 'drop-before' : 'drop-after');
});

quickLinksEl.addEventListener('drop', async (e) => {
  if (dragIndex < 0) return;
  e.preventDefault();
  const target = dropTargetAt(e.clientX, e.clientY);
  clearDropIndicators();
  const from = dragIndex;
  dragIndex = -1;
  if (!target) return;
  const links = await getQuickLinks();
  if (from >= links.length) return;
  const [moved] = links.splice(from, 1);
  let insertAt = target.index + (target.before ? 0 : 1);
  if (from < insertAt) insertAt--; // adjust for the removal shift
  links.splice(Math.max(0, Math.min(insertAt, links.length)), 0, moved);
  await setQuickLinks(links);
  quickLinks = links;
  await renderQuickLinks();
});

quickLinksEl.addEventListener('dragend', () => {
  dragIndex = -1;
  clearDropIndicators();
  quickLinksEl.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
});

// ---- Quick Links: add / edit modal -------------------------------------------

let editingIndex = -1; // -1 = add mode

function openQuickModal(index = -1) {
  editingIndex = index;
  $('#quick-modal-title').textContent = index >= 0 ? t('editQuickLink') : t('addQuickLink');
  if (index >= 0 && quickLinks[index]) {
    $('#quick-title').value = quickLinks[index].title || '';
    $('#quick-url').value = quickLinks[index].url;
  } else {
    $('#quick-title').value = '';
    $('#quick-url').value = '';
  }
  $('#quick-url').style.borderColor = '';
  quickModal.hidden = false;
  setTimeout(() => (index >= 0 ? $('#quick-title') : $('#quick-url')).focus(), 50);
}

function closeQuickModal() {
  quickModal.hidden = true;
  editingIndex = -1;
}

$('#btn-add-quick').addEventListener('click', () => openQuickModal(-1));

$('#btn-quick-cancel').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeQuickModal();
});

$('#btn-quick-save').addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const title = $('#quick-title').value.trim();
  const url = $('#quick-url').value.trim();
  if (!url) {
    $('#quick-url').style.borderColor = 'var(--danger)';
    return;
  }
  const saveBtn = e.currentTarget;
  saveBtn.disabled = true;
  try {
    const ok = await saveQuickLink(title, url);
    if (ok) {
      closeQuickModal();
    } else {
      $('#quick-url').style.borderColor = 'var(--danger)';
    }
  } finally {
    saveBtn.disabled = false;
  }
});

// Close modal on backdrop click
quickModal.addEventListener('click', (e) => {
  if (e.target === quickModal) closeQuickModal();
});

quickModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') quickModal.hidden = true;
  if (e.key === 'Enter') $('#btn-quick-save').click();
});

// ---- List Filtering (Secondary) --------------------------------------------------

function sortLists(lists) {
  const non = settings.nonListName || 'non';
  return [...lists].sort((a, b) => {
    if (a.name === non) return 1;
    if (b.name === non) return -1;
    return a.name.localeCompare(b.name);
  });
}

function filterLists(lists) {
  if (!filterQuery.trim()) return lists.map((l) => ({ ...l, shownItems: l.items }));
  const out = [];
  for (const l of lists) {
    if (fuzzy(filterQuery, l.name)) {
      out.push({ ...l, shownItems: l.items });
      continue;
    }
    const items = l.items.filter((i) => fuzzy(filterQuery, i.title) || fuzzy(filterQuery, i.url));
    if (items.length) out.push({ ...l, shownItems: items });
  }
  return out;
}

function renderLists() {
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
  if (!filterQuery.trim()) {
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

filterSearchEl.addEventListener('input', () => {
  filterQuery = filterSearchEl.value;
  renderLists();
});

filterSearchEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const total = visibleLists.reduce((n, l) => n + l.shownItems.length, 0);
  if (total === 0 && filterQuery.trim()) {
    // No local results -> use web search with active engine
    webSearchEl.value = filterQuery.trim();
    handleWebSearch();
  } else {
    const first = grid.querySelector('.link-item');
    if (first) chrome.tabs.create({ url: first.dataset.url, active: true });
  }
});

// ---- Status & Banner ------------------------------------------------------------

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
      showBanner(`${t('folderNeeded')} ${t('folderHint')}`, t('grantRetry'), async () => {
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

// ---- List Actions ------------------------------------------------------------

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

// ---- Top Bar Actions --------------------------------------------------------

$('#btn-refresh').addEventListener('click', async () => {
  await send({ type: 'refreshCache' });
  cache = await getCache();
  renderLists();
});

$('#btn-sync').addEventListener('click', async (e) => {
  const syncBtn = e.currentTarget;
  syncBtn.disabled = true;
  statusEl.textContent = t('syncingNow');
  await send({ type: 'syncNow' });
  cache = await getCache();
  syncBtn.disabled = false;
  renderLists();
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
  renderEngines();
  renderQuickLinks();
  renderLists();
  renderStatus();
});

$('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

// Live updates: any cache/sync change re-renders (e.g. after background refresh).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cache) {
    cache = changes.cache.newValue || { lists: [], fetchedAt: 0 };
    renderLists();
  }
  if (changes.sync) renderStatus();
  if (changes.quickLinks) renderQuickLinks();
});

// ---- Init ----------------------------------------------------------------------

(async () => {
  settings = await getSettings();
  cache = await getCache();
  lang = resolveLang(settings);
  t = makeT(lang);
  applyTheme(settings.theme);
  applyI18n(document, t, lang);
  renderEngines();
  renderQuickLinks();
  renderLists();
  renderStatus();
  checkReadiness();
  webSearchEl.focus();
})();
