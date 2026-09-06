import { isSyncableUrl, normalizeUrl } from '../lib/normalize.js';
import { KarakeepDriver } from '../lib/drivers/karakeep.js';
import * as LocalFS from '../lib/drivers/localfs.js';
import * as S from '../lib/settings.js';
import {
  detectSessionRenames,
  findTabsToArchive,
  normalizeSessionState,
  rebaseSessionChange,
  sessionStatesEqual
} from '../lib/session-state.js';
import { stripOrderPrefix } from '../lib/quick-links.js';

export const SESSION_MARKER = 'tabsync:session:v1';
const SESSION_MANIFEST = '_TabSyncSession.txt';
const RESTORE_FLAG_KEY = 'restoring';
const LIST_DESCRIPTION_LIMIT = 500;
const ORDER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

export function sessionOrderKey(url) {
  let hash = 2166136261;
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const value = hash >>> 0;
  return [18, 12, 6, 0].map((shift) => ORDER_ALPHABET[(value >>> shift) & 63]).join('');
}

function listDescription(list, orderKeys = [], previousDescription = '') {
  const fixed = `${SESSION_MARKER};fmt=c4;kind=${list.kind};color=${list.color || ''};order=`;
  const markerIndex = previousDescription.indexOf(SESSION_MARKER);
  const userDescription = (markerIndex >= 0
    ? previousDescription.slice(0, markerIndex)
    : previousDescription).trimEnd();
  const separatorLength = userDescription ? 1 : 0;
  const availableForOrder = LIST_DESCRIPTION_LIMIT - userDescription.length - separatorLength - fixed.length;
  if (availableForOrder < 0) return previousDescription;
  const metadata = fixed + orderKeys.slice(0, Math.floor(availableForOrder / 4)).join('');
  return userDescription ? `${userDescription}\n${metadata}` : metadata;
}

export function parseSessionDescription(description) {
  const markerIndex = description?.indexOf(SESSION_MARKER) ?? -1;
  if (markerIndex < 0) return null;
  const fields = {};
  for (const part of description.slice(markerIndex).split(';').slice(1)) {
    const separator = part.indexOf('=');
    if (separator > 0) fields[part.slice(0, separator)] = part.slice(separator + 1);
  }
  const rawOrder = fields.order || '';
  const decodeLegacy = (id) => {
    try { return decodeURIComponent(id); } catch { return id; }
  };
  const order = fields.fmt === 'c4'
    ? rawOrder.match(/.{4}/g) || []
    : rawOrder.split(',').filter(Boolean).map(decodeLegacy);
  return { kind: fields.kind === 'non' ? 'non' : 'group', color: fields.color || '', order };
}

export async function captureBrowserSession() {
  const settings = await S.getSettings();
  const nonName = settings.nonListName || 'non';
  const quickName = settings.quickLinksListName || 'QuickLinks';
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const lists = new Map();

  for (const tab of tabs) {
    if (tab.pinned || !isSyncableUrl(tab.url)) continue;
    const url = normalizeUrl(tab.url);
    if (!url) continue;
    const group = tab.groupId !== -1 ? groupsById.get(tab.groupId) : null;
    const rawName = group?.title || nonName;
    const name = rawName === quickName ? `${rawName} (Tabs)` : rawName;
    const kind = group?.title ? 'group' : 'non';
    if (!lists.has(name)) lists.set(name, { name, kind, color: group?.color || '', tabs: [] });
    lists.get(name).tabs.push({
      url,
      title: tab.title || url,
      windowId: tab.windowId,
      index: tab.index
    });
  }

  for (const list of lists.values()) {
    list.tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
    list.tabs = list.tabs.map(({ url, title }) => ({ url, title }));
  }
  return normalizeSessionState({ version: 1, lists: [...lists.values()] });
}

