# Sismos — 3D Earthquake Globe

## Overview

Web app that displays worldwide earthquakes from the last 24 hours on an interactive 3D globe. Data is scraped from VolcanoDiscovery, with USGS GeoJSON as fallback. Deployed on Vercel.

## Data Sources

- **Primary**: https://www.volcanodiscovery.com/es/terremotos/hoy.html (last 24h quakes, scraped server-side)
- **Damaging quakes**: https://www.volcanodiscovery.com/es/sismos/daninos.html (destructive quakes of the current year, shown only when the "Últimos terremotos de este año" toggle is on)
- **Fallback**: USGS `all_day.geojson` feed (exact coordinates, last 24h) — used when scraping fails

## Architecture

- **Frontend**: static vanilla HTML/CSS/JS in `public/`, 3D globe rendered with globe.gl (three.js based) loaded from CDN. No framework, no build step.
- **Backend**: Vercel serverless functions in `api/` (Node 18+, native `fetch`). They scrape/normalize data, cache it in memory (~5 min) and set `s-maxage` headers so the client never hits the source site directly (also avoids CORS).
- **Shared logic**: parsing/normalization/filter helpers live in `lib/` so they are testable with `node --test`.

## Features

- Colored points by magnitude; size/opacity encodes recency (last 24h).
- Special highlight color for damaging quakes (only with the yearly toggle active).
- Filters: magnitude range, recency, country/region/continent.
- Hover/touch tooltip with full quake details.
- Drag to rotate (mouse/touch), pinch/scroll zoom.
- Auto-refresh of data every few minutes.

## Commands

- `npm test` — run unit tests (parser + filters) with `node --test`
- `npm run dev` — local dev server (serves `public/` + `api/` handlers without needing the Vercel CLI)
- Deploy: `vercel` (project is zero-config: static `public/` + `api/` functions)

## Conventions

- Code, comments, and UI copy in the repo: follow the existing project language (UI is Spanish-facing since the audience is Spanish-speaking; identifiers and comments in English).
- No external runtime dependencies unless strictly needed; prefer CDN for frontend libs.
- Never fetch the source sites from the browser — always through `api/` functions.
