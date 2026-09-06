// Quick Links storage, dashboard cache, and manual list restoration.

import { normalizeUrl } from '../lib/normalize.js';
import * as S from '../lib/settings.js';
import { KarakeepDriver } from '../lib/drivers/karakeep.js';
import * as LocalFS from '../lib/drivers/localfs.js';
import { captureBrowserSession, parseSessionDescription, sessionOrderKey } from './session.js';
import {
  applyQuickLinkOperation,
  normalizeQuickLinks,
  orderedTitle,
  quickLinksEqual,
  stripOrderPrefix
} from '../lib/quick-links.js';

function hydrateRemoteLinks(remote, local) {
  const localByUrl = new Map(normalizeQuickLinks(local).map((link) => [link.url, link]));
  return normalizeQuickLinks(remote).map((link) => ({
    ...link,
    id: localByUrl.get(link.url)?.id || link.id,
    createdAt: localByUrl.get(link.url)?.createdAt || link.createdAt
  }));
}

async function assertLocalFolder() {
  const handle = await LocalFS.loadHandle();
  if (!handle) throw new Error('NO_FOLDER');
  if (await LocalFS.queryPerm(handle) !== 'granted') throw new Error('NEED_PERMISSION');
  return handle;
}

async function readQuickLinksStorage(settings) {
  const listName = settings.quickLinksListName || 'QuickLinks';
  if (settings.driver === 'local') {
    const handle = await assertLocalFolder();
    const fileName = LocalFS.sanitizeFileName(listName) + '.txt';
    const remote = await LocalFS.readQuickLinks(handle, fileName);
    return {
      ...remote,
      links: normalizeQuickLinks(remote.links),
      storageId: `local:${handle.name}:${fileName}`,
      context: { kind: 'local', handle, fileName }
    };
  }

  const driver = new KarakeepDriver(settings.serverUrl, settings.apiKey);
  const allLists = await driver.getLists();
  const list = allLists.find((item) => item.name === listName);
  if (!list) {
    return {
      exists: false,
      links: [],
      storageId: `karakeep:${driver.base}:${listName}`,
      context: { kind: 'karakeep', driver, listName, list: null, bookmarks: [] }
    };
  }
  const bookmarks = await driver.getListBookmarks(list.id);
  const links = bookmarks
    .map((bookmark) => {
      const parsed = stripOrderPrefix(bookmark.title);
      return { ...bookmark, title: parsed.title, order: parsed.order };
    })
    .sort((a, b) => a.order - b.order);
  return {
    exists: true,
    links: normalizeQuickLinks(links),
    storageId: `karakeep:${driver.base}:${listName}`,
    context: { kind: 'karakeep', driver, listName, list, bookmarks }
  };
}

async function writeQuickLinksStorage(snapshot, links) {
  const normalized = normalizeQuickLinks(links);
  if (snapshot.context.kind === 'local') {
    await LocalFS.writeQuickLinks(snapshot.context.handle, snapshot.context.fileName, normalized);
    return;
  }

  const { driver, listName } = snapshot.context;
  let list = snapshot.context.list;
  if (!list) list = await driver.createList(listName);
  const bookmarks = snapshot.context.bookmarks || [];
  const currentByUrl = new Map(bookmarks.map((item) => [normalizeUrl(item.url) || item.url, item]));
  const desiredUrls = new Set(normalized.map((item) => item.url));

  for (let index = 0; index < normalized.length; index++) {
    const link = normalized[index];
    const title = orderedTitle(index, link);
    const existing = currentByUrl.get(link.url);
    if (!existing) {
      const bookmark = await driver.createLink(link.url, title);
      await driver.addToList(list.id, bookmark.id);
      await driver.req(`/bookmarks/${encodeURIComponent(bookmark.id)}`, {
        method: 'PATCH', body: { title }
      });
    } else if (existing.title !== title) {
      await driver.req(`/bookmarks/${encodeURIComponent(existing.id)}`, {
        method: 'PATCH', body: { title }
      });
    }
  }

  for (const bookmark of bookmarks) {
    const url = normalizeUrl(bookmark.url) || bookmark.url;
    if (!desiredUrls.has(url)) await driver.removeFromList(list.id, bookmark.id);
  }
}

