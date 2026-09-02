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
    firms: 'NASA FIRMS'
  };

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

  function ageHours(evento) {
    return (Date.now() - Date.parse(evento.updated || evento.time)) / 3600000;
  }

  // ---------- Globe ----------

  function initGlobe() {
    globe = Globe()(els.globe)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
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
      .pointAltitude(function () { return 0.0015 * zoomScale; })
      .pointColor(function (d) { return colorFor(d); })
      .pointRadius(pointRadius)
      .pointsMerge(false)
      // Touch devices fire hover + click on the same tap, so the hover
      // bubble and the card would open together; keep only the card there.
      .pointLabel(isTouch() ? function () { return null; } : tooltipHtml)
      // Clicks resolve by proximity against rendered events (the original
      // sismos model): per-mesh picking on flat discs is unreliable, and
      // this also lets a click BETWEEN packed circles open the swarm picker.
      .onGlobeClick(function (coords) {
        if (!coords) return;
        var near = eventsNear(coords.lat, coords.lng);
        if (near.length === 1) showCard(near[0]);
        else if (near.length > 1) showEventPicker(near);
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
        globe.pointAltitude(function () { return 0.0015 * zoomScale; });
        globe.ringMaxRadius(ringMaxRadius);
      }, 150);
    });

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
    return Math.max(0.32, 0.22 + 0.08 * e.magnitude) * zoomScale;
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
    globe.pointsData(events);
    // Any kind ripples on fresh ACTIVITY: quakes by origin time, ongoing
    // events (fires, floods, cyclones) by their latest agency update —
    // start dates alone would leave everything but quakes silent.
    globe.ringsData(events.filter(function (e) {
      return e.alert === 'red' || now - Date.parse(e.updated || e.time) <= RECENT_RING_MS;
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
    badges.push('<span class="badge badge-source">' + (SOURCE_LABELS[e.source] || e.source) + '</span>');

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
    var cc = e.cc || (e.nearData && e.nearData.cc) || '';

    body.innerHTML = '<div class="news-empty">' + I18n.t('loading', LANG) + '</div>';
    modal.classList.remove('hidden');

    // News in the viewer's language; the server only picks the local zone
    // edition when its press speaks that same language.
    fetch('/api/news?kind=' + encodeURIComponent(e.kind) +
      '&place=' + encodeURIComponent(place) + '&cc=' + encodeURIComponent(cc) +
      '&lang=' + encodeURIComponent(LANG) +
      '&since=' + encodeURIComponent(e.time) +
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

  function load() {
    els.errorBox.classList.add('hidden');
    lastLoadAt = Date.now();
    fetch(API_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        allEvents = data.events || [];
        // Announce arrivals only after the baseline load, so the first
        // payload does not fire a thousand alerts.
        if (knownIds) {
          var newcomers = allEvents.filter(function (e) { return !knownIds.has(e.id); });
          if (newcomers.length) announceNew(newcomers);
        }
        knownIds = new Set(allEvents.map(function (e) { return e.id; }));

        populateKinds();
        els.updated.textContent = I18n.t('updated', LANG) + ' ' +
          I18n.formatDateTime(data.updatedAt, LANG) + (data.stale ? ' ' + I18n.t('cached', LANG) : '');
        if (data.sourceCounts) {
          els.sourcesNote.textContent = Object.keys(data.sourceCounts).map(function (s) {
            return (SOURCE_LABELS[s] || s) + ': ' + data.sourceCounts[s];
          }).join(' · ') + ' — ' + I18n.t('merged', LANG);
        }
        els.loading.classList.add('hidden');
        render();
      })
      .catch(function () {
        els.loading.classList.add('hidden');
        if (!allEvents.length) els.errorBox.classList.remove('hidden');
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
      if (!infoImg.getAttribute('src')) infoImg.src = 'mochila.jpg';
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
    els.loading.classList.remove('hidden');
    load();
  });
  els.panelToggle.addEventListener('click', function () {
    els.panel.classList.toggle('collapsed');
  });
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
