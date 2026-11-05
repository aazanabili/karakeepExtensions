---
name: seo-geo-surface
description: Build technical SEO and GEO surfaces. Use for public pages that need metadata, JSON-LD, sitemaps, Core Web Vitals, or llms.txt for AI crawlers. Do not use it to invent a public site.
---

# SEO and GEO

Load `engineering-baseline`. Load `cross-platform-hardening` before adding third-party scripts.

Make public pages accurately discoverable by search engines and AI answer engines. Do not expose tenant data, tokens, or private records in any crawlable surface.

## Steps

1. Unique titles and descriptions, canonical URLs, and `hreflang` for every public locale and direction, including RTL and LTR. No duplicate-content traps.
2. JSON-LD from the same canonical data as the page. Validate it. Do not keep a hand-written divergent copy.
3. Dynamic chunked sitemaps with accurate `lastmod`. Split index and children at scale. Reference them from `robots.txt`.
4. Robots rules match intent. Do not block what must be indexed. Do not index what must not leak. Pagination and canonicals survive filtered views.
5. Measure real LCP, INP, and CLS. Keep heavy bundles and third parties off the critical path. Optimize images, fonts, and critical CSS. Never claim an improvement without a measurement.
6. Generate `/llms.txt` and `/llms-full.txt` from current public content, in clean sectioned language, and keep them current. They describe public facts only.
7. Fetch rendered pages, validate JSON-LD, check sitemap freshness, and run a real CWV or Lighthouse pass. Report numbers and gaps.

## Done when

Surfaces are generated from canonical public data, verification ran, and unmeasured items are NOT RUN rather than estimated.
