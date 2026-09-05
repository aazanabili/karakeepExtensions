// Sync engine: capture browser state -> full one-way mirror onto the active driver.
// Mirror safety: only lists/files we manage are ever emptied or deleted.

import { normalizeUrl, isSyncableUrl } from '../lib/normalize.js';
import * as S from '../lib/settings.js';
import { KarakeepDriver } from '../lib/drivers/karakeep.js';
import * as LocalFS from '../lib/drivers/localfs.js';

/**
 * Snapshot current browser state as Map<listName, {color, items:[{url,title,index}]}>.
 * - Tab groups (titled) become lists named after the group; same name across windows merges.
 * - Everything else (ungrouped, pinned, unnamed groups) lands in the `non` list.
 * - Non http(s) URLs (chrome://, edge://, about:, extension pages) are excluded.
 */
export async function captureBrowserState() {
  const settings = await S.getSettings();
  const non = settings.nonListName || 'non';
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({})
  ]);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const meta = await S.getMeta();
  let metaChanged = false;

  const map = new Map();
  for (const tab of tabs) {
    if (!tab.url || !isSyncableUrl(tab.url)) continue;
    const url = normalizeUrl(tab.url);
    if (!url) continue;
    const group = (tab.groupId != null && tab.groupId !== -1) ? groupById.get(tab.groupId) : null;
    const name = group?.title ? group.title : non;
    if (group?.title && meta[group.title]?.color !== group.color) {
      meta[group.title] = { color: group.color || '' };
      metaChanged = true;
    }
    if (!map.has(name)) map.set(name, { color: group?.color || meta[name]?.color || '', items: [] });
    map.get(name).items.push({ url, title: tab.title || url, index: tab.index ?? 0 });
  }

  for (const list of map.values()) {
    list.items.sort((a, b) => a.index - b.index);
    const seen = new Set();
    list.items = list.items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
  }

  if (metaChanged) await S.setMeta(meta);
  return map;
}

/**
 * Mirror ONLY the currently-open lists onto Karakeep.
 * Lists we never managed and lists that disappeared from the browser are untouched
 * (they stay on the server as an archive visible in the dashboard).
 * Returns {added, removed}.
 */
async function mirrorWithKarakeep(driver, state, settings) {
  // Preflight: without host permission the SW fetch fails with a cryptic network error.
  try {
    const origin = new URL(settings.serverUrl).origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (!has) throw new Error('MISSING_HOST_PERMISSION: افتح الإعدادات واضغط حفظ لمنح صلاحية النطاق');
  } catch (e) {
    if (e.message.startsWith('MISSING_HOST_PERMISSION')) throw e;
  }

  const managed = new Set(await S.getManaged());
  const allLists = await driver.getLists();
  const byName = new Map(allLists.map((l) => [l.name, l]));

  let added = 0;
  let removed = 0;

  for (const [name, data] of state) {
    if (!data.items.length && !managed.has(name)) continue; // empty + never managed -> skip

    let list = byName.get(name);
    if (!list) {
      list = await driver.createList(name);
    }

    const current = await driver.getListBookmarks(list.id);
    const currentByKey = new Map();
    for (const b of current) {
      const key = normalizeUrl(b.url) || b.url;
      if (!currentByKey.has(key)) currentByKey.set(key, b);
    }
    const desiredByKey = new Map(data.items.map((i) => [i.url, i])); // already normalized

    for (const [key, item] of desiredByKey) {
      if (currentByKey.has(key)) continue;
      const bm = await driver.createLink(item.url, item.title);
      await driver.addToList(list.id, bm.id);
      added++;
    }

    for (const [key, bm] of currentByKey) {
      if (desiredByKey.has(key)) continue;
      await driver.removeFromList(list.id, bm.id);
      if (settings.deleteMode === 'delete') {
        await driver.deleteBookmark(bm.id);
      } else {
        await driver.archiveBookmark(bm.id);
      }
      removed++;
    }
  }

  await S.setManaged([...new Set([...managed, ...state.keys()])]);
  return { added, removed };
}

/** Mirror the desired state into the local TXT folder. */
async function mirrorWithLocal(state) {
  const handle = await LocalFS.loadHandle();
  if (!handle) throw new Error('NO_FOLDER');
  if (await LocalFS.queryPerm(handle) !== 'granted') throw new Error('NEED_PERMISSION');
  const known = await S.getKnownFiles();
  const written = await LocalFS.writeMirror(handle, state, known);
  await S.setKnownFiles(written);
  return { added: -1, removed: -1 }; // local mode has no per-op stats
}

function toCacheList(name, list, meta, live) {
  return {
    name,
    color: list.color || meta[name]?.color || '',
    items: list.items.map(({ url, title }) => ({ url, title })),
    updatedAt: Date.now(),
    live
  };
}