async function readKarakeepSession(settings, browserState) {
  const driver = new KarakeepDriver(settings.serverUrl, settings.apiKey);
  const allLists = await driver.getLists();
  const quickName = settings.quickLinksListName || 'QuickLinks';
  const archiveName = 'Archive';
  const quickList = allLists.find((list) => list.name === quickName);
  const protectedUrls = new Set(quickList
    ? (await driver.getListBookmarks(quickList.id)).map((bookmark) => normalizeUrl(bookmark.url) || bookmark.url)
    : []);

  const lists = [];
  const context = new Map();
  for (const list of allLists) {
    if (list.name === quickName || list.name === archiveName || list.name.startsWith('_TabSync')) continue;
    const browserList = browserState.lists.find((item) => item.name === list.name);
    const metadata = parseSessionDescription(list.description) || {
      kind: list.name === (settings.nonListName || 'non') ? 'non' : 'group',
      color: browserList?.color || '',
      order: []
    };
    const bookmarks = await driver.getListBookmarks(list.id);
    const compactOrder = metadata.order.every((key) => key.length === 4);
    const orderByKey = new Map(metadata.order.map((key, index) => [key, index]));
    const tabs = bookmarks
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
      .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex)
      .map(({ url, title }) => ({ url, title }));
    lists.push({ name: list.name, ...metadata, tabs });
    context.set(list.name, { list, bookmarks });
  }
  return {
    kind: 'karakeep',
    driver,
    state: normalizeSessionState({ version: 1, lists }),
    context,
    protectedUrls
  };
}

async function readLocalSession(settings) {
  const handle = await LocalFS.loadHandle();
  if (!handle) throw new Error('NO_FOLDER');
  if (await LocalFS.queryPerm(handle) !== 'granted') throw new Error('NEED_PERMISSION');
  const quickName = settings.quickLinksListName || 'QuickLinks';
  const manifestText = await LocalFS.readText(handle, SESSION_MANIFEST);
  let manifest = null;
  try { manifest = manifestText ? JSON.parse(manifestText) : null; } catch { /* migrate below */ }
  const files = await LocalFS.readAllLists(handle);
  const byFile = new Map(files.map((file) => [`${file.name}.txt`.toLowerCase(), file]));
  const reservedFiles = new Set([
    SESSION_MANIFEST.toLowerCase(),
    'archive.txt',
    `${LocalFS.sanitizeFileName(quickName)}.txt`.toLowerCase()
  ]);
  const eligibleFiles = files.filter((file) => {
    const fileName = `${file.name}.txt`.toLowerCase();
    return !reservedFiles.has(fileName) && !file.name.startsWith('_');
  });
  const validEntries = Array.isArray(manifest?.lists)
    ? manifest.lists.filter((entry) =>
      typeof entry.name === 'string' &&
      typeof entry.fileName === 'string' &&
      !reservedFiles.has(entry.fileName.toLowerCase()) &&
      byFile.has(entry.fileName.toLowerCase()))
    : [];
  const registeredFiles = new Set(validEntries.map((entry) => entry.fileName.toLowerCase()));
  let manifestChanged = !Array.isArray(manifest?.lists) || validEntries.length !== manifest.lists.length;
  for (const file of eligibleFiles) {
    const fileName = `${file.name}.txt`;
    if (registeredFiles.has(fileName.toLowerCase())) continue;
    validEntries.push({
      name: file.name,
      kind: file.name === (settings.nonListName || 'non') ? 'non' : 'group',
      color: '',
      fileName
    });
    registeredFiles.add(fileName.toLowerCase());
    manifestChanged = true;
  }
  manifest = { version: 1, lists: validEntries };
  if (manifestChanged) {
    await LocalFS.writeText(handle, SESSION_MANIFEST, JSON.stringify(manifest, null, 2));
  }

  const lists = manifest.lists.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    color: entry.color || '',
    tabs: (byFile.get(entry.fileName.toLowerCase())?.items || [])
  }));
  return { kind: 'local', handle, manifest, state: normalizeSessionState({ version: 1, lists }) };
}

