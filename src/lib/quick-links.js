import { normalizeUrl, hostOf } from './normalize.js';

export function normalizeQuickLinks(links) {
  const seen = new Set();
  const result = [];
  for (const link of links || []) {
    const rawUrl = String(link?.url || '').trim();
    const url = normalizeUrl(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({
      id: link.id || crypto.randomUUID(),
      title: String(link.title || hostOf(url)).trim(),
      url,
      createdAt: link.createdAt || Date.now()
    });
  }
  return result;
}

export function quickLinksEqual(a, b) {
  const left = normalizeQuickLinks(a).map(({ title, url }) => [title, url]);
  const right = normalizeQuickLinks(b).map(({ title, url }) => [title, url]);
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyQuickLinkOperation(links, op) {
  const next = normalizeQuickLinks(links);
  if (op.type === 'add') {
    const [link] = normalizeQuickLinks([op.link]);
    if (!link) throw new Error('INVALID_QUICK_LINK');
    if (next.some((item) => item.url === link.url)) throw new Error('DUPLICATE_QUICK_LINK');
    next.push(link);
  } else if (op.type === 'edit') {
    if (!Number.isInteger(op.index) || !next[op.index]) throw new Error('INVALID_QUICK_LINK_INDEX');
    const [link] = normalizeQuickLinks([{ ...next[op.index], ...op.link }]);
    if (!link) throw new Error('INVALID_QUICK_LINK');
    if (next.some((item, index) => index !== op.index && item.url === link.url)) {
      throw new Error('DUPLICATE_QUICK_LINK');
    }
    next[op.index] = link;
  } else if (op.type === 'delete') {
    if (!Number.isInteger(op.index) || !next[op.index]) throw new Error('INVALID_QUICK_LINK_INDEX');
    next.splice(op.index, 1);
  } else if (op.type === 'reorder') {
    if (!Number.isInteger(op.from) || !Number.isInteger(op.to) || !next[op.from]) {
      throw new Error('INVALID_QUICK_LINK_INDEX');
    }
    const [moved] = next.splice(op.from, 1);
    next.splice(Math.max(0, Math.min(op.to, next.length)), 0, moved);
  } else {
    throw new Error('INVALID_QUICK_LINK_OPERATION');
  }
  return next;
}

export function stripOrderPrefix(title) {
  const match = /^(\d+)\s*-\s*(.*)$/.exec(title || '');
  return { order: match ? Number(match[1]) : 9999, title: match ? match[2] : (title || '') };
}

/** Survives Karakeep's crawler, which replaces bookmark link titles with the page title. */
export const QUICK_LINK_NOTE_MARKER = 'tabsync:ql:v1';

export function encodeQuickLinkNote(existingNote, index, title) {
  const payload = `${QUICK_LINK_NOTE_MARKER};${index};${encodeURIComponent(title || '')}`;
  const kept = String(existingNote || '')
    .split('\n')
    .filter((line) => !line.startsWith(`${QUICK_LINK_NOTE_MARKER};`));
  const userNote = kept.join('\n').trim();
  return userNote ? `${userNote}\n${payload}` : payload;
}

export function parseQuickLinkNote(note) {
  const line = String(note || '').split('\n').find((item) => item.startsWith(`${QUICK_LINK_NOTE_MARKER};`));
  if (!line) return null;
  const rest = line.slice(QUICK_LINK_NOTE_MARKER.length + 1);
  const sep = rest.indexOf(';');
  if (sep < 0) return null;
  const order = Number(rest.slice(0, sep));
  if (!Number.isInteger(order) || order < 0) return null;
  let title = rest.slice(sep + 1);
  try { title = decodeURIComponent(title); } catch { /* keep the raw payload */ }
  return { order, title };
}

/**
 * Authority is the note. A legacy `01 - Title` prefix is only a fallback.
 * A crawled page title has neither, so it must not become a new order key.
 */
export function parseStoredQuickLink(bookmark, sourceIndex = 0) {
  const noted = parseQuickLinkNote(bookmark?.note);
  if (noted) {
    return {
      url: bookmark.url,
      title: noted.title,
      order: noted.order,
      fromNote: true,
      fromPrefix: false,
      sourceIndex,
      note: bookmark.note || ''
    };
  }
  const rawTitle = String(bookmark?.title || '');
  const matched = /^(\d+)\s*-\s*/.test(rawTitle);
  const legacy = stripOrderPrefix(rawTitle);
  return {
    url: bookmark?.url,
    title: matched ? legacy.title : rawTitle,
    order: matched ? legacy.order : null,
    fromNote: false,
    fromPrefix: matched,
    sourceIndex,
    note: bookmark?.note || ''
  };
}

export function orderedTitle(index, link) {
  return `${String(index + 1).padStart(2, '0')} - ${link.title || hostOf(link.url)}`;
}
