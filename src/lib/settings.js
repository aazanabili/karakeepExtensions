// Central storage schema + settings/activity/sync-state helpers.
// Everything lives in chrome.storage.local (except the FS dir handle, which lives in IndexedDB).

export const K = {
  SETTINGS: 'settings',
  CACHE: 'cache',          // { lists: [{name, color, items:[{url,title}], updatedAt}], fetchedAt, driver }
  META: 'groupMeta',       // { [listName]: { color } }
  ACTIVITY: 'activity',    // [{ ts, kind, msg }]  (capped)
  SYNC: 'sync',            // { dirty, lastSync, lastError, pendingSince }
  MANAGED: 'managedLists', // [listName] — only these server lists are ever touched (mirror safety)
  KNOWN_FILES: 'knownFiles', // [fileName] — TXT files we created (mirror-safe deletion)
  PENDING_AT: 'pendingSyncAt',
  QUICK_LINKS: 'quickLinks', // [{id, title, url, createdAt}] — local + synced as protected list
  SEARCH_ENGINE: 'searchEngine' // id of default engine
};

export const DEFAULT_SETTINGS = {
  driver: 'karakeep',        // 'karakeep' | 'local'
  serverUrl: '',
  apiKey: '',
  deleteMode: 'archive',     // 'archive' | 'delete'
  nonListName: 'non',
  theme: 'auto',             // 'auto' | 'light' | 'dark'
  lang: 'auto',              // 'auto' | 'ar' | 'en'
  quickLinksListName: 'QuickLinks' // protected list name on server
};

const DEFAULT_SYNC = { dirty: false, lastSync: 0, lastError: '', pendingSince: 0 };
const ACTIVITY_CAP = 60;

export async function getSettings() {
  const o = await chrome.storage.local.get(K.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(o[K.SETTINGS] || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [K.SETTINGS]: next });
  return next;
}

export async function getCache() {
  const o = await chrome.storage.local.get(K.CACHE);
  return o[K.CACHE] || { lists: [], fetchedAt: 0, driver: '' };
}

export async function saveCache(cache) {
  await chrome.storage.local.set({ [K.CACHE]: cache });
}

export async function getMeta() {
  const o = await chrome.storage.local.get(K.META);
  return o[K.META] || {};
}

export async function setMeta(meta) {
  await chrome.storage.local.set({ [K.META]: meta });
}

export async function getActivity() {
  const o = await chrome.storage.local.get(K.ACTIVITY);
  return o[K.ACTIVITY] || [];
}

export async function logActivity(kind, msg) {
  const log = await getActivity();
  log.unshift({ ts: Date.now(), kind, msg });
  if (log.length > ACTIVITY_CAP) log.length = ACTIVITY_CAP;
  await chrome.storage.local.set({ [K.ACTIVITY]: log });
}

export async function getSyncState() {
  const o = await chrome.storage.local.get(K.SYNC);
  return { ...DEFAULT_SYNC, ...(o[K.SYNC] || {}) };
}

export async function setSyncState(patch) {
  const next = { ...(await getSyncState()), ...patch };
  await chrome.storage.local.set({ [K.SYNC]: next });
  return next;
}

export async function getManaged() {
  const o = await chrome.storage.local.get(K.MANAGED);
  return o[K.MANAGED] || [];
}

export async function setManaged(names) {
  await chrome.storage.local.set({ [K.MANAGED]: names });
}

export async function getKnownFiles() {
  const o = await chrome.storage.local.get(K.KNOWN_FILES);
  return o[K.KNOWN_FILES] || [];
}

export async function setKnownFiles(names) {
  await chrome.storage.local.set({ [K.KNOWN_FILES]: names });
}

export async function getQuickLinks() {
  const o = await chrome.storage.local.get(K.QUICK_LINKS);
  return o[K.QUICK_LINKS] || [];
}

export async function setQuickLinks(links) {
  await chrome.storage.local.set({ [K.QUICK_LINKS]: links });
}

export async function getSearchEngine() {
  const o = await chrome.storage.local.get(K.SEARCH_ENGINE);
  return o[K.SEARCH_ENGINE] || 'google';
}

export async function setSearchEngine(id) {
  await chrome.storage.local.set({ [K.SEARCH_ENGINE]: id });
}
