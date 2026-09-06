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

export function orderedTitle(index, link) {
  return `${String(index + 1).padStart(2, '0')} - ${link.title || hostOf(link.url)}`;
}