/** Full mirror sync: capture -> mirror open lists -> cache = open + archived lists. */
export async function runSync(trigger = 'auto') {
  const settings = await S.getSettings();
  const state = await captureBrowserState();
  const meta = await S.getMeta();

  let stats = { added: 0, removed: 0 };
  let lists;
  if (settings.driver === 'local') {
    stats = await mirrorWithLocal(state);
    lists = [...state].map(([name, l]) => toCacheList(name, l, meta, true));
  } else {
    const driver = new KarakeepDriver(settings.serverUrl, settings.apiKey);
    stats = await mirrorWithKarakeep(driver, state, settings);
    // Cache shows everything on the server: open lists (live) + archived ones.
    const allLists = await driver.getLists();
    lists = [];
    for (const l of allLists) {
      const open = state.get(l.name);
      if (open) {
        lists.push(toCacheList(l.name, open, meta, true));
      } else {
        const bms = await driver.getListBookmarks(l.id);
        lists.push({
          name: l.name,
          color: meta[l.name]?.color || '',
          items: bms.map((b) => ({ url: normalizeUrl(b.url) || b.url, title: b.title })),
          updatedAt: Date.now(),
          live: false
        });
      }
    }
  }

  await S.saveCache({ driver: settings.driver, fetchedAt: Date.now(), lists });
  await S.setSyncState({ dirty: false, lastSync: Date.now(), lastError: '', pendingSince: 0 });
  await S.logActivity('sync', `${trigger}: +${stats.added}/-${stats.removed}`);
  return { ok: true, ...stats };
}

/** Pull fresh data from the active driver into the cache (for the New Tab page). */
export async function refreshCache() {
  const settings = await S.getSettings();
  const meta = await S.getMeta();
  let lists = [];

  if (settings.driver === 'local') {
    const handle = await LocalFS.loadHandle();
    if (!handle) return { ok: false, reason: 'NO_FOLDER' };
    if (await LocalFS.queryPerm(handle) !== 'granted') return { ok: false, reason: 'NEED_PERMISSION' };
    const raw = await LocalFS.readAllLists(handle);
    lists = raw.map((l) => ({ name: l.name, items: l.items, updatedAt: l.updatedAt, live: true }));
  } else {
    if (!settings.serverUrl || !settings.apiKey) return { ok: false, reason: 'NOT_CONFIGURED' };
    const driver = new KarakeepDriver(settings.serverUrl, settings.apiKey);
    const all = await driver.getLists();
    // Mark which lists are currently open in the browser.
    let openNames = new Set();
    try {
      const groups = await chrome.tabGroups.query({});
      openNames = new Set(groups.filter((g) => g.title).map((g) => g.title));
      openNames.add(settings.nonListName || 'non');
    } catch { /* tabGroups unavailable outside extension context */ }
    for (const l of all) {
      const bms = await driver.getListBookmarks(l.id);
      lists.push({
        name: l.name,
        items: bms.map((b) => ({ url: normalizeUrl(b.url) || b.url, title: b.title })),
        updatedAt: Date.now(),
        live: openNames.has(l.name)
      });
    }
  }

  lists = lists.map((l) => ({ ...l, color: meta[l.name]?.color || '' }));
  await S.saveCache({ lists, fetchedAt: Date.now(), driver: settings.driver });
  return { ok: true, count: lists.length };
}

/**
 * Restore a list as a live tab group: opens all URLs (in a new window or the current one),
 * groups them under the list name (with its remembered color) and discards inactive tabs.
 */
export async function restoreList(listName, mode = 'window') {
  const cache = await S.getCache();
  const list = cache.lists.find((l) => l.name === listName);
  if (!list || !list.items.length) return { ok: false, reason: 'EMPTY' };

  const meta = await S.getMeta();
  const color = meta[listName]?.color || list.color || 'blue';
  const urls = list.items.map((i) => i.url);

  let windowId;
  const tabIds = [];
  if (mode === 'current') {
    const win = await chrome.windows.getLastFocused();
    windowId = win.id;
    for (const url of urls) {
      const t = await chrome.tabs.create({ windowId, url, active: false });
      tabIds.push(t.id);
    }
  } else {
    const win = await chrome.windows.create({ url: urls[0], focused: true });
    windowId = win.id;
    tabIds.push(win.tabs[0].id);
    for (let i = 1; i < urls.length; i++) {
      const t = await chrome.tabs.create({ windowId, url: urls[i], active: false });
      tabIds.push(t.id);
    }
  }

  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title: listName, color });

  // Discard everything except the active tab (discard fails on the active tab by design).
  const [active] = await chrome.tabs.query({ windowId, active: true });
  for (const id of tabIds) {
    if (active && id === active.id) continue;
    try { await chrome.tabs.discard(id); } catch { /* active or already discarded */ }
  }

  await S.logActivity('restore', `${listName} (${tabIds.length})`);
  return { ok: true, count: tabIds.length };
}
