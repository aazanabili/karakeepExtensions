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
const COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

function listDescription(list, orderIds = []) {
  const order = orderIds.map((id) => encodeURIComponent(id)).join(',');
  return `${SESSION_MARKER};kind=${list.kind};color=${list.color || ''};order=${order}`;
}

export function parseSessionDescription(description) {
  if (!description?.startsWith(SESSION_MARKER)) return null;
  const fields = {};
  for (const part of description.split(';').slice(1)) {
    const separator = part.indexOf('=');
    if (separator > 0) fields[part.slice(0, separator)] = part.slice(separator + 1);
  }
  const order = (fields.order || '').split(',').filter(Boolean).map((id) => {
    try { return decodeURIComponent(id); } catch { return id; }
  });
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
  const knownNames = new Set(await S.getManaged());

  // One-time migration: mark lists managed by older TabSync versions.
  for (const list of allLists) {
    if (list.name === quickName || parseSessionDescription(list.description) || !knownNames.has(list.name)) continue;
    const browserList = browserState.lists.find((item) => item.name === list.name);
    const kind = browserList?.kind || (list.name === (settings.nonListName || 'non') ? 'non' : 'group');
    const color = browserList?.color || '';
    list.description = listDescription({ kind, color });
    await driver.updateList(list.id, { description: list.description });
  }

  const lists = [];
  const context = new Map();
  for (const list of allLists) {
    const metadata = parseSessionDescription(list.description);
    if (!metadata) continue;
    const bookmarks = await driver.getListBookmarks(list.id);
    const orderById = new Map(metadata.order.map((id, index) => [id, index]));
    const tabs = bookmarks
      .map((bookmark, sourceIndex) => {
        const parsed = stripOrderPrefix(bookmark.title);
        return {
          ...bookmark,
          title: parsed.title,
          order: orderById.has(bookmark.id) ? orderById.get(bookmark.id) : parsed.order,
          sourceIndex
        };
      })
      .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex)
      .map(({ url, title }) => ({ url, title }));
    lists.push({ name: list.name, ...metadata, tabs });
    context.set(list.name, { list, bookmarks });
  }
  const unmanagedNames = new Set(allLists
    .filter((list) => list.name !== quickName && !parseSessionDescription(list.description))
    .map((list) => list.name));
  return {
    kind: 'karakeep',
    driver,
    state: normalizeSessionState({ version: 1, lists }),
    context,
    unmanagedNames
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
  const byName = new Map(files.map((file) => [file.name, file]));

  if (!manifest?.lists) {
    const knownFiles = new Set((await S.getKnownFiles()).map((name) => String(name).toLowerCase()));
    manifest = {
      version: 1,
      lists: files
        .filter((file) => knownFiles.has(`${file.name}.txt`.toLowerCase()))
        .filter((file) => file.name !== quickName && file.name !== 'Archive' && !file.name.startsWith('_'))
        .map((file) => ({
          name: file.name,
          kind: file.name === (settings.nonListName || 'non') ? 'non' : 'group',
          color: '',
          fileName: LocalFS.sanitizeFileName(file.name) + '.txt'
        }))
    };
    await LocalFS.writeText(handle, SESSION_MANIFEST, JSON.stringify(manifest, null, 2));
  }

  const lists = manifest.lists.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    color: entry.color || '',
    tabs: (byName.get(entry.fileName.replace(/\.txt$/i, ''))?.items || [])
  }));
  return { kind: 'local', handle, manifest, state: normalizeSessionState({ version: 1, lists }) };
}

async function readSessionStorage(settings, browserState) {
  return settings.driver === 'local'
    ? readLocalSession(settings)
    : readKarakeepSession(settings, browserState);
}

