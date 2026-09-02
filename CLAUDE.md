# Perioteca

## Overview

Web app that displays ongoing world events (disasters, storms, wildfires, earthquakes, floods) on an interactive 3D globe, unified under a single 0–10 magnitude scale by a feed-agnostic magnitude engine. Structure mirrors the `_referencia` sismos project. Deployable on Vercel (zero-config: static `public/` + `api/` functions).

## Data Sources (v1 core — stable, no API key)

- **GDACS** (EU/UN JRC): `https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP` — GeoJSON of current events with expert Green/Orange/Red alert grading. Primary magnitude signal. Gotcha: dates come without zone marker but are UTC.
- **NASA EONET v3**: open natural events of the last 30 days, GeoJSON. Storm tracks arrive as LineStrings (last point = current position).
- **USGS all_day**: dense US earthquake coverage, refreshed ~every minute.
- **EMSC** (seismicportal.eu FDSN): fills sub-M4 quakes outside the US, incl. South America.
- **INPRES** (Argentina): sismos.xml feed; UTC comes encoded in idSismo (YYYYMMDDHHMMSS).
- **CSN Chile** (via api.boostr.cl): local time America/Santiago converted to UTC via Intl (DST-safe).
- Quake merge replicates the sismos reference: locals win over globals, 90 s / 100 km dedupe window; GDACS EQ entries (with alert grading) win over all catalog copies.
- **Offline geocoder** (`lib/geocode.js` + GeoNames `lib/data/cities.json`): "N km al X de Ciudad, Provincia, País" labels (`near` field), annotated server-side once per cache rebuild.
- **Vector borders** (`public/borders.js` + `admin1-lines.json` + world-atlas CDN): country + admin-1 lines as merged THREE.LineSegments over the globe texture, hierarchy via opacity.
- **NASA FIRMS** (`lib/firms.js`): keyless global 24h MODIS active-fire CSV (~40k pixels), clustered on a 0.5° grid with 8-neighbor union-find into fire events; FRP-weighted centroid, magnitude from total MW (log anchors). Fills the wildfire gap EONET leaves outside the US (its incident feed is IRWIN, US-only) — the Amazon/Chaco coverage comes from here.
- **NOAA NHC** (`lib/nhc.js`): CurrentStorms.json, keyless — active tropical cyclones with position and sustained winds (kt). Named-storm dedupe: agencies date the same cyclone days apart, so `mergeEvents` also matches same-family events by proper name (KARINA-26 vs Karina).
- **i18n** (`public/i18n.js`, dual-use module tested with node --test): titles are CONSTRUCTED from structured fields (kind + cc + eventName + nearData) in the viewer's browser language (es/en/pt/fr/de, `?lang=` override), never translated from feed text; country names via Intl.DisplayNames; dates via toLocaleString in the viewer's own timezone. The API ships structured `nearData` ({name, admin1, cc, distKm, dir}) alongside the Spanish `near` label for this.
- **Realtime**: frontend polls /api/events every 60 s, refreshes on tab visibilitychange, and announces newly-seen event ids with their magnitude (alert toast).
- **Sponsor**: Open Doors badge + "Mochila de Emergencia" lead form (`lib/mochila.js`, `api/mochila.js`) forwarded server-side to a Google Form, honeypot included — ported from the sismos reference.

**Decision (2026-09-02):** GDELT was dropped from the v1 core — its API was down (connection refused) the very day this repo was scaffolded, confirming it cannot be a critical-path dependency. The stable multi-source merge above replaces it. GDELT, Wikimedia Pageviews, and ReliefWeb (v2 now requires an approved appname) remain future optional adapters for the attention axis; the two-axis attention/impact quadrant from the research notes below is still the goal.

## Architecture

- **Magnitude engine** (`lib/magnitude.js`): feed-agnostic core — 0–10 scale, user-facing tiers (pequeño/mediano/grande/gigante), log-space anchoring for heavy-tailed quantities, GDACS alert-band mapping, Omori-inspired temporal decay. Never imports a feed.
- **Adapters** (`lib/gdacs.js`, `lib/eonet.js`, `lib/usgs.js`): each maps its raw severity signal onto the engine scale and normalizes to the shared event shape in `lib/normalize.js`. New verticals = new adapters; the engine does not change.
- **API** (`api/events.js`): Vercel serverless. Fetches all feeds with `Promise.allSettled` (any source may fail), merges with kind-aware time/distance dedupe (GDACS wins; tight 90 s window for quakes, wide 48 h for ongoing fires/storms), caches ~5 min, serves stale on total failure.
- **Frontend** (`public/`): static vanilla HTML/CSS/JS, globe.gl from CDN, no build step. Points colored by tier, sized by magnitude, faded by the decay curve; red-alert events emit rings. Filters: min magnitude, kind, period, continent, text, orange/red-only. Never fetches upstream feeds from the browser — always through `/api/events`.

## Commands

- `npm test` — unit tests (engine + adapters) with `node --test`, real API fixtures in `tests/fixtures/`
- `npm run dev` — local dev server (serves `public/` + `api/` handlers without the Vercel CLI)
- Deploy: `vercel`

## Conventions

- UI copy is Spanish-facing (audience); identifiers and comments in English.
- Tier and continent values are Spanish because they are user-facing strings.
- No external runtime dependencies; CDN for frontend libs.
- Legal: show title + link + short metadata only, never article/report body text.

## Visión del producto

