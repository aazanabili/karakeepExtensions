import { normalizeUrl } from './normalize.js';

export function normalizeSessionState(state) {
  const lists = [];
  const names = new Set();
  for (const raw of state?.lists || []) {
    const name = String(raw?.name || '').trim();
    if (!name || names.has(name)) continue;
    names.add(name);
    const seen = new Set();
    const tabs = [];
    for (const tab of raw.tabs || raw.items || []) {
      const url = normalizeUrl(tab?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      tabs.push({ url, title: String(tab.title || url) });
    }
    lists.push({
      name,
      kind: raw.kind === 'non' ? 'non' : 'group',
      color: raw.color || '',
      tabs
    });
  }
  return { version: 1, lists };
}

export function sessionStatesEqual(a, b) {
  const key = (state) => normalizeSessionState(state).lists
    .filter((list) => list.tabs.length || list.kind === 'non')
    .map((list) => ({
      name: list.name,
      kind: list.kind,
      color: list.color,
      tabs: list.tabs.map((tab) => tab.url)
    }))
    .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
}

function urls(list) {
  return new Set((list?.tabs || []).map((tab) => tab.url));
}

export function detectSessionRenames(baseInput, changedInput) {
  const base = normalizeSessionState(baseInput);
  const changed = normalizeSessionState(changedInput);
  const changedNames = new Set(changed.lists.map((list) => list.name));
  const baseNames = new Set(base.lists.map((list) => list.name));
  const removed = base.lists.filter((list) => list.kind === 'group' && !changedNames.has(list.name));
  const added = changed.lists.filter((list) => list.kind === 'group' && !baseNames.has(list.name));
  const renames = new Map();
  const used = new Set();
  for (const oldList of removed) {
    const oldUrls = [...urls(oldList)];
    const match = added.find((candidate) => {
      if (used.has(candidate.name) || candidate.tabs.length !== oldUrls.length) return false;
      const candidateUrls = urls(candidate);
      return oldUrls.every((url) => candidateUrls.has(url));
    });
    if (match) {
      renames.set(oldList.name, match.name);
      used.add(match.name);
    }
  }
  return renames;
}

export function findTabsToArchive(baseInput, changedInput) {
  const base = normalizeSessionState(baseInput);
  const changed = normalizeSessionState(changedInput);
  const changedByName = new Map(changed.lists.map((list) => [list.name, list]));
  const currentLocations = new Map();
  for (const list of changed.lists) {
    for (const tab of list.tabs) currentLocations.set(tab.url, list.name);
  }
  const removed = [];
  for (const list of base.lists) {
    const currentList = changedByName.get(list.name);
    const wholeGroupClosed = list.kind === 'group' && !currentList &&
      list.tabs.every((tab) => !currentLocations.has(tab.url));
    if (wholeGroupClosed && list.tabs.length > 1) continue;
    const currentUrls = urls(currentList);
    for (const tab of list.tabs) {
      if (currentUrls.has(tab.url)) continue;
      if (currentLocations.has(tab.url)) continue; // moved or group renamed
      removed.push({ group: list.name, title: tab.title, url: tab.url, removedAt: Date.now() });
    }
  }
  return removed;
}

function mergeListTabs(baseList, changedList, remoteList) {
  const baseUrls = urls(baseList);
  const changedUrls = urls(changedList);
  const changedByUrl = new Map(changedList.tabs.map((tab) => [tab.url, tab]));
  let tabs = remoteList.tabs.filter((tab) => !baseUrls.has(tab.url) || changedUrls.has(tab.url));

  for (let index = 0; index < changedList.tabs.length; index++) {
    const tab = changedList.tabs[index];
    if (!baseUrls.has(tab.url) && !tabs.some((item) => item.url === tab.url)) {
      tabs.splice(Math.min(index, tabs.length), 0, tab);
    }
  }

  // Add/remove alone must not overwrite a newer remote order. Reorder only when
  // the relative order of tabs common to base/current was explicitly changed.
  const baseCommonOrder = baseList.tabs
    .filter((tab) => changedUrls.has(tab.url))
    .map((tab) => tab.url);
  const changedCommonOrder = changedList.tabs
    .filter((tab) => baseUrls.has(tab.url))
    .map((tab) => tab.url);
  const orderChanged = JSON.stringify(baseCommonOrder) !== JSON.stringify(changedCommonOrder);
  if (orderChanged) {
    const changedOrder = changedList.tabs.map((tab) => tab.url);
    const touched = tabs.filter((tab) => changedByUrl.has(tab.url));
    touched.sort((a, b) => changedOrder.indexOf(a.url) - changedOrder.indexOf(b.url));
    let touchedIndex = 0;
    tabs = tabs.map((tab) => changedByUrl.has(tab.url) ? touched[touchedIndex++] : tab);
  }
  return tabs;
}

/** Reapply the browser change between base/current onto the newest storage state. */
export function rebaseSessionChange(baseInput, changedInput, remoteInput) {
  const base = normalizeSessionState(baseInput);
  const changed = normalizeSessionState(changedInput);
  const remote = normalizeSessionState(remoteInput);
  const result = normalizeSessionState(remote);
  const resultByName = new Map(result.lists.map((list) => [list.name, list]));
  const baseByName = new Map(base.lists.map((list) => [list.name, list]));
  const changedByName = new Map(changed.lists.map((list) => [list.name, list]));
  const renames = detectSessionRenames(base, changed);
  const renamedTargets = new Set(renames.values());

  for (const [oldName, newName] of renames) {
    const remoteList = resultByName.get(oldName);
    const changedList = changedByName.get(newName);
    if (!remoteList || resultByName.has(newName)) continue;
    resultByName.delete(oldName);
    remoteList.name = newName;
    remoteList.color = changedList.color;
    remoteList.tabs = mergeListTabs(baseByName.get(oldName), changedList, remoteList);
    resultByName.set(newName, remoteList);
  }

  for (const changedList of changed.lists) {
    if (renamedTargets.has(changedList.name)) continue;
    const baseList = baseByName.get(changedList.name);
    const remoteList = resultByName.get(changedList.name);
    if (!baseList) {
      if (!remoteList) resultByName.set(changedList.name, structuredClone(changedList));
      continue;
    }
    if (!remoteList) continue;
    remoteList.tabs = mergeListTabs(baseList, changedList, remoteList);
    if (baseList.color !== changedList.color) remoteList.color = changedList.color;
  }

  for (const baseList of base.lists) {
    if (changedByName.has(baseList.name) || renames.has(baseList.name)) continue;
    if (baseList.kind === 'group') {
      const locations = new Map();
      for (const list of changed.lists) {
        for (const tab of list.tabs) locations.set(tab.url, list.name);
      }
      const moved = baseList.tabs.filter((tab) => locations.has(tab.url));
      if (!moved.length) continue; // Entire group closed: retain it in storage.
      const remoteList = resultByName.get(baseList.name);
      if (remoteList) {
        remoteList.tabs = remoteList.tabs.filter((tab) => !moved.some((item) => item.url === tab.url));
      }
    } else {
      resultByName.delete(baseList.name); // Last non tab was closed.
    }
  }

  return normalizeSessionState({ version: 1, lists: [...resultByName.values()] });
}