async function refreshQuickLinksFromStorage(settings) {
  const local = normalizeQuickLinks(await S.getQuickLinks());
  const remote = await readQuickLinksStorage(settings);
  const migrations = await S.getQuickLinksMigrations();

  if (!migrations.includes(remote.storageId)) {
    // One-time migration approved by the user: preserve both sides without data loss.
    // Existing browser links come first so their edits/order are uploaded once.
    const localUrls = new Set(local.map((link) => link.url));
    const merged = normalizeQuickLinks([
      ...local,
      ...remote.links.filter((link) => !localUrls.has(link.url))
    ]);
    if (!remote.exists || !quickLinksEqual(remote.links, merged)) {
      await writeQuickLinksStorage(remote, merged);
    }
    await S.setQuickLinks(hydrateRemoteLinks(merged, local));
    await S.markQuickLinksMigrated(remote.storageId);
    return merged;
  }

  const adopted = hydrateRemoteLinks(remote.links, local);
  if (!quickLinksEqual(local, adopted)) await S.setQuickLinks(adopted);
  return adopted;
}

/**
 * Optimistic concurrency for QuickLinks. Storage always wins a conflict.
 * The local cache is never changed until the remote preflight passes.
 */
export async function mutateQuickLinks(op) {
  const settings = await S.getSettings();
  const beforeRefresh = normalizeQuickLinks(await S.getQuickLinks());
  await refreshQuickLinksFromStorage(settings);
  const local = normalizeQuickLinks(await S.getQuickLinks());

  // Refresh found a newer storage version (or merged first-run data): cancel this operation.
  if (!quickLinksEqual(beforeRefresh, local)) {
    await S.logActivity('conflict', 'QuickLinks: operation cancelled before write');
    return { ok: false, conflict: true, links: local };
  }

  const baseline = await readQuickLinksStorage(settings);

  if (!quickLinksEqual(local, baseline.links)) {
    const adopted = hydrateRemoteLinks(baseline.links, local);
    await S.setQuickLinks(adopted);
    await S.logActivity('conflict', 'QuickLinks: storage version adopted');
    return { ok: false, conflict: true, links: adopted };
  }

  const next = applyQuickLinkOperation(local, op);
  const fresh = await readQuickLinksStorage(settings);
  if (!quickLinksEqual(baseline.links, fresh.links)) {
    const adopted = hydrateRemoteLinks(fresh.links, local);
    await S.setQuickLinks(adopted);
    await S.logActivity('conflict', 'QuickLinks: operation cancelled');
    return { ok: false, conflict: true, links: adopted };
  }

  await writeQuickLinksStorage(fresh, next);
  await S.setQuickLinks(next);
  await S.logActivity('quick-link', op.type);
  return { ok: true, conflict: false, links: next };
}

