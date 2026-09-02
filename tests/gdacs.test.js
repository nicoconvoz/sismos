import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeGdacs, GDACS_URL } from '../lib/gdacs.js';
import { TIERS } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'gdacs-events4app.json'), 'utf-8'));

test('normalizeGdacs converts the real EVENTS4APP feed', () => {
  const events = normalizeGdacs(feed);
  assert.ok(events.length > 50, `expected a rich feed, got ${events.length}`);
  assert.ok(events.length <= feed.features.length);
  for (const e of events) {
    assert.equal(e.source, 'gdacs');
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    assert.ok(e.magnitude >= 0 && e.magnitude <= 10);
    assert.ok(TIERS.includes(e.tier), `bad tier ${e.tier}`);
    assert.ok(['green', 'orange', 'red'].includes(e.alert), `bad alert ${e.alert}`);
    assert.ok(!Number.isNaN(Date.parse(e.time)));
    assert.ok(e.time.endsWith('Z'), 'time must be UTC ISO');
    assert.ok(e.url, 'report url expected');
  }
  // The feed mixes several event kinds.
  const kinds = new Set(events.map((e) => e.kind));
  assert.ok(kinds.size >= 3, `expected kind variety, got ${[...kinds]}`);
});

test('normalizeGdacs maps a synthetic earthquake exactly', () => {
  const geojson = {
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [122.3, -3.9] },
        properties: {
          eventtype: 'EQ',
          eventid: 1563052,
          name: 'Earthquake in Indonesia',
          alertlevel: 'Green',
          alertscore: 1,
          country: 'Indonesia',
          fromdate: '2026-09-02T00:04:54',
          todate: '2026-09-02T00:04:54',
          datemodified: '2026-09-02T02:11:26',
          url: { report: 'https://www.gdacs.org/report.aspx?eventid=1563052' },
          affectedcountries: [{ iso2: 'ID', iso3: 'IDN', countryname: 'Indonesia' }],
          severitydata: { severity: 5.6, severitytext: 'Magnitude 5.6M, Depth:64.644km', severityunit: 'M' }
        }
      }
    ]
  };
  const [e] = normalizeGdacs(geojson);
  assert.equal(e.id, 'gdacs-EQ-1563052');
  assert.equal(e.kind, 'earthquake');
  assert.equal(e.cc, 'ID'); // ISO2 for client-side country localization
  // GDACS dates are UTC without a zone marker; they must parse as UTC.
  assert.equal(e.time, '2026-09-02T00:04:54.000Z');
  assert.equal(e.updated, '2026-09-02T02:11:26.000Z');
  // Earthquakes take their Richter-like severity as magnitude.
  assert.equal(e.magnitude, 5.6);
  assert.equal(e.tier, 'grande');
  assert.equal(e.alert, 'green');
  assert.equal(e.country, 'Indonesia');
  assert.equal(e.url, 'https://www.gdacs.org/report.aspx?eventid=1563052');
  assert.deepEqual(e.severity, { value: 5.6, unit: 'M', text: 'Magnitude 5.6M, Depth:64.644km' });
});

test('normalizeGdacs derives magnitude from the alert level for non-quakes', () => {
  const mk = (eventtype, alertlevel, alertscore) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10, 10] },
    properties: {
      eventtype,
      eventid: 1,
      name: 'X',
      alertlevel,
      alertscore,
      fromdate: '2026-09-01T00:00:00',
      todate: '2026-09-01T00:00:00',
      datemodified: '2026-09-01T00:00:00',
      url: {},
      severitydata: { severity: 120, severitytext: 'wind 120 km/h', severityunit: 'km/h' }
    }
  });
  const [green] = normalizeGdacs({ features: [mk('TC', 'Green', 1)] });
  const [orange] = normalizeGdacs({ features: [mk('FL', 'Orange', 2)] });
  const [red] = normalizeGdacs({ features: [mk('WF', 'Red', 3)] });
  assert.equal(green.tier, 'mediano');
  assert.equal(orange.tier, 'grande');
  assert.equal(red.tier, 'gigante');
  assert.equal(green.kind, 'cyclone');
  assert.equal(orange.kind, 'flood');
  assert.equal(red.kind, 'wildfire');
});

test('normalizeGdacs skips features without geometry or dates', () => {
  const good = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [1, 2] },
    properties: {
      eventtype: 'FL', eventid: 9, name: 'ok', alertlevel: 'Green', alertscore: 0,
      fromdate: '2026-09-01T00:00:00', datemodified: '2026-09-01T00:00:00', url: {}
    }
  };
  const noGeom = { ...good, geometry: null, properties: { ...good.properties, eventid: 10 } };
  const noDate = {
    ...good,
    properties: { ...good.properties, eventid: 11, fromdate: null, datemodified: null }
  };
  const events = normalizeGdacs({ features: [good, noGeom, noDate] });
  assert.deepEqual(events.map((e) => e.id), ['gdacs-FL-9']);
});

test('normalizeGdacs tolerates malformed input', () => {
  assert.deepEqual(normalizeGdacs(null), []);
  assert.deepEqual(normalizeGdacs({}), []);
});

test('GDACS_URL points at the EVENTS4APP GeoJSON endpoint', () => {
  assert.equal(GDACS_URL, 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP');
});
