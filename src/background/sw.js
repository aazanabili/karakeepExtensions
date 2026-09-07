// Service worker (MV3, ES modules): event debouncing, offline retry, badge, message bus.

import { refreshCache, restoreList, mutateQuickLinks } from './sync.js';
import {
  closeAllBrowserGroups,
  isInternallyRemovedGroup,
  refreshSessionList,
  synchronizeSession
} from './session.js';
import * as S from '../lib/settings.js';

const DEBOUNCE_MS = 2500;
const PERIODIC_SYNC_MINUTES = 5;
const RESTORE_FLAG_KEY = 'restoring'; // { until: ts } — survives SW restarts
const RESTORE_LOCK_MS = 30000;

let debounceTimer = null;
let restoringNow = false; // in-memory fast path
let startupPending = false;
let quickLinkQueue = Promise.resolve();
let sessionQueue = Promise.resolve();
let activeGroupQueue = Promise.resolve();
const groupTitles = new Map();
const activeTabIds = new Set();

function queueQuickLinkOperation(op) {
  const result = quickLinkQueue.then(() => mutateQuickLinks(op));
  quickLinkQueue = result.catch(() => {});
  return result;
}

function queueSessionSync(trigger) {
  const result = sessionQueue.then(() => synchronizeSession(trigger));
  sessionQueue = result.catch(() => {});
  return result;
}

function registerActiveGroup(id, name) {
  if (!Number.isInteger(id) || name === undefined) return Promise.resolve();
  const result = activeGroupQueue.then(async () => {
    const groups = await S.getActiveGroups();
    await S.setActiveGroups([...groups.filter((group) => group.id !== id), { id, name }]);
    await refreshActiveTabIds();
  });
  activeGroupQueue = result.catch(() => {});
  return result;
}

function unregisterActiveGroup(id) {
  const result = activeGroupQueue.then(async () => {
    const groups = await S.getActiveGroups();
    await S.setActiveGroups(groups.filter((group) => group.id !== id));
    await refreshActiveTabIds();
  });
  activeGroupQueue = result.catch(() => {});
  return result;
}

async function isActiveGroup(id) {
  if (!Number.isInteger(id) || id === -1) return false;
  return (await S.getActiveGroups()).some((group) => group.id === id);
}

async function scheduleIfActiveTab(tabId, reason) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  // Ungrouped tabs belong to `non`, which is always live.
  if (tab && (tab.groupId === -1 || await isActiveGroup(tab.groupId))) {
    activeTabIds.add(tab.id);
    scheduleSync(reason);
  }
}

async function refreshActiveTabIds() {
  const groupIds = new Set((await S.getActiveGroups()).map((group) => group.id));
  const tabs = await chrome.tabs.query({});
  activeTabIds.clear();
  for (const tab of tabs) {
    if (groupIds.has(tab.groupId)) activeTabIds.add(tab.id);
  }
}

async function isRestoring() {
  if (restoringNow || startupPending) return true;
  const o = await chrome.storage.local.get(RESTORE_FLAG_KEY);
  return !!(o[RESTORE_FLAG_KEY] && o[RESTORE_FLAG_KEY].until > Date.now());
}

function scheduleSync(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSync(reason), DEBOUNCE_MS);
  // Persist intent so a killed SW can resume the pending sync on next startup.
  chrome.storage.local.set({ [S.K.PENDING_AT]: Date.now() }).catch(() => {});
}

async function doSync(reason) {
  if (await isRestoring()) {
    setTimeout(() => scheduleSync('post-reconcile'), 5500);
    return;
  }
  try {
    await queueSessionSync(reason);
    chrome.alarms.clear('retry').catch(() => {});
  } catch (e) {
    await scheduleRetry(String(e?.message || e));
  }
  await updateBadge();
  await chrome.storage.local.remove(S.K.PENDING_AT).catch(() => {});
}

async function scheduleRetry(errMsg) {
  const previous = await S.getSyncState();
  await S.setSyncState({ dirty: true, lastError: errMsg, pendingSince: Date.now() });
  if (previous.lastError !== errMsg) await S.logActivity('error', errMsg);
  const existing = await chrome.alarms.get('retry');
  if (!existing) chrome.alarms.create('retry', { delayInMinutes: 1 });
}