async function readSessionStorage(settings, browserState) {
  return settings.driver === 'local'
    ? readLocalSession(settings)
    : readKarakeepSession(settings, browserState);
}

function isReadOnlyKarakeepEntry(entry) {
  const list = entry?.list;
  return list?.type === 'smart' || (list?.userRole && !['owner', 'editor'].includes(list.userRole));
}

function maskReadOnlyKarakeepChanges(snapshot, currentInput) {
  if (snapshot.kind !== 'karakeep') return normalizeSessionState(currentInput);
  const current = normalizeSessionState(currentInput);
  const renames = detectSessionRenames(snapshot.state, current);
  for (const [name, entry] of snapshot.context) {
    if (!isReadOnlyKarakeepEntry(entry)) continue;
    const stored = snapshot.state.lists.find((list) => list.name === name);
    if (!stored) continue;
    const renamedTarget = renames.get(name);
    current.lists = current.lists.filter((list) => list.name !== name && list.name !== renamedTarget);
    current.lists.push(structuredClone(stored));
  }
  return normalizeSessionState(current);
}

async function writeKarakeepSession(snapshot, desiredInput, archives) {
  const desired = normalizeSessionState(desiredInput);
  const renames = detectSessionRenames(snapshot.state, desired);
  const retainedUrls = new Set([
    ...(snapshot.protectedUrls || []),
    ...desired.lists.flatMap((list) => list.tabs.map((tab) => tab.url))
  ]);

  for (const [oldName, newName] of renames) {
    const entry = snapshot.context.get(oldName);
    if (!entry || isReadOnlyKarakeepEntry(entry) || snapshot.context.has(newName)) continue;
    await snapshot.driver.updateList(entry.list.id, {
      name: newName
    });
    snapshot.context.delete(oldName);
    entry.list.name = newName;
    snapshot.context.set(newName, entry);
  }

  for (const desiredList of desired.lists) {
    let entry = snapshot.context.get(desiredList.name);
    if (isReadOnlyKarakeepEntry(entry)) continue;
    if (!entry) {
      let list = await snapshot.driver.createList(desiredList.name, {
        description: listDescription(desiredList),
        icon: '🗂️'
      });
      if (!parseSessionDescription(list.description)) {
        list = (await snapshot.driver.getLists()).find((item) => item.id === list.id) || list;
      }
      if (!parseSessionDescription(list.description)) {
        list.description = listDescription(desiredList, [], list.description || '');
        await snapshot.driver.updateList(list.id, { description: list.description });
      }
      entry = { list, bookmarks: [] };
      snapshot.context.set(desiredList.name, entry);
    }

    const current = await snapshot.driver.getListBookmarks(entry.list.id);
    const currentByUrl = new Map(current.map((bookmark) => [normalizeUrl(bookmark.url) || bookmark.url, bookmark]));
    const desiredUrls = new Set(desiredList.tabs.map((tab) => tab.url));
    const orderKeys = [];
    const sourceNames = new Set([desiredList.name]);
    for (const [oldName, newName] of renames) {
      if (newName === desiredList.name) sourceNames.add(oldName);
    }
    const archiveUrls = new Set(archives
      .filter((item) => sourceNames.has(item.group))
      .map((item) => item.url));

    for (const tab of desiredList.tabs) {
      const existing = currentByUrl.get(tab.url);
      if (!existing) {
        const bookmark = await snapshot.driver.createLink(tab.url, tab.title);
        await snapshot.driver.addToList(entry.list.id, bookmark.id);
        orderKeys.push(sessionOrderKey(tab.url));
        if (bookmark.archived) {
          await snapshot.driver.req(`/bookmarks/${encodeURIComponent(bookmark.id)}`, {
            method: 'PATCH', body: { archived: false }
          });
        }
      } else {
        orderKeys.push(sessionOrderKey(tab.url));
      }
      if (existing?.archived) {
        await snapshot.driver.req(`/bookmarks/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH', body: { archived: false }
        });
      }
    }

    for (const bookmark of current) {
      const url = normalizeUrl(bookmark.url) || bookmark.url;
      if (desiredUrls.has(url)) continue;
      await snapshot.driver.removeFromList(entry.list.id, bookmark.id);
      if (archiveUrls.has(url) && !retainedUrls.has(url)) {
        await snapshot.driver.archiveBookmark(bookmark.id);
      }
    }
    const description = listDescription(desiredList, orderKeys, entry.list.description || '');
    if (entry.list.description !== description) {
      await snapshot.driver.updateList(entry.list.id, { description });
      entry.list.description = description;
    }
  }

  // Lists are never deleted. A missing non list is emptied; missing groups remain saved.
  const desiredNames = new Set(desired.lists.map((list) => list.name));
  for (const [name, entry] of snapshot.context) {
    const storedList = snapshot.state.lists.find((list) => list.name === name);
    if (isReadOnlyKarakeepEntry(entry) || desiredNames.has(name) || storedList?.kind !== 'non') continue;
    for (const bookmark of await snapshot.driver.getListBookmarks(entry.list.id)) {
      await snapshot.driver.removeFromList(entry.list.id, bookmark.id);
      const url = normalizeUrl(bookmark.url) || bookmark.url;
      if (!retainedUrls.has(url) && archives.some((item) => item.url === url)) {
        await snapshot.driver.archiveBookmark(bookmark.id);
      }
    }
  }
}

async function writeLocalSession(snapshot, desiredInput, archives) {
  const desired = normalizeSessionState(desiredInput);
  const renames = detectSessionRenames(snapshot.state, desired);

  const previousGroups = snapshot.state.lists.filter((list) => list.kind === 'group');
  for (const group of previousGroups) {
    if (!desired.lists.some((list) => list.name === group.name) && !renames.has(group.name)) {
      desired.lists.push(group); // groups are never deleted
    }
  }

  const quickName = (await S.getSettings()).quickLinksListName || 'QuickLinks';
  const reserved = new Set([
    SESSION_MANIFEST.toLowerCase(),
    'archive.txt',
    `${LocalFS.sanitizeFileName(quickName)}.txt`.toLowerCase()
  ]);
  const used = new Set(reserved);
  const previousFiles = new Map(snapshot.manifest.lists.map((entry) => [entry.name, entry.fileName]));
  const manifest = { version: 1, lists: [] };
  for (const list of desired.lists) {
    const previous = previousFiles.get(list.name);
    const preferred = typeof previous === 'string' && /^[^\\/]+\.txt$/i.test(previous)
      ? previous
      : null;
    const baseName = LocalFS.sanitizeFileName(list.name);
    let fileName = preferred && !used.has(preferred.toLowerCase())
      ? preferred
      : `${baseName}.txt`;
    if (used.has(fileName.toLowerCase())) {
      let hash = 2166136261;
      for (const char of list.name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      fileName = `${baseName}-${(hash >>> 0).toString(36)}.txt`;
      let suffix = 2;
      while (used.has(fileName.toLowerCase())) fileName = `${baseName}-${(hash >>> 0).toString(36)}-${suffix++}.txt`;
    }
    used.add(fileName.toLowerCase());
    await LocalFS.writeText(snapshot.handle, fileName,
      list.tabs.map((tab) => tab.url).join('\n') + (list.tabs.length ? '\n' : ''));
    manifest.lists.push({ name: list.name, kind: list.kind, color: list.color || '', fileName });
  }
  const retainedFiles = new Set(manifest.lists.map((entry) => entry.fileName.toLowerCase()));
  for (const oldEntry of snapshot.manifest.lists) {
    const oldFile = String(oldEntry.fileName || '');
    if (!/^[^\\/]+\.txt$/i.test(oldFile)) continue;
    if (!retainedFiles.has(oldFile.toLowerCase()) && !reserved.has(oldFile.toLowerCase())) {
      await LocalFS.removeFile(snapshot.handle, oldFile);
    }
  }
  await LocalFS.writeText(snapshot.handle, SESSION_MANIFEST, JSON.stringify(manifest, null, 2));
  await LocalFS.appendArchive(snapshot.handle, archives);
}

async function writeSessionStorage(snapshot, desired, archives) {
  if (snapshot.kind === 'local') return writeLocalSession(snapshot, desired, archives);
  return writeKarakeepSession(snapshot, desired, archives);
}

async function reconcileBrowser(stateInput) {
  const state = normalizeSessionState(stateInput);
  await chrome.storage.local.set({ [RESTORE_FLAG_KEY]: { until: Date.now() + 120000 } });
  try {
    const [oldTabs, oldGroups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
    const groupsById = new Map(oldGroups.map((group) => [group.id, group]));
    const availableByUrl = new Map();
    for (const tab of oldTabs) {
      if (tab.pinned || !isSyncableUrl(tab.url)) continue;
      const url = normalizeUrl(tab.url);
      if (!url) continue;
      if (!availableByUrl.has(url)) availableByUrl.set(url, []);
      availableByUrl.get(url).push(tab);
    }

    const assignments = [];
    const retainedIds = new Set();
    for (const list of state.lists) {
      const ids = [];
      for (const desiredTab of list.tabs) {
        const candidates = availableByUrl.get(desiredTab.url) || [];
        const preferredIndex = candidates.findIndex((tab) => {
          const group = groupsById.get(tab.groupId);
          return list.kind === 'group' ? group?.title === list.name : !group?.title;
        });
        const existing = candidates.splice(preferredIndex >= 0 ? preferredIndex : 0, 1)[0];
        if (existing) {
          ids.push(existing.id);
          retainedIds.add(existing.id);
        } else {
          ids.push(null);
        }
      }
      assignments.push({ list, ids });
    }

    const totalDesired = assignments.reduce((total, item) => total + item.ids.length, 0);
    let target = await chrome.windows.getLastFocused().catch(() => null);
    if (totalDesired && (!target || target.type !== 'normal')) {
      target = await chrome.windows.create({ focused: false });
    }

    if (target) {
      for (const assignment of assignments) {
        for (let index = 0; index < assignment.ids.length; index++) {
          if (assignment.ids[index] !== null) continue;
          const created = await chrome.tabs.create({
            windowId: target.id,
            url: assignment.list.tabs[index].url,
            active: false
          });
          assignment.ids[index] = created.id;
          retainedIds.add(created.id);
        }
      }

      const groupedIds = assignments.flatMap((item) => item.ids)
        .filter((id) => groupsById.has(oldTabs.find((tab) => tab.id === id)?.groupId));
      if (groupedIds.length) await chrome.tabs.ungroup(groupedIds).catch(() => {});

      const targetTabs = await chrome.tabs.query({ windowId: target.id });
      let cursor = targetTabs.filter((tab) => tab.pinned).length;
      for (const { list, ids } of assignments) {
        if (!ids.length) continue;
        await chrome.tabs.move(ids, { windowId: target.id, index: cursor });
        if (list.kind === 'group') {
          const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: target.id } });
          await chrome.tabGroups.update(groupId, {
            title: list.name,
            color: COLORS.has(list.color) ? list.color : 'blue'
          });
        }
        cursor += ids.length;
      }
    }

    const extraIds = oldTabs
      .filter((tab) => !tab.pinned && isSyncableUrl(tab.url) && !retainedIds.has(tab.id))
      .map((tab) => tab.id);
    if (extraIds.length) await chrome.tabs.remove(extraIds).catch(() => {});
  } finally {
    setTimeout(() => chrome.storage.local.remove(RESTORE_FLAG_KEY).catch(() => {}), 5000);
  }
}

function cacheFromState(state, browserState) {
  const liveNames = new Set(browserState.lists
    .filter((list) => list.tabs.length)
    .map((list) => list.name));
  return {
    lists: state.lists.map((list) => ({
      name: list.name,
      color: list.color,
      items: list.tabs,
      updatedAt: Date.now(),
      live: liveNames.has(list.name)
    })),
    fetchedAt: Date.now()
  };
}

export async function synchronizeSession(trigger = 'auto', forceRestore = false) {
  const settings = await S.getSettings();
  let current = await captureBrowserSession();
  let snapshot = await readSessionStorage(settings, current);
  const afterRead = await captureBrowserSession();
  if (!sessionStatesEqual(current, afterRead)) current = afterRead;
  const base = await S.getSessionSnapshot();

  if (!base) {
    if (!sessionStatesEqual(current, snapshot.state)) await reconcileBrowser(snapshot.state);
    await S.setSessionSnapshot(snapshot.state);
    await S.saveCache({ ...cacheFromState(snapshot.state, snapshot.state), driver: settings.driver });
    await S.setSyncState({ dirty: false, lastSync: Date.now(), lastError: '', pendingSince: 0 });
    return { ok: true, restored: true };
  }

  if (forceRestore) {
    if (!sessionStatesEqual(current, snapshot.state)) await reconcileBrowser(snapshot.state);
    await S.setSessionSnapshot(snapshot.state);
    await S.saveCache({ ...cacheFromState(snapshot.state, snapshot.state), driver: settings.driver });
    await S.setSyncState({ dirty: false, lastSync: Date.now(), lastError: '', pendingSince: 0 });
    return { ok: true, restored: true };
  }

  current = maskReadOnlyKarakeepChanges(snapshot, current);
  let browserChanged = !sessionStatesEqual(base, current);
  if (browserChanged) {
    const preflight = await readSessionStorage(settings, current);
    if (!sessionStatesEqual(snapshot.state, preflight.state)) {
      snapshot = preflight;
      current = maskReadOnlyKarakeepChanges(snapshot, current);
      browserChanged = !sessionStatesEqual(base, current);
    }
  }
  const remoteBeforeWrite = snapshot.state;
  let archives = browserChanged ? findTabsToArchive(base, current) : [];
  let desired = rebaseSessionChange(base, current, snapshot.state);
  let wroteStorage = browserChanged;
  if (wroteStorage) await writeSessionStorage(snapshot, desired, archives);

  // A storage request can take long enough for another browser operation to occur.
  // Replay that late operation before reconciliation so a periodic sync cannot erase it.
  const latest = await captureBrowserSession();
  const writableLatest = maskReadOnlyKarakeepChanges(snapshot, latest);
  if (!sessionStatesEqual(current, writableLatest)) {
    const lateArchives = findTabsToArchive(current, writableLatest);
    desired = rebaseSessionChange(current, writableLatest, desired);
    await writeSessionStorage(snapshot, desired, lateArchives);
    wroteStorage = true;
    archives = [...archives, ...lateArchives];
    current = writableLatest;
  }

  if (wroteStorage) {
    const verification = await readSessionStorage(settings, current);
    if (!sessionStatesEqual(verification.state, desired)) {
      desired = rebaseSessionChange(base, current, verification.state);
      await writeSessionStorage(verification, desired, []);
    }
  }

  const conflict = !sessionStatesEqual(base, remoteBeforeWrite);
  if (conflict || !sessionStatesEqual(current, desired)) await reconcileBrowser(desired);
  await S.setSessionSnapshot(desired);
  await S.saveCache({ ...cacheFromState(desired, desired), driver: settings.driver });
  await S.setSyncState({ dirty: false, lastSync: Date.now(), lastError: '', pendingSince: 0 });
  if (trigger !== 'periodic' || conflict || browserChanged || archives.length) {
    await S.logActivity(conflict ? 'conflict' : 'sync', `session:${trigger}`);
  }
  return { ok: true, conflict, archived: archives.length };
}
