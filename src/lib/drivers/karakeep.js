// Karakeep REST API driver — verified against docs.karakeep.app/api (v1).
// Auth: Bearer token. Pagination: ?cursor=&limit= with `nextCursor` in responses.

export class KarakeepError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class KarakeepDriver {
  constructor(serverUrl, apiKey) {
    if (!serverUrl || !apiKey) throw new KarakeepError('NOT_CONFIGURED', 0);
    this.base = serverUrl.replace(/\/+$/, '') + '/api/v1';
    this.key = apiKey;
  }

  async req(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: {
          'Authorization': `Bearer ${this.key}`,
          'Accept': 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new KarakeepError('NETWORK: ' + (e?.message || e), -1);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new KarakeepError(`HTTP ${res.status}${text ? ': ' + text.slice(0, 160) : ''}`, res.status);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /**
   * Cursor-paginated collector. A full page with no cursor is treated as
   * truncated: some servers stop at 20 or 100 and would otherwise hide every
   * link past that page.
   */
  async collectPages(path, field) {
    const items = [];
    let cursor = null;
    let truncated = false;
    const seen = new Set();
    const limit = 100;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const q = `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await this.req(q);
      const batch = page?.[field] || [];
      items.push(...batch);
      const next = page?.nextCursor ?? page?.next_cursor ?? null;
      const nextCursor = next == null || next === '' ? null : String(next);
      if (nextCursor && seen.has(nextCursor)) {
        truncated = true;
        break;
      }
      if (nextCursor) seen.add(nextCursor);
      cursor = nextCursor;
      if (!cursor && (batch.length === limit || batch.length === 20)) truncated = true;
    } while (cursor);
    return { items, truncated };
  }

  /** Cursor-paginated collector: iterates pages until nextCursor is null. */
  async collect(path, field) {
    const { items } = await this.collectPages(path, field);
    return items;
  }

  /** All lists: [{id, name, ...}] */
  getLists() {
    return this.collect('/lists', 'lists');
  }

  /** Create a list (API requires `name` + `icon`); on conflict, fall back to the existing one. */
  async createList(name, extra = {}) {
    try {
      return await this.req('/lists', { method: 'POST', body: { name, icon: '📚', ...extra } });
    } catch (e) {
      if (e.status === 400 || e.status === 409) {
        const existing = (await this.getLists()).find((l) => l.name === name);
        if (existing) return existing;
      }
      throw e;
    }
  }

  updateList(listId, patch) {
    return this.req(`/lists/${encodeURIComponent(listId)}`, { method: 'PATCH', body: patch });
  }

  deleteList(listId) {
    return this.req(`/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
  }

  /** All bookmarks inside a list: [{id, url, title, note}]. */
  async getListBookmarks(listId) {
    const { items, truncated } = await this.collectPages(
      `/lists/${encodeURIComponent(listId)}/bookmarks`,
      'bookmarks'
    );
    return {
      truncated,
      bookmarks: items
        .map((b) => ({
          id: b.id,
          url: b?.content?.url || '',
          title: b.title || '',
          note: b.note || '',
          archived: !!b.archived
        }))
        .filter((b) => b.url)
    };
  }

  /** Create a link bookmark (idempotent per URL — server returns the existing one). */
  createLink(url, title, note) {
    return this.req('/bookmarks', {
      method: 'POST',
      body: {
        type: 'link',
        url,
        title: title || null,
        ...(note ? { note } : {}),
        source: 'extension',
        crawlPriority: 'low'
      }
    });
  }

  addToList(listId, bookmarkId) {
    return this.req(`/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'PUT' });
  }

  removeFromList(listId, bookmarkId) {
    return this.req(`/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'DELETE' });
  }

  archiveBookmark(bookmarkId) {
    return this.req(`/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'PATCH', body: { archived: true } });
  }

  deleteBookmark(bookmarkId) {
    return this.req(`/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'DELETE' });
  }
}