async function updateBadge() {
  const st = await S.getSyncState();
  if (st.dirty && st.lastError) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d33' });
  } else if (st.dirty) {
    await chrome.action.setBadgeText({ text: '…' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e8a000' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// ---- Tab / group watchers -------------------------------------------------

chrome.tabs.onCreated.addListener((tab) => {
  void (async () => {
    if (tab.groupId === -1 || await isActiveGroup(tab.groupId)) {
      activeTabIds.add(tab.id);
      scheduleSync('tab-created');
    }
  })();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabIds.delete(tabId);
  // The closed tab may have belonged to `non`, which is always live.
  scheduleSync('tab-removed');
});
chrome.tabs.onMoved.addListener((tabId) => { void scheduleIfActiveTab(tabId, 'tab-moved'); });
chrome.tabs.onAttached.addListener((tabId) => { void scheduleIfActiveTab(tabId, 'tab-attached'); });
chrome.tabs.onDetached.addListener((tabId) => {
  // A detached tab becomes ungrouped and joins `non`.
  activeTabIds.delete(tabId);
  scheduleSync('tab-detached');
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.url === undefined && info.title === undefined && info.groupId === undefined) return;
  void (async () => {
    if (tab.groupId === -1 || await isActiveGroup(tab.groupId)) {
      activeTabIds.add(tab.id);
      scheduleSync('tab-updated');
    } else if (activeTabIds.delete(tab.id)) {
      scheduleSync('tab-updated');
    }
  })();
});
chrome.tabs.onReplaced?.addListener((addedTabId) => { void scheduleIfActiveTab(addedTabId, 'tab-replaced'); });

chrome.tabGroups.onCreated.addListener((group) => {
  void (async () => {
    groupTitles.set(group.id, group.title || '');
    if (!await isActiveGroup(group.id)) {
      await registerActiveGroup(group.id, group.title || '');
      scheduleSync('group-created');
    }
  })();
});
chrome.tabGroups.onUpdated.addListener((group) => {
  void (async () => {
    groupTitles.set(group.id, group.title || '');
    if (!await isActiveGroup(group.id)) {
      await registerActiveGroup(group.id, group.title || '');
    } else {
      // Update the name in storage if it changed
      await registerActiveGroup(group.id, group.title || '');
    }
    scheduleSync('group-updated');
  })();
});
chrome.tabGroups.onRemoved.addListener((group) => {
  void (async () => {
    groupTitles.delete(group.id);
    if (startupPending || isInternallyRemovedGroup(group.id)) return;
    if (await isActiveGroup(group.id)) {
      await unregisterActiveGroup(group.id);
      scheduleSync('group-removed');
    }
  })();
});
chrome.tabGroups.onMoved.addListener((group) => {
  void (async () => { if (await isActiveGroup(group.id)) scheduleSync('group-moved'); })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[S.K.ACTIVE_GROUPS]) void refreshActiveTabIds();
});

// ---- Retry alarm ----------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodic-sync') {
    if (await isRestoring()) return;
    // No early return: `non` is always live and must pull remote changes.
    try {
      await queueSessionSync('periodic');
    } catch (e) {
      await scheduleRetry(String(e?.message || e));
    }
    await updateBadge();
    return;
  }
  if (alarm.name !== 'retry') return;
  const st = await S.getSyncState();
  if (!st.dirty) { chrome.alarms.clear('retry').catch(() => {}); return; }
  try {
    await queueSessionSync('retry');
    chrome.alarms.clear('retry').catch(() => {});
  } catch {
    chrome.alarms.create('retry', { delayInMinutes: 5 }); // backoff
  }
  await updateBadge();
});

