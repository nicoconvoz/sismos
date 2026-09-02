// Perioteca frontend: 3D globe of ongoing world events.
// Vanilla JS + globe.gl (CDN), loaded as a module so it runs after i18n.js
// and borders.js have populated window.I18n / window.BorderUtils. Data comes
// exclusively from /api/events — the browser never talks to the feeds.

(function () {
  'use strict';

  var API_URL = '/api/events';
  // Near-real-time: the API caches upstream for ~5 min, but polling every
  // minute picks a fresh payload up as soon as the cache rolls over.
  var REFRESH_MS = 60 * 1000;
  var ALERT_HIDE_MS = 15 * 1000;

  var I18n = window.I18n;
  // Viewer language: ?lang= override first (shareable/testable), then the
  // browser's own preference list.
  var LANG = new URLSearchParams(location.search).get('lang');
  LANG = I18n.pickLang(LANG ? [LANG] : navigator.languages || [navigator.language]);
  document.documentElement.lang = LANG;

  var TIER_COLORS = {
    'pequeño': '#3fd08a',
    'mediano': '#ffd166',
    'grande': '#ff8c42',
    'gigante': '#ff4d5e'
  };

  var SOURCE_LABELS = {
    gdacs: 'GDACS',
    eonet: 'NASA EONET',
    usgs: 'USGS',
    emsc: 'EMSC',
    inpres: 'INPRES',
    csn: 'CSN Chile',
    nhc: 'NOAA NHC',
    smn: 'SMN Argentina',
    meteoalarm: 'MeteoAlarm',
    swic: 'WMO',
    firms: 'NASA FIRMS'
  };

  // Every source citation links to the original site — credit where due.
  var SOURCE_URLS = {
    gdacs: 'https://www.gdacs.org',
    eonet: 'https://eonet.gsfc.nasa.gov',
    usgs: 'https://earthquake.usgs.gov',
    emsc: 'https://www.emsc-csem.org',
    inpres: 'https://www.inpres.gob.ar',
    csn: 'https://www.sismologia.cl',
    nhc: 'https://www.nhc.noaa.gov',
    smn: 'https://www.smn.gob.ar',
    meteoalarm: 'https://meteoalarm.org',
    swic: 'https://severeweather.wmo.int',
    firms: 'https://firms.modaps.eosdis.nasa.gov'
  };

  function sourceLink(s, className) {
    var label = SOURCE_LABELS[s] || s;
    var url = SOURCE_URLS[s];
    if (!url) return '<span class="' + (className || 'source-link') + '">' + escapeHtml(label) + '</span>';
    return '<a class="' + (className || 'source-link') + '" href="' + url +
      '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>';
  }

  function $(id) { return document.getElementById(id); }

  var els = {
    globe: $('globe'),
    loading: $('loading'),
    errorBox: $('errorBox'),
    retryBtn: $('retryBtn'),
    refreshBtn: $('refreshBtn'),
    panel: $('panel'),
    panelToggle: $('panelToggle'),
    counter: $('counter'),
    updated: $('updated'),
    magSlider: $('magSlider'),
    magValue: $('magValue'),
    kindSelect: $('kindSelect'),
    windowSelect: $('windowSelect'),
    continentSelect: $('continentSelect'),
    placeInput: $('placeInput'),
    alertToggle: $('alertToggle'),
    card: $('eventCard'),
    toast: $('toast'),
    alertToast: $('alertToast'),
    sourcesNote: $('sourcesNote')
  };

  var allEvents = [];
  var knownIds = null; // null until the first successful load
  var globe = null;
  var refreshTimer = null;
  var lastLoadAt = 0;
  var alertTimer = null;

  // ---------- Static UI translation ----------

  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = I18n.t(node.getAttribute('data-i18n'), LANG);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (node) {
      node.placeholder = I18n.t(node.getAttribute('data-i18n-ph'), LANG);
    });
    // Continent options: values stay in Spanish (they match the data),
    // display text localizes.
    Array.prototype.forEach.call(els.continentSelect.options, function (opt) {
      if (opt.value) opt.textContent = I18n.continentName(opt.value, LANG);
    });
  }

  // ---------- Magnitude engine mirrors (kept in sync with lib/magnitude.js) ----------

  // Omori-inspired decay: sharp initial drop, long tail.
  function decayWeight(ageHours) {
    if (!isFinite(ageHours) || ageHours <= 0) return 1;
    return Math.pow(1 + ageHours / 6, -1.1);
  }

  // An official warning is ACTIVE for its whole validity window: from the
  // moment it is issued until the phenomenon ENDS — halo ring, waves and
  // full intensity persist throughout. Without an end date, only the
  // pre-start phase counts.
  function warningActive(e) {
    if (e.ends) return Date.parse(e.ends) > Date.now();
    return Boolean(e.starts) && Date.parse(e.starts) > Date.now();
  }

  // Latest-activity clock: the agency update, or the phenomenon's own start
  // once it has begun — a warning ages from its onset, not its issue time.
  function activityMs(e) {
    var t = Date.parse(e.updated || e.time);
    if (e.starts) {
      var s = Date.parse(e.starts);
      if (s <= Date.now()) t = Math.max(t, s);
    }
    return t;
  }

  function ageHours(evento) {
    if (warningActive(evento)) return 0;
    return (Date.now() - activityMs(evento)) / 3600000;
  }

  // ---------- Globe ----------

  function initGlobe() {
    // No earth texture at all: a flat dark sphere, so the map shows ONLY
    // what our system draws (borders + events). Also saves the texture
    // downloads — mobile loads matter.
    globe = Globe()(els.globe)
      .globeImageUrl(null)
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .atmosphereColor('#4ea1ff')
      .atmosphereAltitude(0.16)
      // Events use lat/lon; globe.gl defaults to lat/lng.
      .pointLat(function (d) { return d.lat; })
      .pointLng(function (d) { return d.lon; })
      .ringLat(function (d) { return d.lat; })
      .ringLng(function (d) { return d.lon; })
      // Flat circles on the surface (near-zero altitude), like the sismos
      // globe — tall cylinders read wrong at grazing angles.
      .pointAltitude(pointAltitudeOf)
      // Upcoming warnings render inverted: the RING carries the magnitude
      // color (the halo disc underneath) and the center is dark — a hollow
      // dot reads as "not happening yet".
      .pointColor(function (d) {
        if (d.__halo) return colorFor(d);
        return warningActive(d) ? 'rgba(7,10,16,0.95)' : colorFor(d);
      })
      .pointRadius(pointRadius)
      .pointsMerge(false)
      // Touch devices fire hover + click on the same tap, so the hover
      // bubble and the card would open together; keep only the card there.
      .pointLabel(isTouch() ? function () { return null; } : tooltipHtml)
      // Clicks resolve by proximity against rendered events (the original
      // sismos model). BOTH handlers are needed: a click landing exactly ON
      // a disc goes to the point object (globe.gl then skips onGlobeClick),
      // while a click on the sphere between packed circles goes to the
      // globe — either way the same proximity resolution runs.
      .onPointClick(function (d) { resolveClick(d.lat, d.lon); })
      .onGlobeClick(function (coords) {
        if (coords) resolveClick(coords.lat, coords.lng);
      })
      // Rings, like the old sismos globe: red alerts ripple in red; events
      // that entered within the last hour ripple in their tier color.
      .ringColor(function (d) {
        var rgb = d.alert === 'red' ? '255,77,94' : hexToRgb(TIER_COLORS[d.tier] || '#9aa7bb');
        return function (t) { return 'rgba(' + rgb + ',' + (1 - t) + ')'; };
      })
      .ringMaxRadius(ringMaxRadius)
      .ringPropagationSpeed(1.3)
      .ringRepeatPeriod(1400);

    // Re-size markers on zoom (ported from the sismos globe). onZoom also
    // fires while rotating, so only rebuild when the altitude-derived scale
    // actually changes (8% hysteresis), and debounce the rebuild.
    var zoomTimer;
    globe.onZoom(function (pov) {
      var next = Math.min(1, Math.max(0.12, pov.altitude / 2.3));
      if (Math.abs(next - zoomScale) / zoomScale < 0.08) return;
      zoomScale = next;
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(function () {
        globe.pointRadius(pointRadius);
        globe.pointAltitude(pointAltitudeOf);
        globe.ringMaxRadius(ringMaxRadius);
      }, 150);
    });

    // Flat deep-blue material replaces the removed texture.
    var globeMat = globe.globeMaterial();
    globeMat.color.set('#0c1626');
    if (globeMat.emissive) globeMat.emissive.set('#04080f');
    globeMat.shininess = 0.2;

    globe.pointOfView({ lat: 10, lng: -30, altitude: 2.3 });
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.35;
    els.globe.addEventListener('pointerdown', function () {
      globe.controls().autoRotate = false;
    }, { once: true });

    applyViewOffset();
    window.addEventListener('resize', function () {
      globe.width(window.innerWidth).height(window.innerHeight);
      applyViewOffset();
    });
  }

  // The canvas spans the whole viewport (so the starfield is alive
  // everywhere), but the globe should center in the free band between the
  // top bar and the bottom UI (toast + sponsor). Shifting the camera's view
  // offset moves the render center without shrinking the canvas.
  function applyViewOffset() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var mobile = W < 640;
    var chromeTop = mobile ? 150 : 52;
    var chromeBottom = mobile ? 140 : 148;
    // Positive y renders the scene higher: the center lands at the middle
    // of the free band instead of the middle of the viewport.
    var y = (chromeBottom - chromeTop) / 2;
    globe.camera().setViewOffset(W, H, 0, y, W, H);

    buildBorderLines();
  }

  // Political borders — countries AND admin-1 states/provinces — as native GL
  // vector lines over the existing globe texture. Ported from the sismos
  // reference: each set is ONE merged THREE.LineSegments (two draw calls
  // total); GL ignores lineWidth > 1, so the country > province hierarchy
  // comes from opacity. Altitudes sit above the surface but below the event
  // dots. Each data set fails independently; if THREE cannot load, lines are
  // simply skipped.
  function buildBorderLines() {
    var fetchJson = function (url) {
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
    };

    Promise.all([
      // Pinned near globe.gl@2's bundled three so cross-instance objects
      // (BufferGeometry/LineSegments) remain compatible with its renderer.
      import('https://unpkg.com/three@0.180.0/build/three.module.js'),
      Promise.allSettled([
        fetchJson('admin1-lines.json'),
        fetchJson('https://unpkg.com/world-atlas@2.0.2/countries-110m.json')
      ])
    ])
      .then(function (loaded) {
        var THREE = loaded[0];
        var admin1Res = loaded[1][0];
        var countriesRes = loaded[1][1];
        var u = window.BorderUtils;
        if (!u || !window.topojson) throw new Error('border helpers unavailable');

        // MultiLineString coordinates per set; a failed fetch skips its set.
        var admin1Lines =
          admin1Res.status === 'fulfilled'
            ? window.topojson.feature(admin1Res.value, admin1Res.value.objects.admin1)
                .features[0].geometry.coordinates
            : null;
        // mesh() dedupes shared borders into a single MultiLineString.
        var countryLines =
          countriesRes.status === 'fulfilled'
            ? window.topojson.mesh(countriesRes.value, countriesRes.value.objects.countries)
                .coordinates
            : null;
        if (admin1Res.status === 'rejected') console.warn('Admin-1 boundaries unavailable:', admin1Res.reason);
        if (countriesRes.status === 'rejected') console.warn('Country borders unavailable:', countriesRes.reason);

        var addLineSet = function (lines, altitude, opacity) {
          var positions = [];
          lines.forEach(function (line) {
            var vertices = line.map(function (pt) {
              var c = globe.getCoords(pt[1], pt[0], altitude);
              return [c.x, c.y, c.z];
            });
            u.polylineToSegmentPairs(vertices).forEach(function (v) {
              positions.push(v[0], v[1], v[2]);
            });
          });
          var geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          var material = new THREE.LineBasicMaterial({
            color: 0xbecde1,
            transparent: true,
            opacity: opacity
          });
          globe.scene().add(new THREE.LineSegments(geometry, material));
          return positions.length / 3;
        };

        var admin1Vertices = admin1Lines ? addLineSet(admin1Lines, 0.002, 0.3) : 0;
        var countryVertices = countryLines ? addLineSet(countryLines, 0.003, 0.75) : 0;
        // In-page instrumentation so border construction can be verified.
        window.__bordersDebug = { admin1Vertices: admin1Vertices, countryVertices: countryVertices };
      })
      .catch(function (err) {
        console.warn('Vector borders unavailable:', err);
      });
  }

  // Shrinks marker radii as the camera zooms in, so clustered events separate
  // and each circle sits precisely on its coordinates: 1 at the default
  // altitude (2.3), down to ~1/8 fully zoomed in. Zooming out grows them back.
  var zoomScale = 1;

  function pointRadius(e) {
    // Generous minimum so small events remain visible on the whole globe.
    var r = Math.max(0.32, 0.22 + 0.08 * e.magnitude) * zoomScale;
    // Halo discs sit under upcoming warnings, slightly larger, so the
    // magnitude color shows ringed in white.
    return e.__halo ? r * 1.38 : r;
  }

  function pointAltitudeOf(e) {
    return (e.__halo ? 0.0008 : 0.0015) * zoomScale;
  }

  function ringMaxRadius(e) {
    return (e.alert === 'red' ? 4.5 : 1.5 + e.magnitude * 0.4) * zoomScale;
  }

  function isTouch() {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  function hexToRgb(hex) {
    return parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' +
      parseInt(hex.slice(5, 7), 16);
  }

  function colorFor(evento) {
    var base = TIER_COLORS[evento.tier] || '#9aa7bb';
    // Fade with the engine's decay curve: fresh = opaque, old = dim.
    var w = 0.25 + 0.75 * decayWeight(ageHours(evento));
    var r = parseInt(base.slice(1, 3), 16);
    var g = parseInt(base.slice(3, 5), 16);
    var b = parseInt(base.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + w.toFixed(2) + ')';
  }

  // ---------- Rendering ----------

  function titleOf(e) { return I18n.localizeTitle(e, LANG); }

  function visibleEvents() {
    var minMag = Number(els.magSlider.value);
    var kind = els.kindSelect.value;
    var hours = Number(els.windowSelect.value);
    var continent = els.continentSelect.value;
    var text = els.placeInput.value.trim().toLowerCase();
    var alertsOnly = els.alertToggle.checked;
    var minTime = Date.now() - hours * 3600000;

    return allEvents.filter(function (e) {
      if (e.magnitude < minMag) return false;
      if (kind && e.kind !== kind) return false;
      if (Date.parse(e.updated || e.time) < minTime) return false;
      if (continent && e.continent !== continent) return false;
      if (alertsOnly && e.alert !== 'orange' && e.alert !== 'red') return false;
      if (text) {
        var hay = (e.title + ' ' + titleOf(e) + ' ' + (e.country || '') + ' ' +
          I18n.kindName(e.kind, LANG)).toLowerCase();
        if (hay.indexOf(text) === -1) return false;
      }
      return true;
    });
  }

  var RECENT_RING_MS = 3600 * 1000; // activity within the last hour ripples

  // Markers currently on the globe — the swarm picker resolves clicks
  // against this list.
  var renderedEvents = [];

  function render() {
    var events = visibleEvents();
    var now = Date.now();
    renderedEvents = events;
    // Upcoming warnings (not started yet) get a white halo disc underneath:
    // magnitude color ringed in white marks "this is coming, not happening".
    var halos = events.filter(warningActive).map(function (e) {
      var h = Object.assign({}, e);
      h.__halo = true;
      return h;
    });
    globe.pointsData(halos.concat(events));
    // Any kind ripples on fresh ACTIVITY: quakes by origin time, ongoing
    // events (fires, floods, cyclones) by their latest agency update, and
    // official warnings while their phenomenon is still upcoming.
    globe.ringsData(events.filter(function (e) {
      return e.alert === 'red' || warningActive(e) || now - activityMs(e) <= RECENT_RING_MS;
    }));
    els.counter.textContent = events.length + ' ' + I18n.t('events', LANG);
    renderToast(events);
  }

  // Once tapped, the strongest-event toast stays hidden until a DIFFERENT
  // event becomes the strongest one.
  var dismissedTopId = null;

  function renderToast(events) {
    if (!events.length) { els.toast.classList.add('hidden'); return; }
    var top = events.reduce(function (a, b) { return b.magnitude > a.magnitude ? b : a; });
    if (top.id === dismissedTopId) { els.toast.classList.add('hidden'); return; }
    els.toast.textContent = '⬤ ' + I18n.t('topEvent', LANG) + ': ' + titleOf(top) +
      ' (' + top.magnitude.toFixed(1) + ')';
    els.toast.classList.remove('hidden');
    els.toast.onclick = function () {
      dismissedTopId = top.id;
      els.toast.classList.add('hidden');
      flyTo(top);
    };
  }

  function flyTo(e) {
    globe.pointOfView({ lat: e.lat, lng: e.lon, altitude: 1.4 }, 900);
    showCard(e);
  }

  // New-event alerts, like the old sismos toast but for arrivals: after every
  // refresh, events whose id was never seen before announce themselves with
  // their magnitude. Click flies to the strongest newcomer.
  function announceNew(newcomers) {
    if (!newcomers.length) return;
    var top = newcomers.reduce(function (a, b) { return b.magnitude > a.magnitude ? b : a; });
    var label = newcomers.length === 1
      ? I18n.t('newEvent', LANG) + ': ' + titleOf(top) + ' (' + I18n.t('magnitude', LANG) + ' ' + top.magnitude.toFixed(1) + ')'
      : newcomers.length + ' ' + I18n.t('newEvents', LANG) + ' · ' + titleOf(top) + ' (' + top.magnitude.toFixed(1) + ')';
    els.alertToast.textContent = '🔔 ' + label;
    els.alertToast.classList.remove('hidden');
    els.alertToast.onclick = function () {
      els.alertToast.classList.add('hidden');
      flyTo(top);
    };
    if (alertTimer) clearTimeout(alertTimer);
    alertTimer = setTimeout(function () {
      els.alertToast.classList.add('hidden');
    }, ALERT_HIDE_MS);
  }

  // ---------- Swarm picker (ported from the sismos globe) ----------
  // When a click/tap lands on a cluster of overlapping events, let the user
  // pick instead of guessing which circle was meant.

  function eventsNear(lat, lng) {
    // Tolerance shrinks proportionally with zoom, so zooming in genuinely
    // increases selection precision (degrees of arc).
    var tol = Math.max(0.15, 3.5 * zoomScale);
    var cosLat = Math.cos((lat * Math.PI) / 180);
    return renderedEvents
      .map(function (e) {
        var dLat = e.lat - lat;
        var dLon = (((e.lon - lng + 540) % 360) - 180) * cosLat;
        return { e: e, d: Math.hypot(dLat, dLon) };
      })
      .filter(function (x) { return x.d <= tol; })
      .sort(function (a, b) { return a.d - b.d; })
      .map(function (x) { return x.e; });
  }

  function resolveClick(lat, lng) {
    var near = eventsNear(lat, lng);
    if (near.length === 1) showCard(near[0]);
    else if (near.length > 1) showEventPicker(near);
  }

  function relativeTime(iso) {
    var mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
    var rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    if (Math.abs(mins) < 48 * 60) return rtf.format(Math.round(mins / 60), 'hour');
    return rtf.format(Math.round(mins / (24 * 60)), 'day');
  }

  function showEventPicker(events) {
    // Newest ACTIVITY first, matching the period filter's clock: an ongoing
    // fire that started days ago but flared today ranks (and reads) by its
    // latest update, not its start date.
    var activityOf = function (e) { return Date.parse(e.updated || e.time); };
    var shown = events.slice().sort(function (a, b) {
      return activityOf(b) - activityOf(a);
    }).slice(0, 6);
    var rows = shown.map(function (e, i) {
      return '<button class="ec-pick" data-i="' + i + '">' +
        '<span class="ec-pick-mag" style="color:' + (TIER_COLORS[e.tier] || '#9aa7bb') + '">' +
        e.magnitude.toFixed(1) + '</span>' +
        '<span class="ec-pick-place">' + escapeHtml(titleOf(e)) + '</span>' +
        '<span class="ec-pick-time">' + relativeTime(e.updated || e.time) + '</span>' +
        '</button>';
    }).join('');
    var extra = events.length > shown.length
      ? '<div class="ec-pick-more">' +
        I18n.t('pickerMore', LANG).replace('{n}', events.length - shown.length) + '</div>'
      : '';
    els.card.innerHTML =
      '<button class="ec-close" aria-label="Cerrar">×</button>' +
      '<div class="ec-pick-title">' + I18n.t('pickerTitle', LANG) + '</div>' +
      rows + extra;
    els.card.classList.remove('hidden');
    els.card.querySelector('.ec-close').onclick = function () {
      els.card.classList.add('hidden');
    };
    els.card.querySelectorAll('.ec-pick').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showCard(shown[Number(btn.getAttribute('data-i'))]);
      });
    });
  }

  function tooltipHtml(e) {
    return '<div style="font:12px system-ui;padding:6px 9px;background:rgba(10,16,28,.92);' +
      'border:1px solid rgba(120,150,200,.3);border-radius:8px;max-width:260px">' +
      '<b>' + escapeHtml(titleOf(e)) + '</b><br/>' +
      I18n.kindName(e.kind, LANG) + ' · ' + I18n.tierName(e.tier, LANG) + ' · M ' + e.magnitude.toFixed(1) +
      (e.nearData ? '<br/>' + escapeHtml(I18n.nearLabel(e.nearData, LANG)) : '') +
      '</div>';
  }

  function showCard(e) {
    var rows = [];
    rows.push('<div><strong>' + I18n.kindName(e.kind, LANG) + '</strong> · ' +
      I18n.t('magnitude', LANG) + ' <strong>' + e.magnitude.toFixed(1) + '</strong> ' +
      I18n.t('unifiedScale', LANG) + '</div>');
    if (e.severity && e.severity.text) {
      rows.push('<div>' + I18n.t('signal', LANG) + ': <strong>' + escapeHtml(e.severity.text) + '</strong></div>');
    }
    // Forecaster prose with the event-specific numbers (gust speeds and
    // direction, expected snowfall, temperatures) — SMN alerts carry it.
    if (e.details) {
      rows.push('<div class="ec-details">' + escapeHtml(e.details) + '</div>');
    }
    // Official agency zone (SMN: Cordillera/Llanura/Patagonia), with the
    // province for context — the polygon centroid can sit far from towns.
    if (e.area) {
      var zoneTxt = e.area + (e.nearData && e.nearData.admin1 ? ' — ' + e.nearData.admin1 : '');
      rows.push('<div>' + I18n.t('zone', LANG) + ': <strong>' + escapeHtml(zoneTxt) + '</strong></div>');
    }
    if (e.nearData) {
      rows.push('<div>' + I18n.t('near', LANG) + ': <strong>' +
        escapeHtml(I18n.nearLabel(e.nearData, LANG)) + '</strong></div>');
    }
    var countryDisplay = e.cc ? I18n.countryName(e.cc, LANG) : e.country;
    if (countryDisplay) {
      rows.push('<div>' + I18n.t('country', LANG) + ': <strong>' + escapeHtml(countryDisplay) + '</strong></div>');
    }
    if (e.continent) {
      rows.push('<div>' + I18n.t('continentRow', LANG) + ': ' + I18n.continentName(e.continent, LANG) + '</div>');
    }
    // Warnings show their full validity window in the viewer's own clock.
    if (e.starts && e.ends) {
      rows.push('<div>' + I18n.t('validity', LANG) + ': <strong>' +
        I18n.formatDateTime(e.starts, LANG) + ' → ' +
        I18n.formatDateTime(e.ends, LANG) + '</strong></div>');
    }
    // Dates render in the viewer's own clock (computer/phone timezone).
    rows.push('<div>' + I18n.t('start', LANG) + ': ' +
      I18n.formatDateTime(e.time, LANG, { timeZoneName: true }) + '</div>');
    if (e.updated && e.updated !== e.time) {
      rows.push('<div>' + I18n.t('updatedRow', LANG) + ': ' + I18n.formatDateTime(e.updated, LANG) + '</div>');
    }

    var badges = ['<span class="badge badge-' + e.tier + '">' + I18n.tierName(e.tier, LANG) + '</span>'];
    if (e.alert) {
      badges.push('<span class="badge badge-alert-' + e.alert + '">' + I18n.alertLabel(e.alert, LANG) + '</span>');
    }
    badges.push(sourceLink(e.source, 'badge badge-source'));

    els.card.innerHTML =
      '<button class="ec-close" aria-label="Cerrar">×</button>' +
      '<h3 class="ec-title">' + escapeHtml(titleOf(e)) + '</h3>' +
      '<div class="ec-badges">' + badges.join('') + '</div>' +
      '<div class="ec-rows">' + rows.join('') + '</div>' +
      '<button class="ec-link" id="cardNews" type="button">' + I18n.t('report', LANG) + ' ↗</button>';
    els.card.classList.remove('hidden');
    els.card.querySelector('.ec-close').onclick = function () {
      els.card.classList.add('hidden');
    };
    els.card.querySelector('#cardNews').onclick = function () { openNews(e); };
  }

  // ---------- Zone news modal ----------
  // "Ver informe completo" opens local press coverage of the event (Google
  // News RSS, proxied by /api/news in the zone's own language/edition), the
  // official agency report, and X's live comment search.

  function openNews(e) {
    var modal = $('newsModal');
    var body = $('newsBody');
    $('newsTitle').textContent = titleOf(e);

    var official = $('newsOfficial');
    if (e.url) {
      official.href = encodeURI(e.url);
      official.hidden = false;
    } else {
      official.hidden = true;
    }

    var place = (e.nearData && e.nearData.name) || e.country || '';
    var admin1 = (e.nearData && e.nearData.admin1) || '';
    var cc = e.cc || (e.nearData && e.nearData.cc) || '';

    body.innerHTML = '<div class="news-empty">' + I18n.t('loading', LANG) + '</div>';
    modal.classList.remove('hidden');

    // Point events (quakes) keep the strict cutoff: coverage from before
    // them is about something else. Official WARNINGS re-issue daily (the
    // SMN stamps a fresh sent-time every morning) and the press covers them
    // from the day-ahead announcement — so their news window opens 24 h
    // before the warning.
    var sinceIso = e.time;
    if (e.starts && e.ends) {
      var announced = Math.min(Date.parse(e.time), Date.parse(e.starts)) - 24 * 3600 * 1000;
      sinceIso = new Date(announced).toISOString();
    }

    // News in the viewer's language; the server only picks the local zone
    // edition when its press speaks that same language.
    fetch('/api/news?kind=' + encodeURIComponent(e.kind) +
      '&place=' + encodeURIComponent(place) + '&admin1=' + encodeURIComponent(admin1) +
      '&cc=' + encodeURIComponent(cc) +
      '&lang=' + encodeURIComponent(LANG) +
      '&since=' + encodeURIComponent(sinceIso) +
      '&name=' + encodeURIComponent(e.eventName || ''))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data.items || !data.items.length) {
          body.innerHTML = '<div class="news-empty">' + I18n.t('noNews', LANG) + '</div>';
          return;
        }
        body.innerHTML = data.items.map(function (it, i) {
          return '<div class="news-item">' +
            '<a href="' + encodeURI(it.link) + '" data-idx="' + i + '">' +
            escapeHtml(it.title) + '</a>' +
            '<span class="news-meta">' + (it.source ? escapeHtml(it.source) + ' · ' : '') +
            I18n.formatDateTime(it.pubDate, LANG) + '</span></div>';
        }).join('');
        // Articles open inside the app's reader modal, never a new tab.
        body.querySelectorAll('a[data-idx]').forEach(function (a) {
          a.addEventListener('click', function (ev) {
            ev.preventDefault();
            openArticle(data.items[Number(a.getAttribute('data-idx'))]);
          });
        });
      })
      .catch(function () {
        body.innerHTML = '<div class="news-empty">' + I18n.t('noNews', LANG) + '</div>';
      });
  }

  // ---------- Article reader modal ----------
  // Bing items link straight to the publisher, so the article loads in an
  // in-app iframe. Outlets that forbid embedding (X-Frame-Options) leave the
  // frame blank; the always-visible "open on the site" button covers those.

  function openArticle(item) {
    var frame = $('articleFrame');
    var fallback = $('articleFallback');
    $('articleTitle').textContent = item.title;
    $('articleOpen').href = encodeURI(item.link);
    $('articleFallbackOpen').href = encodeURI(item.link);
    fallback.classList.add('hidden');
    frame.classList.remove('hidden');
    frame.src = 'about:blank';
    $('articleModal').classList.remove('hidden');

    // Ask the server whether the outlet allows iframes (it reads the
    // X-Frame-Options / frame-ancestors headers); blocked outlets get a
    // clean fallback instead of the browser's raw connection error.
    fetch('/api/embed?url=' + encodeURIComponent(item.link))
      .then(function (res) { return res.json(); })
      .then(function (data) { return data.embeddable !== false; })
      .catch(function () { return true; })
      .then(function (embeddable) {
        // Ignore stale probes if the user already closed or switched.
        if ($('articleModal').classList.contains('hidden')) return;
        if ($('articleOpen').href !== encodeURI(item.link)) return;
        if (embeddable) {
          frame.src = encodeURI(item.link);
        } else {
          frame.classList.add('hidden');
          $('articleFallbackText').textContent =
            (item.source ? item.source + ' ' : '') + I18n.t('notEmbeddable', LANG);
          fallback.classList.remove('hidden');
        }
      });
  }

  function closeArticle() {
    $('articleModal').classList.add('hidden');
    // Unload the page so background audio/video stops.
    $('articleFrame').src = 'about:blank';
  }

  function wireArticleModal() {
    $('articleClose').addEventListener('click', closeArticle);
    $('articleModal').addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeArticle();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('articleModal').classList.contains('hidden')) closeArticle();
    });
  }

  function wireNewsModal() {
    var modal = $('newsModal');
    $('newsClose').addEventListener('click', function () { modal.classList.add('hidden'); });
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) modal.classList.add('hidden');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function populateKinds() {
    var kinds = {};
    allEvents.forEach(function (e) { kinds[e.kind] = true; });
    var current = els.kindSelect.value;
    els.kindSelect.innerHTML = '<option value="">' + I18n.t('all', LANG) + '</option>' +
      Object.keys(kinds).sort(function (a, b) {
        return I18n.kindName(a, LANG).localeCompare(I18n.kindName(b, LANG), LANG);
      }).map(function (k) {
        return '<option value="' + k + '">' + I18n.kindName(k, LANG) + '</option>';
      }).join('');
    els.kindSelect.value = kinds[current] ? current : '';
  }

  // ---------- Data ----------
  // The three source groups load IN PARALLEL and each paints as soon as it
  // lands (progressive rendering: the globe is visible from second zero and
  // points pop in). The refresh button doubles as a status light: pulsing
  // yellow while loading, steady green when every group settled.

  var GROUPS = ['alerts', 'quakes', 'nature'];
  var GROUP_EQ_MERGE = { maxDtMs: 90 * 1000, maxKm: 150 };
  var groupData = { alerts: null, quakes: null, nature: null };
  var pendingGroups = 0;

  function setBtnState(state) {
    var loading = state === 'loading';
    els.refreshBtn.classList.toggle('btn-loading', loading);
    els.refreshBtn.classList.toggle('btn-ready', state === 'ready');
    // While loading the button is a status light, not a control: it says
    // "Actualizando" and cannot be pressed; green restores "Actualizar".
    els.refreshBtn.disabled = loading;
    els.refreshBtn.textContent = I18n.t(loading ? 'refreshing' : 'refresh', LANG);
  }

  // Same cross-group dedupe the server applies for the `all` shape.
  function recompose() {
    var M = window.EventMerge;
    var alerts = (groupData.alerts && groupData.alerts.events) || [];
    var quakes = (groupData.quakes && groupData.quakes.events) || [];
    var nature = (groupData.nature && groupData.nature.events) || [];
    var merged = M.mergeEvents(alerts, quakes, GROUP_EQ_MERGE);
    allEvents = M.mergeEvents(merged, nature);

    populateKinds();
    var counts = {};
    GROUPS.forEach(function (g) {
      var p = groupData[g];
      if (p && p.sourceCounts) {
        Object.keys(p.sourceCounts).forEach(function (s) {
          counts[s] = (counts[s] || 0) + p.sourceCounts[s];
        });
      }
    });
    els.sourcesNote.innerHTML = Object.keys(counts).map(function (s) {
      return sourceLink(s) + ': ' + counts[s];
    }).join(' · ') + ' — ' + escapeHtml(I18n.t('merged', LANG));
    render();
  }

  function finishCycle() {
    setBtnState('ready');
    els.updated.textContent = I18n.t('updated', LANG) + ' ' +
      I18n.formatDateTime(new Date().toISOString(), LANG);
    if (!allEvents.length) {
      els.errorBox.classList.remove('hidden');
      return;
    }
    els.errorBox.classList.add('hidden');
    // Announce arrivals only after the baseline cycle, so the first load
    // does not fire a thousand alerts.
    if (knownIds) {
      var newcomers = allEvents.filter(function (e) { return !knownIds.has(e.id); });
      if (newcomers.length) announceNew(newcomers);
    }
    knownIds = new Set(allEvents.map(function (e) { return e.id; }));
  }

  function load() {
    lastLoadAt = Date.now();
    setBtnState('loading');
    pendingGroups = GROUPS.length;
    GROUPS.forEach(function (g) {
      fetch(API_URL + '?group=' + g)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          groupData[g] = data;
          recompose();
        })
        .catch(function () {
          // Keep the group's previous data; the cycle still completes.
        })
        .then(function () {
          pendingGroups--;
          if (!pendingGroups) finishCycle();
        });
    });
  }

  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(load, REFRESH_MS);
  }

  // ---------- Mochila de Emergencia lead form ----------
  // Ported from the sismos reference: our own modal; /api/mochila validates
  // and forwards to a Google Form server-side, so the destination is never
  // exposed to the visitor.

  // Client-side mirror of the server rules (lib/mochila.js is authoritative).
  var MOCHILA_MESSAGES = {
    required: 'Este campo es obligatorio.',
    invalid_email: 'Ingresá un email válido.',
    invalid_phone: 'Ingresá un teléfono válido (al menos 6 dígitos).'
  };

  function mochilaFieldError(name, value) {
    if (!value) return 'required';
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'invalid_email';
    if (name === 'telefono' && value.replace(/\D/g, '').length < 6) return 'invalid_phone';
    return null;
  }

  function setFieldError(input, code) {
    var field = input.closest('.field');
    if (!field) return;
    var msg = field.querySelector('.field-error');
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

  function wireMochila() {
    var modal = $('mochilaModal');
    var form = $('mochilaForm');
    var successBox = $('mochilaSuccess');
    var errorBox = $('mochilaError');
    var submitBtn = $('mochilaSubmit');

    function openMochila() {
      form.classList.remove('hidden');
      successBox.classList.add('hidden');
      errorBox.classList.add('hidden');
      modal.classList.remove('hidden');
      var first = form.querySelector('input[name="nombre"]');
      if (first) first.focus();
    }

    function closeMochila() { modal.classList.add('hidden'); }

    $('mochilaBtn').addEventListener('click', openMochila);
    $('mochilaClose').addEventListener('click', closeMochila);
    $('mochilaCancel').addEventListener('click', closeMochila);

    // Reference infographic: src is only set the first time the visitor asks
    // for it — form-only visits never download the image.
    var infoToggle = $('mochilaInfoToggle');
    var infoImg = $('mochilaInfoImg');
    infoToggle.addEventListener('click', function () {
      if (!infoImg.getAttribute('src')) infoImg.src = 'mochila-marcada.jpg';
      var nowHidden = infoImg.classList.toggle('hidden');
      infoToggle.textContent = nowHidden ? 'Ver qué incluye la mochila ▾' : 'Ocultar el contenido ▴';
    });

    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeMochila();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeMochila();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.classList.add('hidden');

      var payload = {};
      var firstInvalid = null;
      form.querySelectorAll('input[name]').forEach(function (control) {
        var name = control.name;
        if (name === 'website') {
          // Honeypot: mobile autofill fills hidden "website" fields despite
          // autocomplete="off", which once made the server silently drop REAL
          // submissions. Humans always go through this code path, so always
          // send it empty; only bots POSTing the scraped form trip it.
          payload[name] = '';
          return;
        }
        var value = control.value.trim();
        payload[name] = value;
        var code = mochilaFieldError(name, value);
        setFieldError(control, code);
        if (code && !firstInvalid) firstInvalid = control;
      });
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando…';
      fetch('/api/mochila', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok) {
              form.classList.add('hidden');
              successBox.classList.remove('hidden');
              form.reset();
              setTimeout(closeMochila, 3000);
            } else if (res.status === 503 && data.error === 'not_configured') {
              errorBox.textContent = 'El formulario estará disponible muy pronto.';
              errorBox.classList.remove('hidden');
            } else if (res.status === 400 && data.field) {
              var control = form.querySelector('[name="' + data.field + '"]');
              if (control) {
                setFieldError(control, data.error);
                control.focus();
              }
              errorBox.textContent = 'Revisá los datos marcados e intentá de nuevo.';
              errorBox.classList.remove('hidden');
            } else {
              throw new Error('HTTP ' + res.status);
            }
          });
        })
        .catch(function (err) {
          console.warn('Mochila form submit failed:', err);
          errorBox.textContent = 'No pudimos enviar el formulario. Intentá de nuevo en unos minutos.';
          errorBox.classList.remove('hidden');
        })
        .then(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar';
        });
    });
  }

  // ---------- Wiring ----------

  els.magSlider.addEventListener('input', function () {
    els.magValue.textContent = Number(els.magSlider.value).toFixed(1);
    render();
  });
  ['change', 'input'].forEach(function (evt) {
    els.kindSelect.addEventListener(evt, render);
    els.windowSelect.addEventListener(evt, render);
    els.continentSelect.addEventListener(evt, render);
    els.alertToggle.addEventListener(evt, render);
  });
  els.placeInput.addEventListener('input', render);
  els.refreshBtn.addEventListener('click', load);
  els.retryBtn.addEventListener('click', function () {
    els.errorBox.classList.add('hidden');
    load();
  });
  els.panelToggle.addEventListener('click', function () {
    els.panel.classList.toggle('collapsed');
  });

  // Mobile bottom sheet: dragging downward dismisses the filters panel
  // (ported from the sismos globe). The panel follows the finger; releasing
  // past the threshold — or a quick flick — closes it, otherwise it snaps
  // back. The handle claims the gesture immediately; the rest of the panel
  // only engages on a downward pull with the sheet scrolled to its top.
  (function wirePanelDrag() {
    var handle = $('panelHandle');
    if (!handle) return;
    handle.style.touchAction = 'none';

    var dragStartY = null;
    var lastY = 0;
    var dragStartTime = 0;
    var dragEngaged = false;

    var isInteractive = function (t) {
      return Boolean(t.closest && t.closest('input, select, button, a, textarea'));
    };

    var cleanupDrag = function () {
      dragStartY = null;
      dragEngaged = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    var onMove = function (e) {
      if (dragStartY == null) return;
      lastY = e.clientY;
      var dy = e.clientY - dragStartY;
      if (!dragEngaged) {
        if (dy > 8 && els.panel.scrollTop <= 0) {
          dragEngaged = true;
          els.panel.style.transition = 'none';
        } else if (dy < -8 || els.panel.scrollTop > 0) {
          cleanupDrag();
          return;
        } else {
          return;
        }
      }
      els.panel.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
      e.preventDefault();
    };

    var onEnd = function (e) {
      if (dragStartY == null) return;
      var endY = typeof e.clientY === 'number' && e.clientY !== 0 ? e.clientY : lastY;
      var dy = endY - dragStartY;
      var velocity = dy / Math.max(1, Date.now() - dragStartTime);
      var engaged = dragEngaged;
      cleanupDrag();
      els.panel.style.transition = '';
      els.panel.style.transform = '';
      if (engaged && (dy > 50 || (dy > 15 && velocity > 0.5))) {
        els.panel.classList.add('collapsed');
      }
    };

    var begin = function (e, fromHandle) {
      if (window.innerWidth > 640) return; // sheet gesture is mobile-only
      dragStartY = e.clientY;
      lastY = e.clientY;
      dragStartTime = Date.now();
      dragEngaged = fromHandle;
      if (fromHandle) els.panel.style.transition = 'none';
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    };

    handle.addEventListener('pointerdown', function (e) {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        // Synthetic events have no active pointer — window listeners cover it.
      }
      begin(e, true);
      e.preventDefault();
    });

    els.panel.addEventListener('pointerdown', function (e) {
      if (handle.contains(e.target) || isInteractive(e.target)) return;
      begin(e, false);
    });
  })();
  // Coming back to the tab refreshes immediately if the last load is stale,
  // so the "real time" feel survives phones suspending background tabs.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - lastLoadAt > 30 * 1000) load();
  });
  // The filters panel starts closed everywhere; only the button opens it.
  els.panel.classList.add('collapsed');

  applyStatic();
  initGlobe();
  wireMochila();
  wireNewsModal();
  wireArticleModal();
  load();
  scheduleRefresh();
})();
