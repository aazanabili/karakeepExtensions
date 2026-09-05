// Local TXT driver — one GroupName.txt per list (one URL per line).
// The FileSystemDirectoryHandle is stored in IndexedDB (shared origin across SW + pages).
// Chromium drops permission on browser restart: queryPermission works anywhere,
// but requestPermission needs a user gesture (called from options/newtab pages only).

import { isSyncableUrl, normalizeUrl } from '../normalize.js';

const DB = 'tabsync';
const STORE = 'handles';
const KEY = 'dir';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const q = tx.objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
  } catch {
    return null;
  }
}

export async function clearHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queryPerm(handle) {
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

/** Requires a user gesture — only call from a page (options/newtab), never from the SW. */
export async function requestPerm(handle) {
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

export function sanitizeFileName(name) {
  const clean = String(name).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
  return clean || 'list';
}

/** Read every *.txt in the folder: [{name, items:[{url,title}], updatedAt}] */
export async function readAllLists(handle) {
  const lists = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.txt')) continue;
    try {
      const file = await entry.getFile();
      const text = await file.text();
      const seen = new Set();
      const items = [];
      for (const line of text.split(/\r?\n/)) {
        const raw = line.trim();
        if (!isSyncableUrl(raw)) continue;
        const url = normalizeUrl(raw) || raw;
        if (seen.has(url)) continue;
        seen.add(url);
        items.push({ url, title: '' });
      }
      lists.push({ name: entry.name.replace(/\.txt$/i, ''), items, updatedAt: file.lastModified });
    } catch {
      // skip unreadable file
    }
  }
  lists.sort((a, b) => a.name.localeCompare(b.name));
  return lists;
}

/**
 * Mirror-write the desired state (Map<name, items[]>) into the folder.
 * Only files we previously created (knownFiles) are ever deleted — user files are untouched.
 * Returns the new list of managed file names.
 */
export async function writeMirror(handle, state, knownFiles) {
  const written = new Set();
  for (const [name, list] of state) {
    const fileName = sanitizeFileName(name) + '.txt';
    const fh = await handle.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(list.items.map((i) => i.url).join('\n') + '\n');
    await w.close();
    written.add(fileName);
  }
  for (const fileName of knownFiles) {
    if (!written.has(fileName)) {
      try { await handle.removeEntry(fileName); } catch { /* already gone */ }
    }
  }
  return [...written];
}
