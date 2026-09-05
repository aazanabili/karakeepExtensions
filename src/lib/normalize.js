// URL normalization & filtering — pure functions, no chrome.* dependencies.

// Well-known tracking parameters (any utm_* is also stripped by prefix).
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'twclid', 'li_fat_id',
  'ref', 'ref_', 'ref_src', 'ref_url', 'spm', 'igshid', 'igsh', 'si', 'feature',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '_ga', 'mkt_tok', 'vero_id', 'wickedid',
  'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_kwcid', 'trk', 'trkInfo'
]);

/** Only http(s) URLs are syncable — blocks chrome://, edge://, about:, chrome-extension://, file:// ... */
export function isSyncableUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Canonicalize a URL: strip tracking params, sort the rest, unify YouTube IDs,
 * lowercase scheme/host, drop default ports and the root trailing slash.
 * Idempotent: normalizeUrl(normalizeUrl(x)) === normalizeUrl(x).
 * Returns null for non-syncable URLs.
 */
export function normalizeUrl(raw) {
  if (!isSyncableUrl(raw)) return null;
  try {
    const u = new URL(raw);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') ||
        (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }

    const host = u.hostname;

    // youtu.be/<id> -> https://www.youtube.com/watch?v=<id>
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
    }

    const isYtWatch = (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com')
      && u.pathname === '/watch';

    if (isYtWatch) {
      u.hostname = 'www.youtube.com'; // unify host as well (youtube.com / m.youtube.com)
      const v = u.searchParams.get('v');
      const t = u.searchParams.get('t');
      u.search = '';
      if (v) u.searchParams.set('v', v);
      if (t) u.searchParams.set('t', t);
    } else {
      const kept = [...u.searchParams.entries()].filter(([k]) => {
        const key = k.toLowerCase();
        if (key.startsWith('utm_')) return false;
        return !TRACKING_PARAMS.has(key);
      });
      kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      u.search = '';
      for (const [k, v] of kept) u.searchParams.append(k, v);
    }

    let out = u.toString();
    if (u.pathname === '/' && !u.search && !u.hash && out.endsWith('/')) {
      out = out.slice(0, -1);
    }
    return out;
  } catch {
    return null;
  }
}

/** Short display host, without leading www. */
export function hostOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Extension page for the Chromium favicon service (requires the "favicon" permission). */
export function faviconUrl(pageUrl, size = 32) {
  const base = chrome.runtime.getURL('/_favicon/');
  return `${base}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

/** Chrome tab-group color name -> hex (for card accents). */
export const GROUP_COLORS = {
  grey: '#9aa0a6', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
  green: '#188038', pink: '#e91e63', purple: '#9334e6', cyan: '#00acc1', orange: '#fa903e'
};
