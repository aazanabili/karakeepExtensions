// Search engines registry — extensible list with localized labels.

export const ENGINES = [
  {
    id: 'google',
    name: { en: 'Google', ar: 'جوجل' },
    url: 'https://www.google.com/search?q=%s',
    icon: 'https://www.google.com/favicon.ico',
    suggest: null
  },
  {
    id: 'bing',
    name: { en: 'Bing', ar: 'بينج' },
    url: 'https://www.bing.com/search?q=%s',
    icon: 'https://www.bing.com/favicon.ico',
    suggest: null
  },
  {
    id: 'duckduckgo',
    name: { en: 'DuckDuckGo', ar: 'دك دك جو' },
    url: 'https://duckduckgo.com/?q=%s',
    icon: 'https://duckduckgo.com/favicon.ico',
    suggest: null
  },
  {
    id: 'youtube',
    name: { en: 'YouTube', ar: 'يوتيوب' },
    url: 'https://www.youtube.com/results?search_query=%s',
    icon: 'https://www.youtube.com/favicon.ico',
    suggest: null
  },
  {
    id: 'wikipedia',
    name: { en: 'Wikipedia', ar: 'ويكيبيديا' },
    url: 'https://%l.wikipedia.org/w/index.php?search=%s', // %l = lang (en/ar)
    icon: 'https://wikipedia.org/favicon.ico',
    suggest: null
  },
  {
    id: 'sear',
    name: { en: 'sear.zanabili.work', ar: 'sear.zanabili.work' },
    url: 'https://sear.zanabili.work/search?q=%s',
    icon: 'https://sear.zanabili.work/favicon.ico',
    suggest: null
  }
];

export function buildSearchUrl(engine, query, lang = 'en') {
  let url = engine.url.replace('%s', encodeURIComponent(query));
  if (engine.id === 'wikipedia') {
    url = url.replace('%l', lang);
  }
  return url;
}