No es "la tercera app": es un **motor de magnitud para flujos geolocalizados** — normalización contra baseline, escala logarítmica, decaimiento temporal, filtrado por tier, ficha de detalle, acción de salida. Sismos, eventos y noticias son la misma aplicación con tres feeds. El motor va separado y cada feed es un adaptador: el cuarto y quinto vertical salen en un fin de semana cada uno. Verticales con plata real esperando: brotes epidemiológicos, cortes de energía, disrupciones logísticas portuarias.

## GDELT es el USGS de las noticias

Procesa medios de todo el mundo, actualiza cada 15 minutos, geolocaliza cada evento con lat/long, y trae los campos necesarios para una escala de magnitud ya calculados:

- `NumMentions`, `NumSources`, `NumArticles` — cuánta cobertura generó
- `GoldsteinScale` (−10 a +10) — impacto teórico del tipo de suceso sobre la estabilidad del país
- `AvgTone` — tono agregado de la cobertura
- `ActionGeo_Lat/Long` + código CAMEO del tipo de evento
- Sin API key, gratis; la GEO 2.0 API devuelve GeoJSON directo (lo que el mapa consume)

Con eso, el "pequeño / mediano / grande / gigante" sale del dato el primer día.

## El problema real: atención ≠ importancia

El volumen de cobertura mide atención, no importancia. Un divorcio de celebridad supera en `NumArticles` a una hambruna. Si la magnitud es volumen crudo, el mapa se convierte en un termómetro del sesgo mediático occidental y el producto muere ahí.

**La solución (préstamo del dominio sísmico):** un sismógrafo no mide el ruido absoluto, mide la desviación respecto del ruido de fondo. La magnitud no debe ser el volumen de cobertura, sino el **z-score del volumen contra la línea base histórica de esa región y ese tema**. Trescientos artículos sobre Nueva York es martes. Trescientos artículos sobre una provincia de Chad es un terremoto.

Eso da dos ejes en vez de uno:

- **Magnitud** = anomalía de atención (z-score contra baseline)
- **Impacto** = Goldstein, víctimas, gente afectada (ACLED o ReliefWeb)

Los eventos donde los ejes no coinciden son el contenido más valioso: alta magnitud / bajo impacto es circo mediático; **bajo magnitud / alto impacto es la crisis que nadie está mirando**. Ese cuadrante solo justifica la app. Ningún agregador de noticias lo muestra.

## Medir apenas haya ingest: decaimiento tipo Omori

Los sismos tienen réplicas que decaen según la ley de Omori (potencia inversa del tiempo). La cobertura mediática de una noticia grande decae de forma sospechosamente parecida — pico agudo, cola larga, con rebrotes.

Ajustar la curva de decaimiento de `NumArticles` por historia contra Omori. Si calza:

1. **Predictor**: a las 6 horas ya se sabe si la historia dura una semana o muere mañana — feature real ("esto recién empieza")
2. La analogía deja de ser decorativa y se vuelve mecánica — isomorfismo cerrado y medible

## Comparación con el vertical de eventos

**A favor:** sin ToS de branding, sin cuota de 5000 llamadas, sin problema de cobertura geográfica (la cobertura de noticias en Latinoamérica es infinitamente mejor que la de Ticketmaster). El eje temporal es más natural: las noticias decaen, el mapa se apaga solo.

**En contra (serio):** no monetiza como eventos — no hay link de afiliado. Un mapa de noticias es un juguete hermoso que no factura. El dinero en este vertical es **B2B**: monitoreo de riesgo para seguros, cadena de suministro, seguridad corporativa, redacciones. Comparables: Dataminr, Factal, Liveuamap — no un agregador de noticias. Por esa vía el producto es un panel de riesgo geolocalizado con alertas, y el cuadrante "alto impacto / baja atención" es literalmente lo que un área de riesgo paga por ver.

**Legal:** más simple que Ticketmaster pero no gratis. Titular + enlace + snippet corto, nunca el texto del artículo. GDELT da URLs y metadata a propósito, no contenido: respetar esa línea.

**Volumen:** GDELT es enorme. No ingerir todo. Filtrar en la ingesta por código CAMEO y por umbral de `NumSources`, o son terabytes para mostrar mil puntos.

## Fuentes

### Núcleo

- [GDELT — Data & querying](https://gdeltproject.org/data.html) — punto de entrada a todo
- [GEO 2.0 API](https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/) — GeoJSON geolocalizado, sin key: la capa de mapa
- [DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) — búsqueda de artículos y series temporales de volumen (de acá sale el z-score y la curva de Omori)
- [Context 2.0 API](https://blog.gdeltproject.org/announcing-the-gdelt-context-2-0-api/) — contexto textual alrededor de las menciones
- GDELT Event Database en BigQuery — para calcular baselines históricos (por API sola es inviable)

### Eje de impacto

- [ReliefWeb API](https://reliefweb.int/help/api) — ONU/OCHA, desastres y crisis humanitarias, geolocalizado, gratis: gente afectada, no artículos publicados
- [NASA EONET](https://eonet.gsfc.nasa.gov/) — eventos naturales en curso, GeoJSON, gratis
- ACLED — conflicto armado geolocalizado con víctimas; registro gratuito, el mejor dato duro de impacto disponible

### Eje de atención

- [Wikimedia Analytics / Pageviews API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/getting-started.html) — gratis, sin key: el pico de visitas a un artículo de Wikipedia es la mejor medida de atención pública real, e independiente de GDELT. Dos señales independientes que coinciden valen mucho más que una.
- Portal de Actualidad de Wikipedia — curado por humanos, sirve como conjunto de validación para calibrar la escala