async function writeKarakeepSession(snapshot, desiredInput, archives) {
  const desired = normalizeSessionState(desiredInput);
  const renames = detectSessionRenames(snapshot.state, desired);

  for (const [oldName, newName] of renames) {
    const entry = snapshot.context.get(oldName);
    if (!entry || snapshot.context.has(newName)) continue;
    if (snapshot.unmanagedNames.has(newName)) throw new Error(`SESSION_LIST_NAME_CONFLICT: ${newName}`);
    await snapshot.driver.updateList(entry.list.id, {
      name: newName
    });
    snapshot.context.delete(oldName);
    entry.list.name = newName;
    snapshot.context.set(newName, entry);
  }

  for (const desiredList of desired.lists) {
    let entry = snapshot.context.get(desiredList.name);
    if (!entry) {
      if (snapshot.unmanagedNames.has(desiredList.name)) {
        throw new Error(`SESSION_LIST_NAME_CONFLICT: ${desiredList.name}`);
      }
      let list = await snapshot.driver.createList(desiredList.name, {
        description: listDescription(desiredList),
        icon: '🗂️'
      });
      if (!parseSessionDescription(list.description)) {
        list = (await snapshot.driver.getLists()).find((item) => item.id === list.id) || list;
      }
      if (!parseSessionDescription(list.description)) {
        throw new Error(`SESSION_LIST_NAME_CONFLICT: ${desiredList.name}`);
      }
      entry = { list, bookmarks: [] };
      snapshot.context.set(desiredList.name, entry);
    }

    const current = await snapshot.driver.getListBookmarks(entry.list.id);
    const currentByUrl = new Map(current.map((bookmark) => [normalizeUrl(bookmark.url) || bookmark.url, bookmark]));
    const desiredUrls = new Set(desiredList.tabs.map((tab) => tab.url));
    const orderIds = [];
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
        orderIds.push(bookmark.id);
        if (bookmark.archived) {
          await snapshot.driver.req(`/bookmarks/${encodeURIComponent(bookmark.id)}`, {
            method: 'PATCH', body: { archived: false }
          });
        }
      } else {
        orderIds.push(existing.id);
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
      if (archiveUrls.has(url)) await snapshot.driver.archiveBookmark(bookmark.id);
    }
    const description = listDescription(desiredList, orderIds);
    if (entry.list.description !== description) {
      await snapshot.driver.updateList(entry.list.id, { description });
      entry.list.description = description;
    }
  }

  // Lists are never deleted. A missing non list is emptied; missing groups remain saved.
  const desiredNames = new Set(desired.lists.map((list) => list.name));
  for (const [name, entry] of snapshot.context) {
    if (desiredNames.has(name) || parseSessionDescription(entry.list.description)?.kind !== 'non') continue;
    for (const bookmark of await snapshot.driver.getListBookmarks(entry.list.id)) {
      await snapshot.driver.removeFromList(entry.list.id, bookmark.id);
      if (archives.some((item) => item.url === (normalizeUrl(bookmark.url) || bookmark.url))) {
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
    let target = await chrome.windows.getLastFocused().catch(() => null);
    if (!target || target.type !== 'normal') target = await chrome.windows.create({ focused: true });
    const oldTabs = await chrome.tabs.query({});
    const oldIds = oldTabs
      .filter((tab) => !tab.pinned && isSyncableUrl(tab.url))
      .map((tab) => tab.id);

    for (const list of state.lists) {
      if (!list.tabs.length) continue;
      const ids = [];
      for (const tab of list.tabs) {
        const created = await chrome.tabs.create({ windowId: target.id, url: tab.url, active: false });
        ids.push(created.id);
      }
      if (list.kind === 'group') {
        const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: target.id } });
        await chrome.tabGroups.update(groupId, {
          title: list.name,
          color: COLORS.has(list.color) ? list.color : 'blue'
        });
      }
    }
    if (oldIds.length) await chrome.tabs.remove(oldIds).catch(() => {});
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
  const current = await captureBrowserSession();
  const snapshot = await readSessionStorage(settings, current);
  const base = await S.getSessionSnapshot();

  if (!base) {
    if (!snapshot.state.lists.length && current.lists.length) {
      await writeSessionStorage(snapshot, current, []); // one-time migration from old behavior
      await S.setSessionSnapshot(current);
      await S.saveCache({ ...cacheFromState(current, current), driver: settings.driver });
      await S.setSyncState({ dirty: false, lastSync: Date.now(), lastError: '', pendingSince: 0 });
      return { ok: true, initialized: true };
    }
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

  const archives = findTabsToArchive(base, current);
  const desired = rebaseSessionChange(base, current, snapshot.state);
  await writeSessionStorage(snapshot, desired, archives);

  const conflict = !sessionStatesEqual(base, snapshot.state);
  if (conflict || !sessionStatesEqual(current, desired)) await reconcileBrowser(desired);
  await S.setSessionSnapshot(desired);
  await S.saveCache({ ...cacheFromState(desired, desired), driver: settings.driver });
  await S.setSyncState({ dirty: false, lastSync: Date.now(), lastError: '', pendingSince: 0 });
  await S.logActivity(conflict ? 'conflict' : 'sync', `session:${trigger}`);
  return { ok: true, conflict, archived: archives.length };
}
