// Service worker (MV3, ES modules): event debouncing, offline retry, badge, message bus.

import { refreshCache, restoreList, mutateQuickLinks } from './sync.js';
import { synchronizeSession } from './session.js';
import * as S from '../lib/settings.js';

const DEBOUNCE_MS = 2500;
const PERIODIC_SYNC_MINUTES = 1;
const RESTORE_FLAG_KEY = 'restoring'; // { until: ts } — survives SW restarts
const RESTORE_LOCK_MS = 30000;

let debounceTimer = null;
let restoringNow = false; // in-memory fast path
let startupPending = false;
let quickLinkQueue = Promise.resolve();
let sessionQueue = Promise.resolve();

function queueQuickLinkOperation(op) {
  const result = quickLinkQueue.then(() => mutateQuickLinks(op));
  quickLinkQueue = result.catch(() => {});
  return result;
}

function queueSessionSync(trigger, forceRestore = false) {
  const result = sessionQueue.then(() => synchronizeSession(trigger, forceRestore));
  sessionQueue = result.catch(() => {});
  return result;
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

chrome.tabs.onCreated.addListener(() => scheduleSync('tab-created'));
chrome.tabs.onRemoved.addListener(() => scheduleSync('tab-removed'));
chrome.tabs.onMoved.addListener(() => scheduleSync('tab-moved'));
chrome.tabs.onAttached.addListener(() => scheduleSync('tab-attached'));
chrome.tabs.onDetached.addListener(() => scheduleSync('tab-detached'));
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url !== undefined || info.title !== undefined) scheduleSync('tab-updated');
});
chrome.tabs.onReplaced?.addListener(() => scheduleSync('tab-replaced'));

chrome.tabGroups.onCreated.addListener(() => scheduleSync('group-created'));
chrome.tabGroups.onUpdated.addListener(() => scheduleSync('group-updated'));
chrome.tabGroups.onRemoved.addListener(() => scheduleSync('group-removed'));
chrome.tabGroups.onMoved.addListener(() => scheduleSync('group-moved'));

// ---- Retry alarm ----------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodic-sync') {
    if (await isRestoring()) return;
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
        await chrome.storage.local.set({ [RESTORE_FLAG_KEY]: { until: Date.now() + RESTORE_LOCK_MS } });
        try {
          return await restoreList(msg.name, msg.mode);
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
  // Wait for Chromium's own session restoration, then make it match central storage.
  chrome.alarms.create('periodic-sync', { periodInMinutes: PERIODIC_SYNC_MINUTES });
  startupPending = true;
  setTimeout(async () => {
    try { await queueSessionSync('startup', true); } catch (e) {
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
  const o = await chrome.storage.local.get(S.K.PENDING_AT);
  if (o[S.K.PENDING_AT]) scheduleSync('resume');
  await updateBadge();
})();