/** Pull fresh data from the active driver into the cache (for the New Tab page). */
export async function refreshCache() {
  const settings = await S.getSettings();
  const meta = await S.getMeta();
  const quickLinksName = settings.quickLinksListName || 'QuickLinks';
  const browserState = await captureBrowserSession();
  const liveNames = new Set(browserState.lists.map((list) => list.name));
  let lists = [];

  if (settings.driver === 'local') {
    const handle = await LocalFS.loadHandle();
    if (!handle) return { ok: false, reason: 'NO_FOLDER' };
    if (await LocalFS.queryPerm(handle) !== 'granted') return { ok: false, reason: 'NEED_PERMISSION' };
    const raw = await LocalFS.readAllLists(handle);
    const rawByFile = new Map(raw.map((list) => [`${list.name}.txt`.toLowerCase(), list]));
    let manifest = null;
    try {
      const text = await LocalFS.readText(handle, '_TabSyncSession.txt');
      manifest = text ? JSON.parse(text) : null;
    } catch { /* fall back to legacy files */ }
    if (Array.isArray(manifest?.lists)) {
      const registeredFiles = new Set(manifest.lists
        .filter((entry) => typeof entry.fileName === 'string')
        .map((entry) => entry.fileName.toLowerCase()));
      lists = manifest.lists
        .filter((entry) => typeof entry.name === 'string' && typeof entry.fileName === 'string')
        .map((entry) => {
          const file = rawByFile.get(entry.fileName.toLowerCase());
          return {
            name: entry.name,
            color: entry.color || '',
            items: file?.items || [],
            updatedAt: file?.updatedAt || Date.now(),
            live: liveNames.has(entry.name)
          };
        });
      lists.push(...raw
        .filter((list) => {
          const fileName = `${list.name}.txt`.toLowerCase();
          return !registeredFiles.has(fileName) &&
            fileName !== `${LocalFS.sanitizeFileName(quickLinksName)}.txt`.toLowerCase() &&
            fileName !== 'archive.txt' &&
            !list.name.startsWith('_');
        })
        .map((list) => ({ ...list, live: liveNames.has(list.name) })));
    } else {
      lists = raw
        .filter((list) => {
          const fileName = `${list.name}.txt`.toLowerCase();
          return fileName !== `${LocalFS.sanitizeFileName(quickLinksName)}.txt`.toLowerCase() &&
            fileName !== 'archive.txt' &&
            !list.name.startsWith('_');
        })
        .map((list) => ({ ...list, live: liveNames.has(list.name) }));
    }
  } else {
    if (!settings.serverUrl || !settings.apiKey) return { ok: false, reason: 'NOT_CONFIGURED' };
    const driver = new KarakeepDriver(settings.serverUrl, settings.apiKey);
    const all = await driver.getLists();
    for (const l of all) {
      if (l.name === quickLinksName || l.name === 'Archive' || l.name.startsWith('_TabSync')) continue;
      const metadata = parseSessionDescription(l.description) || {
        kind: l.name === (settings.nonListName || 'non') ? 'non' : 'group',
        color: '',
        order: []
      };
      const bms = await driver.getListBookmarks(l.id);
      const compactOrder = metadata.order.every((key) => key.length === 4);
      const orderByKey = new Map(metadata.order.map((key, index) => [key, index]));
      const ordered = bms
        .map((bookmark, sourceIndex) => {
          const parsed = stripOrderPrefix(bookmark.title);
          return {
            ...bookmark,
            title: parsed.title,
            order: orderByKey.get(compactOrder
              ? sessionOrderKey(normalizeUrl(bookmark.url) || bookmark.url)
              : bookmark.id) ?? parsed.order,
            sourceIndex
          };
        })
        .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex);
      lists.push({
        name: l.name,
        color: metadata.color,
        items: ordered.map((b) => ({ url: normalizeUrl(b.url) || b.url, title: b.title })),
        updatedAt: Date.now(),
        live: liveNames.has(l.name)
      });
    }
  }

  lists = lists.map((l) => ({ ...l, color: l.color || meta[l.name]?.color || '' }));
  await S.saveCache({ lists, fetchedAt: Date.now(), driver: settings.driver });
  await refreshQuickLinksFromStorage(settings);
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

  // Let pages load so titles/favicons appear correctly, then idle inactive tabs
  // to save RAM. Discarding immediately would leave every tab showing "Untitled".
  for (const id of tabIds) {
    void (async () => {
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (!tab || tab.active || tab.discarded) return;
      if (tab.status === 'complete') {
        chrome.tabs.discard(id).catch(() => {});
        return;
      }
      const onUpdated = (tabId, info) => {
        if (tabId !== id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.get(id)
          .then((t2) => { if (!t2.active && !t2.discarded) chrome.tabs.discard(id).catch(() => {}); })
          .catch(() => {});
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Safety: give up after 45s (slow/broken pages stay loaded instead).
      setTimeout(() => chrome.tabs.onUpdated.removeListener(onUpdated), 45000);
    })();
  }

  await S.logActivity('restore', `${listName} (${tabIds.length})`);
  return { ok: true, count: tabIds.length, groupId };
}
