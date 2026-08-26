# Project Memory — Sismos

Running log of decisions and context for the 3D earthquake globe project.

## Decisions

- **2026-08-26** — Project kickoff. Requirements from Nico:
  - 3D globe (HTML) showing worldwide quakes from the last 24h.
  - Colored points by magnitude; visual distinction for recent vs older quakes.
  - Filters: magnitude, recency, country/zone/continent.
  - Tooltip (hover/touch) with well-formatted quake details.
  - Touch rotation + pinch zoom in/out.
  - Place quakes by coordinates (exact when available, approximate otherwise).
  - Periodic data refresh (data may change on the source).
  - Data source: https://www.volcanodiscovery.com/es/terremotos/hoy.html
  - Damaging quakes (https://www.volcanodiscovery.com/es/sismos/daninos.html) get a special tracking color, ONLY when the "Últimos terremotos de este año" option is enabled.
  - Must work deployed on Vercel.
- **2026-08-26** — Stack chosen: vanilla HTML/JS + globe.gl (CDN) frontend, Vercel serverless functions for scraping (avoids CORS, adds caching), USGS all_day.geojson as fallback source. No framework/build step.
- **2026-08-26** — Country borders added: world-atlas countries-110m TopoJSON + topojson-client (both unpkg CDN), rendered as globe.gl polygons with transparent caps and a subtle stroke; hovering a country shows its name. Non-fatal if the CDN fails.
- **2026-08-26** — Coverage fix: user reported far fewer painted quakes than VolcanoDiscovery's map. Two causes: (1) visual — micro-quakes were tiny and faded to 35% alpha; fixed with bigger minimum point radius, 65% alpha floor, and the cleaner `earth-dark.jpg` texture. (2) coverage — USGS all_day misses most sub-M4 quakes outside the US (VD aggregates national agencies). Fixed by merging USGS + EMSC (seismicportal.eu FDSN API, 349 quakes/24h, 44 in South America) with time/distance dedupe (|Δt| ≤ 90 s AND ≤ 100 km ⇒ duplicate). Endpoint now serves `source: 'usgs+emsc'` (~520 quakes vs 230 before).
- **2026-08-26** — Near-real-time updates: polling every 60 s (USGS refreshes its feed ~every minute; the sources offer no push, so SSE/WebSocket was ruled out on Vercel serverless), API cache lowered to 60 s (`s-maxage=60`), and a clickable toast announces newly detected quakes (click flies the camera to the strongest one).

- **2026-08-26** — Last-hour quakes now marked with an expand/contract wave (globe.gl `htmlElementsData` + CSS `scale` keyframe animation, colored by magnitude, pointer-events none). Rings layer is now damaging-quakes-only (magenta). Sponsor badge added bottom-left: RESOURCES OPEN DOORS S.A.S logo (`public/open-doors.jpg`, copied from `Logo/`) + "Financiado por" + Donar button linking to `mailto:ingenieriaaplicada@opendoors.com.ar`.

## Gotchas

- VolcanoDiscovery has no public API — HTML scraping server-side; parser must tolerate markup changes (hence the USGS fallback).
- **2026-08-26 probe findings**: the "hoy" page serves 200 to curl with a browser UA (Cloudflare did not challenge), but only server-renders ~9 recent rows (M >= 3.5) in `#qTable`; the advertised ~144-row list is loaded by client-side JS (`QuakeTable`) with no stable public JSON endpoint (`getQuakeMeter.php` is a gauge, `getLatest.php` only returns deltas). Exact coordinates ARE embedded per row as `openPopup(lat,lon,id)`. A second table `#qTableLargest` lists the largest quakes EVER (Valdivia 1960 M9.5) and must be excluded from the 24h parse.
- The "daninos" page fully server-renders the damaging list (~39 rows, 2025–2026) with exact 5-decimal coords and detail links — it works as the real primary for /api/damaging (filtered to the current UTC year).
- Consequence: /api/quakes treats VD as primary but requires >= 25 parsed quakes; below that it falls back to USGS all_day.geojson (231 quakes at verification time). In practice USGS serves the 24h endpoint; VD serves the damaging endpoint. Damaging fallback: USGS FDSN query M6+ since Jan 1 (significant_month only covers ~30 days).
- Damaging quakes are not magnitude-bound: the real list includes M < 1 events (shallow damaging swarms, e.g. Ethiopia) — never assert magnitude floors on that data.
