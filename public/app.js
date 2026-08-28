/* Sismos — frontend logic: data loading, filters and the 3D globe. */
/* global Globe */

(() => {
  'use strict';

  // ---------- Constants ----------

  const REFRESH_MS = 60 * 1000; // near-real-time polling (USGS feed updates ~every minute)
  const TICK_MS = 30 * 1000; // "updated X min ago" ticker
  const RECENT_MS = 60 * 60 * 1000; // quakes newer than this pulse

  const COLORS = {
    green: [46, 204, 113],
    yellow: [241, 196, 15],
    orange: [230, 126, 34],
    red: [231, 76, 60],
    magenta: [224, 64, 251]
  };

  // ---------- State ----------

  const state = {
    quakes: [],
    damaging: [],
    damagingLoaded: false,
    updatedAt: null,
    filters: {
      minMag: 0,
      windowHours: 24,
      continent: '',
      text: '',
      showDamaging: false
    }
  };

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    globe: $('globe'),
    loading: $('loading'),
    errorBox: $('errorBox'),
    retryBtn: $('retryBtn'),
    refreshBtn: $('refreshBtn'),
    updated: $('updated'),
    counter: $('counter'),
    magSlider: $('magSlider'),
    magValue: $('magValue'),
    windowSelect: $('windowSelect'),
    continentSelect: $('continentSelect'),
    placeInput: $('placeInput'),
    damagingToggle: $('damagingToggle'),
    panel: $('panel'),
    panelToggle: $('panelToggle'),
    quakeCard: $('quakeCard'),
    toast: $('toast'),
    mochilaBtn: $('mochilaBtn'),
    mochilaModal: $('mochilaModal'),
    mochilaForm: $('mochilaForm'),
    mochilaClose: $('mochilaClose'),
    mochilaSubmit: $('mochilaSubmit'),
    mochilaError: $('mochilaError'),
    mochilaSuccess: $('mochilaSuccess')
  };

  // ---------- Formatting helpers (Spanish UI copy) ----------

  // No explicit timeZone: each viewer sees quake times in their own local
  // zone (the browser's), with the GMT offset appended so it is unambiguous.
  const localFmt = new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  function relativeTime(iso) {
    const diff = Date.now() - Date.parse(iso);
    const min = Math.round(diff / 60000);
    if (min < 1) return 'hace instantes';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    const rem = min % 60;
    if (h < 24) return rem ? `hace ${h} h ${rem} min` : `hace ${h} h`;
    const d = Math.floor(h / 24);
    return `hace ${d} día${d > 1 ? 's' : ''}`;
  }

  function formatLocal(iso) {
    return localFmt.format(new Date(iso));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ---------- Colors / sizing ----------

  function magRgb(mag, damaging) {
    if (damaging) return COLORS.magenta;
    if (mag < 3) return COLORS.green;
    if (mag < 4.5) return COLORS.yellow;
    if (mag < 6) return COLORS.orange;
    return COLORS.red;
  }

  function recencyAlpha(iso) {
    const age = Date.now() - Date.parse(iso);
    if (age <= RECENT_MS) return 1;
    const t = Math.min(1, age / (24 * 3600 * 1000));
    return 1 - 0.35 * t; // fades down to ~0.65 at 24 h — older quakes must stay clearly visible
  }

  function pointColor(q) {
    const [r, g, b] = magRgb(q.magnitude, q.damaging);
    const a = q.damaging ? 0.95 : recencyAlpha(q.time);
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  }

  // Shrinks point radii as the camera zooms in, so clustered quakes separate
  // and each point sits precisely on its coordinates. 1 at the default
  // altitude (2.5), down to ~1/8 when fully zoomed in.
  let zoomScale = 1;

  function pointRadius(q) {
    // Generous minimum size so micro-quakes (M < 2) remain visible on the globe.
    return Math.max(0.32, 0.22 + 0.11 * Math.max(0, q.magnitude)) * zoomScale;
  }

  // Markers currently on the globe — needed to resolve taps manually on touch
  // devices, where the merged mesh has no per-point events.
  let renderedMarkers = [];

  function quakesNear(lat, lng) {
    // Tap tolerance shrinks proportionally with zoom, so zooming in genuinely
    // increases selection precision (degrees of arc).
    const tol = Math.max(0.15, 3.5 * zoomScale);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    return renderedMarkers
      .map((q) => {
        const dLat = q.lat - lat;
        const dLon = (((q.lon - lng + 540) % 360) - 180) * cosLat;
        return { q, d: Math.hypot(dLat, dLon) };
      })
      .filter((x) => x.d <= tol)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.q);
  }


  // ---------- Quake card HTML ----------

  function quakeCardHtml(q, { closable = false } = {}) {
    const [r, g, b] = magRgb(q.magnitude, q.damaging);
    const coords = `${q.lat.toFixed(2)}°, ${q.lon.toFixed(2)}°`;
    const depth = q.depthKm != null ? `${q.depthKm} km` : 'no disponible';
    const src = {
      usgs: 'USGS',
      emsc: 'EMSC',
      volcanodiscovery: 'VolcanoDiscovery',
      inpres: 'INPRES',
      csn: 'CSN (Chile)'
    }[q.source] || q.source;
    const precision = q.exactCoords ? 'exactas' : 'aproximadas';
    return `
      ${closable ? '<button class="qc-close" aria-label="Cerrar">×</button>' : ''}
      <div class="qc-head">
        <span class="qc-mag" style="color:rgb(${r},${g},${b})">M ${q.magnitude.toFixed(1)}</span>
        ${q.damaging ? '<span class="qc-badge">Sismo dañino</span>' : ''}
      </div>
      <div class="qc-place">${escapeHtml(q.place || 'Ubicación desconocida')}</div>
      ${q.near ? `<div class="qc-row">Cerca de: <b>${escapeHtml(q.near)}</b></div>` : ''}
      <div class="qc-row"><b>${relativeTime(q.time)}</b> · ${formatLocal(q.time)}</div>
      <div class="qc-row">Profundidad: <b>${depth}</b></div>
      <div class="qc-row">Coordenadas: <b>${coords}</b> (${precision})</div>
      <div class="qc-row">Fuente: <b>${src}</b></div>
    `;
  }

  function showQuakeCard(q) {
    el.quakeCard.innerHTML = quakeCardHtml(q, { closable: true });
    el.quakeCard.classList.remove('hidden');
    el.quakeCard.querySelector('.qc-close').addEventListener('click', () => {
      el.quakeCard.classList.add('hidden');
    });
    appendGeoRow(q);
  }

  // ---------- Reverse geocoding of the open card ----------
  // Only the tap/click card triggers a lookup (never the hover tooltip, which
  // would spam the geocoder). Results are cached per quake id, and a token
  // guards against a late response landing after a different card opened.

  const geoCache = new Map(); // quake id -> label string | null
  let geoToken = 0;

  function appendGeoRow(q) {
    // Quakes annotated server-side already carry `near` (label or null) and
    // quakeCardHtml rendered the row; the fetch fallback only serves quakes
    // from stale payloads that predate the annotation (deploy transition).
    if (q.near !== undefined) return;
    const token = ++geoToken;
    const insert = (html) => {
      const row = document.createElement('div');
      row.className = 'qc-row';
      row.innerHTML = html;
      const link = el.quakeCard.querySelector('.qc-link');
      if (link) el.quakeCard.insertBefore(row, link);
      else el.quakeCard.appendChild(row);
      return row;
    };

    if (geoCache.has(q.id)) {
      const label = geoCache.get(q.id);
      if (label) insert(`Cerca de: <b>${escapeHtml(label)}</b>`);
      return;
    }

    const row = insert('<span style="opacity:.7">Buscando ubicación…</span>');
    fetch(`/api/geocode?lat=${q.lat}&lon=${q.lon}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        geoCache.set(q.id, data.place || null);
        if (token !== geoToken) return; // another card opened meanwhile
        if (data.place) row.innerHTML = `Cerca de: <b>${escapeHtml(data.place)}</b>`;
        else row.remove();
      })
      .catch(() => {
        if (token === geoToken) row.remove();
      });
  }

  // When a tap lands on a cluster, let the user pick instead of guessing.
  function showQuakePicker(quakes) {
    const shown = quakes.slice(0, 6);
    const rows = shown
      .map((q, i) => {
        const [r, g, b] = magRgb(q.magnitude, q.damaging);
        return `<button class="qc-pick" data-i="${i}">
          <span class="qc-pick-mag" style="color:rgb(${r},${g},${b})">M ${q.magnitude.toFixed(1)}</span>
          <span class="qc-pick-place">${escapeHtml(q.place || 'Ubicación desconocida')}</span>
          <span class="qc-pick-time">${relativeTime(q.time)}</span>
        </button>`;
      })
      .join('');
    const extra = quakes.length > shown.length
      ? `<div class="qc-pick-more">Hay ${quakes.length - shown.length} más en esta zona — acercate para distinguirlos.</div>`
      : '';
    el.quakeCard.innerHTML = `
      <button class="qc-close" aria-label="Cerrar">×</button>
      <div class="qc-pick-title">Sismos cerca del punto tocado</div>
      ${rows}${extra}`;
    el.quakeCard.classList.remove('hidden');
    el.quakeCard.querySelector('.qc-close').addEventListener('click', () => {
      el.quakeCard.classList.add('hidden');
    });
    el.quakeCard.querySelectorAll('.qc-pick').forEach((btn) => {
      btn.addEventListener('click', () => showQuakeCard(shown[Number(btn.dataset.i)]));
    });
  }

  // ---------- Globe ----------

  // Touch devices have no hover: the tap already opens the bottom card, so
  // the hover tooltip would duplicate it.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;

  // Low-power tuning for phones/tablets: fewer cylinder segments, no bump
  // map and a capped pixel ratio are imperceptible at handset sizes but cut
  // GPU work drastically on older devices.
  const lowPower = isTouch || window.matchMedia('(max-width: 820px)').matches;

  const globe = Globe()(el.globe)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-dark.jpg')
    .bumpImageUrl(lowPower ? null : 'https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl(lowPower ? null : 'https://unpkg.com/three-globe/example/img/night-sky.png')
    .atmosphereColor('#3a6ea5')
    .atmosphereAltitude(0.18)
    .ringLat('lat')
    .ringLng('lon')
    .ringColor((ring) => (t) => {
      const [r, g, b] = ring.rgb;
      return `rgba(${r},${g},${b},${(1 - t).toFixed(2)})`;
    })
    .ringMaxRadius((ring) => 1.5 + ring.mag * 0.6)
    .ringPropagationSpeed(1.6)
    .ringRepeatPeriod(1100);

  // Quake markers: flat circles on the surface in both modes.
  // - Desktop: labels layer (empty-text flat dot) with per-quake hover/click.
  // - Touch: 500+ individual meshes stutter on old phones, so all quakes merge
  //   into a single mesh (one draw call) and taps resolve to the nearest quake
  //   via onGlobeClick, since the merged mesh has no per-point events.
  if (isTouch) {
    globe
      .pointLat('lat')
      .pointLng('lon')
      .pointColor(pointColor)
      .pointAltitude(() => 0.0015 * zoomScale)
      .pointRadius(pointRadius)
      .pointsMerge(true)
      .pointResolution(6)
      .pointsTransitionDuration(0);

    // Taps are detected manually (pointer down/up with little movement) and
    // converted to globe coordinates with toGlobeCoords, so selection works
    // no matter which layer catches the raycast.
    let downX = 0;
    let downY = 0;
    let downAt = 0;
    let multiTouch = false;
    let activePointers = 0;
    el.globe.addEventListener('pointerdown', (e) => {
      activePointers += 1;
      if (activePointers > 1) {
        multiTouch = true; // pinch in progress — not a tap
        return;
      }
      multiTouch = false;
      downX = e.clientX;
      downY = e.clientY;
      downAt = Date.now();
    });
    el.globe.addEventListener('pointerup', (e) => {
      activePointers = Math.max(0, activePointers - 1);
      if (multiTouch || activePointers > 0) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 8 || Date.now() - downAt > 600) return; // drag, not a tap
      const rect = el.globe.getBoundingClientRect();
      const coords = globe.toGlobeCoords(e.clientX - rect.left, e.clientY - rect.top);
      if (!coords) return; // tapped outer space
      const near = quakesNear(coords.lat, coords.lng);
      if (near.length === 1) showQuakeCard(near[0]);
      else if (near.length > 1) showQuakePicker(near);
    });
  } else {
    globe
      .labelLat('lat')
      .labelLng('lon')
      .labelText(() => '')
      .labelColor(pointColor)
      .labelDotRadius(pointRadius)
      .labelAltitude(0.008)
      .labelsTransitionDuration(0)
      .labelLabel((q) => `<div class="globe-tooltip">${quakeCardHtml(q)}</div>`)
      .onLabelClick((q) => showQuakeCard(q));
  }

  // Political borders — countries AND admin-1 states/provinces — as native GL
  // vector lines. A texture bake was tried first but blurs/fattens on deep
  // zoom (texture magnification, inherent); GL lines keep a constant ~1px
  // on-screen width at every zoom. Perf stays flat because each set is ONE
  // merged THREE.LineSegments (two draw calls total) — never one mesh per
  // feature. GL ignores lineWidth > 1, so the country > province hierarchy
  // comes from opacity. The globe mesh is static in globe.gl (the camera
  // orbits), so scene-space objects stay glued to the surface. Each data set
  // fails independently; if THREE itself cannot load, lines are skipped.
  (function buildBorderLines() {
    const fetchJson = (url) =>
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });

    Promise.all([
      // Dynamic import instead of a <script type=module> global: no load-order
      // race, and a failed CDN load rejects right here into the catch below.
      // Pinned near globe.gl@2's bundled three so cross-instance objects
      // (BufferGeometry/LineSegments, whose structure is stable) remain
      // compatible with globe.gl's renderer.
      import('https://unpkg.com/three@0.180.0/build/three.module.js'),
      Promise.allSettled([
        fetchJson('admin1-lines.json'),
        fetchJson('https://unpkg.com/world-atlas@2.0.2/countries-110m.json')
      ])
    ])
      .then(([THREE, [admin1Res, countriesRes]]) => {
        const u = window.BorderUtils;
        if (!u || !window.topojson) throw new Error('border helpers unavailable');

        // MultiLineString coordinates per set; a failed fetch just skips its set.
        const admin1Lines =
          admin1Res.status === 'fulfilled'
            ? window.topojson.feature(admin1Res.value, admin1Res.value.objects.admin1)
                .features[0].geometry.coordinates
            : null;
        // mesh() dedupes shared borders into a single MultiLineString.
        const countryLines =
          countriesRes.status === 'fulfilled'
            ? window.topojson.mesh(countriesRes.value, countriesRes.value.objects.countries)
                .coordinates
            : null;
        if (admin1Res.status === 'rejected') console.warn('Admin-1 boundaries unavailable:', admin1Res.reason);
        if (countriesRes.status === 'rejected') console.warn('Country borders unavailable:', countriesRes.reason);

        // One merged LineSegments per set: every polyline expands into
        // independent segment pairs sharing a single position buffer.
        // Altitudes sit above the surface but below the quake dots (0.008);
        // globe.getCoords does the lat/lon/alt -> scene xyz conversion.
        const addLineSet = (lines, altitude, opacity) => {
          const positions = [];
          for (const line of lines) {
            const vertices = line.map(([lon, lat]) => {
              const { x, y, z } = globe.getCoords(lat, lon, altitude);
              return [x, y, z];
            });
            for (const v of u.polylineToSegmentPairs(vertices)) {
              positions.push(v[0], v[1], v[2]);
            }
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          const material = new THREE.LineBasicMaterial({
            color: 0xbecde1,
            transparent: true,
            opacity
          });
          globe.scene().add(new THREE.LineSegments(geometry, material));
          return positions.length / 3;
        };

        const admin1Vertices = admin1Lines ? addLineSet(admin1Lines, 0.002, 0.3) : 0;
        const countryVertices = countryLines ? addLineSet(countryLines, 0.003, 0.75) : 0;
        // In-page instrumentation so border construction can be verified.
        window.__bordersDebug = { admin1Vertices, countryVertices };
      })
      .catch((err) => {
        console.warn('Vector borders unavailable:', err);
      });
  })();

  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.6;
  el.globe.addEventListener('pointerdown', () => {
    globe.controls().autoRotate = false;
  }, { once: true });

  function sizeGlobe() {
    globe.width(window.innerWidth).height(window.innerHeight);
  }
  window.addEventListener('resize', sizeGlobe);
  sizeGlobe();

  // Re-size points on zoom. onZoom also fires while rotating, so only rebuild
  // the (debounced) layer when the altitude-derived scale actually changes.
  let zoomTimer;
  globe.onZoom(({ altitude }) => {
    const next = Math.min(1, Math.max(0.12, altitude / 2.5));
    if (Math.abs(next - zoomScale) / zoomScale < 0.08) return;
    zoomScale = next;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      if (isTouch) {
        globe.pointRadius((q) => pointRadius(q));
        globe.pointAltitude(() => 0.0015 * zoomScale);
      } else {
        globe.labelDotRadius((q) => pointRadius(q));
      }
    }, lowPower ? 150 : 60);
  });

  // Cap the device pixel ratio: retina phones otherwise render ~4x the pixels
  // the eye can resolve at handset size — the single biggest cost on old GPUs.
  globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 2));

  // Don't burn GPU/battery while the tab is in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) globe.pauseAnimation();
    else globe.resumeAnimation();
  });

  // ---------- Filtering & rendering ----------

  function matchesFilters(q, { applyWindow = true } = {}) {
    const f = state.filters;
    if (q.magnitude < f.minMag) return false;
    if (applyWindow) {
      const age = Date.now() - Date.parse(q.time);
      if (age > f.windowHours * 3600 * 1000) return false;
    }
    if (f.continent && q.continent !== f.continent) return false;
    if (f.text) {
      const hay = `${q.place || ''} ${q.country || ''}`.toLowerCase();
      if (!hay.includes(f.text)) return false;
    }
    return true;
  }

  function render() {
    const visible = state.quakes.filter((q) => matchesFilters(q));

    // Damaging quakes: year-wide layer, so the recency filter does not apply.
    let damagingVisible = [];
    if (state.filters.showDamaging) {
      damagingVisible = state.damaging.filter((q) => matchesFilters(q, { applyWindow: false }));
    }
    const damagingIds = new Set(damagingVisible.map((q) => q.id));
    const base = visible.filter((q) => !damagingIds.has(q.id));

    renderedMarkers = [...base, ...damagingVisible];
    if (isTouch) {
      globe.pointsData(renderedMarkers);
    } else {
      globe.labelsData(renderedMarkers);
    }

    // Propagating rings drawn on the sphere itself (exact position at any
    // zoom): last-hour quakes colored by magnitude, damaging quakes magenta.
    const lastHour = base.filter((q) => Date.now() - Date.parse(q.time) <= RECENT_MS);
    globe.ringsData([
      ...lastHour.map((q) => ({ lat: q.lat, lon: q.lon, mag: q.magnitude, rgb: magRgb(q.magnitude, false) })),
      ...damagingVisible.map((q) => ({ lat: q.lat, lon: q.lon, mag: q.magnitude, rgb: COLORS.magenta }))
    ]);

    const total = state.quakes.length + (state.filters.showDamaging ? state.damaging.length : 0);
    const shown = base.length + damagingVisible.length;
    el.counter.innerHTML = `<strong>${shown}</strong> sismos visibles / ${total} totales`;
  }

  // ---------- Data loading ----------

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ---------- New-quake detection (near-real-time) ----------

  const knownIds = new Set();
  let toastTimer;

  function notifyNewQuakes(fresh) {
    const strongest = fresh.reduce((a, b) => (b.magnitude > a.magnitude ? b : a));
    el.toast.innerHTML = fresh.length === 1
      ? `⚡ Nuevo sismo: <b>M ${strongest.magnitude.toFixed(1)}</b> · ${escapeHtml(strongest.place || '')}`
      : `⚡ <b>${fresh.length}</b> sismos nuevos · mayor: M ${strongest.magnitude.toFixed(1)}`;
    el.toast.classList.remove('hidden');
    el.toast.onclick = () => {
      globe.pointOfView({ lat: strongest.lat, lng: strongest.lon, altitude: 1.6 }, 1200);
      showQuakeCard(strongest);
      el.toast.classList.add('hidden');
    };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 15000);
  }

  async function loadQuakes({ initial = false } = {}) {
    el.refreshBtn.disabled = true;
    if (initial) el.loading.classList.remove('hidden');
    try {
      const data = await fetchJson('/api/quakes');
      state.quakes = data.quakes || [];
      state.updatedAt = Date.now();
      el.errorBox.classList.add('hidden');

      const fresh = state.quakes.filter((q) => !knownIds.has(q.id));
      const firstLoad = knownIds.size === 0;
      state.quakes.forEach((q) => knownIds.add(q.id));
      if (!firstLoad && fresh.length > 0) notifyNewQuakes(fresh);

      render();
      renderUpdated();
    } catch (err) {
      console.error('Failed to load quakes:', err);
      if (state.quakes.length === 0) {
        el.errorBox.classList.remove('hidden');
      }
    } finally {
      el.loading.classList.add('hidden');
      el.refreshBtn.disabled = false;
    }
  }

  async function loadDamaging() {
    try {
      const data = await fetchJson('/api/damaging');
      state.damaging = (data.quakes || []).map((q) => ({ ...q, damaging: true }));
      state.damagingLoaded = true;
      render();
    } catch (err) {
      console.error('Failed to load damaging quakes:', err);
    }
  }

  function renderUpdated() {
    if (!state.updatedAt) return;
    const min = Math.round((Date.now() - state.updatedAt) / 60000);
    el.updated.textContent = min < 1 ? 'Actualizado hace instantes' : `Actualizado hace ${min} min`;
  }

  // ---------- Events ----------

  el.magSlider.addEventListener('input', () => {
    state.filters.minMag = Number(el.magSlider.value);
    el.magValue.textContent = state.filters.minMag.toFixed(1);
    render();
  });

  el.windowSelect.addEventListener('change', () => {
    state.filters.windowHours = Number(el.windowSelect.value);
    render();
  });

  el.continentSelect.addEventListener('change', () => {
    state.filters.continent = el.continentSelect.value;
    render();
  });

  let textDebounce;
  el.placeInput.addEventListener('input', () => {
    clearTimeout(textDebounce);
    textDebounce = setTimeout(() => {
      state.filters.text = el.placeInput.value.trim().toLowerCase();
      render();
    }, 200);
  });

  el.damagingToggle.addEventListener('change', () => {
    state.filters.showDamaging = el.damagingToggle.checked;
    if (state.filters.showDamaging && !state.damagingLoaded) {
      loadDamaging();
    }
    render();
  });

  el.refreshBtn.addEventListener('click', () => {
    loadQuakes();
    if (state.filters.showDamaging) loadDamaging();
  });
  el.retryBtn.addEventListener('click', () => loadQuakes({ initial: true }));

  el.panelToggle.addEventListener('click', () => {
    el.panel.classList.toggle('open');
  });

  // ---------- Mochila de Emergencia lead form ----------
  // Our own modal; /api/mochila validates and forwards to a Google Form
  // server-side, so the destination is never exposed to the visitor.

  // Client-side mirror of the server rules (lib/mochila.js is authoritative).
  const MOCHILA_MESSAGES = {
    required: 'Este campo es obligatorio.',
    invalid_email: 'Ingresá un email válido.',
    invalid_age: 'Ingresá una edad entre 1 y 120.',
    invalid_phone: 'Ingresá un teléfono válido (al menos 6 dígitos).',
    invalid_dni: 'Ingresá un D.N.I. válido (6 a 10 dígitos).'
  };

  function mochilaFieldError(name, value) {
    if (!value) return 'required';
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'invalid_email';
    if (name === 'edad') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 120) return 'invalid_age';
    }
    if (name === 'telefono' && value.replace(/\D/g, '').length < 6) return 'invalid_phone';
    if (name === 'dni') {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 10) return 'invalid_dni';
    }
    return null;
  }

  function setFieldError(input, code) {
    const field = input.closest('.field');
    if (!field) return;
    const msg = field.querySelector('.field-error');
    if (code) {
      field.classList.add('invalid');
      msg.textContent = MOCHILA_MESSAGES[code] || 'Revisá este campo.';
      msg.classList.remove('hidden');
    } else {
      field.classList.remove('invalid');
      msg.textContent = '';
      msg.classList.add('hidden');
    }
  }

  function openMochila() {
    el.mochilaForm.classList.remove('hidden');
    el.mochilaSuccess.classList.add('hidden');
    el.mochilaError.classList.add('hidden');
    el.mochilaModal.classList.remove('hidden');
    const first = el.mochilaForm.querySelector('input[name="nombre"]');
    if (first) first.focus();
  }

  function closeMochila() {
    el.mochilaModal.classList.add('hidden');
  }

  el.mochilaBtn.addEventListener('click', openMochila);
  el.mochilaClose.addEventListener('click', closeMochila);
  $('mochilaCancel').addEventListener('click', closeMochila);

  // Reference infographic: src is only set the first time the visitor asks
  // for it — form-only visits never download the image.
  const infoToggle = $('mochilaInfoToggle');
  const infoImg = $('mochilaInfoImg');
  if (infoToggle && infoImg) {
    infoToggle.addEventListener('click', () => {
      if (!infoImg.getAttribute('src')) infoImg.src = 'mochila.jpg';
      const nowHidden = infoImg.classList.toggle('hidden');
      infoToggle.textContent = nowHidden ? 'Ver qué incluye la mochila ▾' : 'Ocultar el contenido ▴';
    });
  }
  el.mochilaModal.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close')) closeMochila();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.mochilaModal.classList.contains('hidden')) closeMochila();
  });

  el.mochilaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.mochilaError.classList.add('hidden');

    const payload = {};
    let firstInvalid = null;
    for (const control of el.mochilaForm.querySelectorAll('input[name], select[name]')) {
      const name = control.name;
      const value = control.value.trim();
      payload[name] = value;
      if (name === 'website') continue; // honeypot travels as-is
      const code = mochilaFieldError(name, value);
      setFieldError(control, code);
      if (code && !firstInvalid) firstInvalid = control;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    el.mochilaSubmit.disabled = true;
    el.mochilaSubmit.textContent = 'Enviando…';
    try {
      const res = await fetch('/api/mochila', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        el.mochilaForm.classList.add('hidden');
        el.mochilaSuccess.classList.remove('hidden');
        el.mochilaForm.reset();
        setTimeout(closeMochila, 3000);
      } else if (res.status === 503 && data.error === 'not_configured') {
        el.mochilaError.textContent = 'El formulario estará disponible muy pronto.';
        el.mochilaError.classList.remove('hidden');
      } else if (res.status === 400 && data.field) {
        const control = el.mochilaForm.querySelector(`[name="${data.field}"]`);
        if (control) {
          setFieldError(control, data.error);
          control.focus();
        }
        el.mochilaError.textContent = 'Revisá los datos marcados e intentá de nuevo.';
        el.mochilaError.classList.remove('hidden');
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('Mochila form submit failed:', err);
      el.mochilaError.textContent = 'No pudimos enviar el formulario. Intentá de nuevo en unos minutos.';
      el.mochilaError.classList.remove('hidden');
    } finally {
      el.mochilaSubmit.disabled = false;
      el.mochilaSubmit.textContent = 'Enviar';
    }
  });

  // Mobile bottom sheet: dragging the handle downward dismisses the panel.
  // The panel follows the finger; releasing past the threshold closes it,
  // otherwise it snaps back.
  const panelHandle = $('panelHandle');
  if (panelHandle) {
    // Set imperatively so the gesture never depends on media-query timing.
    panelHandle.style.touchAction = 'none';

    let dragStartY = null;
    let lastY = 0;
    let dragStartTime = 0;
    let dragEngaged = false; // true once the gesture is claimed as a dismiss

    // Controls keep their own gestures; everything else on the panel drags.
    const isInteractive = (t) =>
      Boolean(t.closest && t.closest('input, select, button, a, textarea'));

    const cleanupDrag = () => {
      dragStartY = null;
      dragEngaged = false;
      window.removeEventListener('pointermove', onPanelDragMove);
      window.removeEventListener('pointerup', onPanelDragEnd);
      window.removeEventListener('pointercancel', onPanelDragEnd);
    };

    // Move/up tracked on window: even if pointer capture fails or the browser
    // hesitates on the first gesture, the drag keeps receiving events.
    const onPanelDragMove = (e) => {
      if (dragStartY == null) return;
      lastY = e.clientY;
      const dy = e.clientY - dragStartY;
      if (!dragEngaged) {
        // Claim the gesture only when pulling DOWN with the sheet scrolled to
        // its top; otherwise abandon and let native panel scrolling happen.
        if (dy > 8 && el.panel.scrollTop <= 0) {
          dragEngaged = true;
          el.panel.style.transition = 'none';
        } else if (dy < -8 || el.panel.scrollTop > 0) {
          cleanupDrag();
          return;
        } else {
          return;
        }
      }
      el.panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
      e.preventDefault();
    };
    const onPanelDragEnd = (e) => {
      if (dragStartY == null) return;
      // pointercancel may carry no coordinates — fall back to the last move.
      const endY = typeof e.clientY === 'number' && e.clientY !== 0 ? e.clientY : lastY;
      const dy = endY - dragStartY;
      const velocity = dy / Math.max(1, Date.now() - dragStartTime); // px/ms
      const engaged = dragEngaged;
      cleanupDrag();
      el.panel.style.transition = '';
      el.panel.style.transform = '';
      // Distance OR a quick downward flick dismisses.
      if (engaged && (dy > 50 || (dy > 15 && velocity > 0.5))) {
        el.panel.classList.remove('open');
      }
    };

    const beginPanelDrag = (e, fromHandle) => {
      dragStartY = e.clientY;
      lastY = e.clientY;
      dragStartTime = Date.now();
      dragEngaged = fromHandle; // the handle claims the gesture immediately
      if (fromHandle) el.panel.style.transition = 'none';
      window.addEventListener('pointermove', onPanelDragMove, { passive: false });
      window.addEventListener('pointerup', onPanelDragEnd);
      window.addEventListener('pointercancel', onPanelDragEnd);
    };

    panelHandle.addEventListener('pointerdown', (e) => {
      try {
        panelHandle.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no active pointer — window listeners cover it.
      }
      beginPanelDrag(e, true);
      // Claim the gesture before the browser decides it is a scroll.
      e.preventDefault();
    });

    // The WHOLE panel is a drag surface: any spot that is not a form control
    // can start the swipe (it only engages on a downward pull from the top).
    el.panel.addEventListener('pointerdown', (e) => {
      if (panelHandle.contains(e.target) || isInteractive(e.target)) return;
      beginPanelDrag(e, false);
    });

    // Native scrolling is driven by touch events; once the dismiss gesture is
    // engaged this non-passive guard stops the panel from scrolling under it.
    el.panel.addEventListener(
      'touchmove',
      (e) => {
        if (dragEngaged) e.preventDefault();
      },
      { passive: false }
    );
  }

  // ---------- Boot ----------

  loadQuakes({ initial: true });
  setInterval(() => {
    loadQuakes();
    if (state.filters.showDamaging) loadDamaging();
  }, REFRESH_MS);
  setInterval(() => {
    renderUpdated();
    render(); // keeps recency fading/rings honest over time
  }, TICK_MS);
})();