// ---- Message bus (popup / newtab / options) --------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'syncNow': {
        if (await isRestoring()) return { ok: false, error: 'RESTORING' };
        try {
          await queueSessionSync('manual');
          await refreshCache();
          await updateBadge();
          return { ok: true };
        } catch (e) {
          await scheduleRetry(String(e?.message || e));
          await updateBadge();
          return { ok: false, error: String(e?.message || e) };
        }
      }
      case 'refreshCache':
        return await refreshCache();
      case 'quickLinkOp':
        return await queueQuickLinkOperation(msg.op);
      case 'restore': {
        restoringNow = true;
        await chrome.storage.local.set({
          [RESTORE_FLAG_KEY]: { until: Date.now() + RESTORE_LOCK_MS, kind: 'manual' }
        });
        try {
          const refreshed = await refreshSessionList(msg.name);
          if (!refreshed.ok) {
            return refreshed;
          }
          const restored = await restoreList(msg.name, msg.mode);
          const stillOpen = restored.ok
            ? await chrome.tabGroups.get(restored.groupId).catch(() => null)
            : null;
          if (stillOpen) await registerActiveGroup(restored.groupId, msg.name);
          else if (restored.ok) return { ok: false, reason: 'CLOSED_DURING_RESTORE' };
          return restored;
        } finally {
          // Release after events settle, then resync (should be a no-op mirror).
          setTimeout(async () => {
            restoringNow = false;
            await chrome.storage.local.remove(RESTORE_FLAG_KEY).catch(() => {});
            scheduleSync('post-restore');
          }, 4000);
        }
      }
      case 'getState':
        return {
          settings: await S.getSettings(),
          sync: await S.getSyncState(),
          activity: await S.getActivity(),
          cache: await S.getCache()
        };
      case 'settingsChanged':
        await chrome.storage.local.remove(S.K.SESSION_SNAPSHOT);
        scheduleSync('settings');
        return { ok: true };
      default:
        return { ok: false, error: 'UNKNOWN_MESSAGE' };
    }
  })()
    .then((r) => sendResponse(r))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});

// ---- Lifecycle -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await S.logActivity('info', 'installed');
    chrome.runtime.openOptionsPage();
  }
  chrome.alarms.create('periodic-sync', { periodInMinutes: PERIODIC_SYNC_MINUTES });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  // Every browser launch starts with the remote library inactive on this device.
  chrome.alarms.create('periodic-sync', { periodInMinutes: PERIODIC_SYNC_MINUTES });
  startupPending = true;
  setTimeout(async () => {
    try {
      await activeGroupQueue;
      const activeGroups = await S.getActiveGroups();
      await closeAllBrowserGroups(new Set(activeGroups.map((group) => group.name)));
      await S.setActiveGroups([]);
      await chrome.storage.local.remove(S.K.SESSION_SNAPSHOT);
      const cache = await S.getCache();
      await S.saveCache({ ...cache, lists: cache.lists.map((list) => ({ ...list, live: false })) });
    } catch (e) {
      await scheduleRetry(String(e?.message || e));
    } finally {
      startupPending = false;
    }
    await updateBadge();
  }, 3500);
  await updateBadge();
});

// SW wake-up (event page semantics): resume any pending sync.
(async () => {
  const groups = await chrome.tabGroups.query({}).catch(() => []);
  for (const group of groups) groupTitles.set(group.id, group.title || '');
  await refreshActiveTabIds();
  const migration = await chrome.storage.local.get(S.K.ACTIVE_MODEL_MIGRATED);
  if (!migration[S.K.ACTIVE_MODEL_MIGRATED]) {
    const [activeGroups, cache] = await Promise.all([S.getActiveGroups(), S.getCache()]);
    if (!activeGroups.length) {
      const legacyNames = new Set(cache.lists.filter((list) => list.live).map((list) => list.name));
      await closeAllBrowserGroups(legacyNames);
      await S.saveCache({ ...cache, lists: cache.lists.map((list) => ({ ...list, live: false })) });
    }
    await chrome.storage.local.set({ [S.K.ACTIVE_MODEL_MIGRATED]: true });
  }
  const o = await chrome.storage.local.get(S.K.PENDING_AT);
  if (o[S.K.PENDING_AT]) scheduleSync('resume');
  await updateBadge();
})();
