import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSmnIndex, parseSmnCap, smnKindOf, SMN_INDEX_URL } from '../lib/smn.js';
import { TIERS } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const indexHtml = readFileSync(join(fixtures, 'smn-index.html'), 'utf-8');
const capXml = readFileSync(join(fixtures, 'smn-cap-tormenta.xml'), 'utf-8');

test('parseSmnIndex also reads the RSS flavor of the index', () => {
  // The endpoint content-negotiates: browsers get HTML (href="..."), other
  // agents an RSS whose <link> tags carry the same CAP URLs.
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><link>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_1_Zonda_Cordillera_alertas_alertas_1.xml</link></item>
    <item><link>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_1_Zonda_Cordillera_alertas_alertas_1.xml</link></item>
    <item><link>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_2_Nevada_Patagonia_alertas_alertas_2.xml</link></item>
  </channel></rss>`;
  const urls = parseSmnIndex(rss);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /Zonda_Cordillera/);
  assert.match(urls[1], /Nevada_Patagonia/);
});

test('parseSmnIndex extracts the CAP file URLs, deduped', () => {
  const urls = parseSmnIndex(indexHtml);
  assert.ok(urls.length >= 10, `expected CAP urls, got ${urls.length}`);
  for (const u of urls) {
    assert.match(u, /^https:\/\/ssl\.smn\.gob\.ar\/.*\.xml$/);
  }
  assert.equal(new Set(urls).size, urls.length, 'no duplicates');
});

test('parseSmnCap converts a real CAP alert with polygon centroid', () => {
  // The fixture alert expired long ago; evaluate it as of its own day.
  const now = Date.parse('2026-09-02T06:00:00Z');
  const e = parseSmnCap(capXml, now);
  assert.ok(e, 'alert should parse');
  assert.equal(e.source, 'smn');
  assert.equal(e.kind, 'storm');
  assert.equal(e.cc, 'AR');
  assert.equal(e.country, 'Argentina');
  assert.ok(e.id.startsWith('smn-'));
  // Centroid falls inside Buenos Aires province (polygon around -38.7, -61).
  assert.ok(e.lat < -38 && e.lat > -40, `lat ${e.lat}`);
  assert.ok(e.lon < -60 && e.lon > -63, `lon ${e.lon}`);
  assert.equal(e.continent, 'América del Sur');
  // CAP Moderate -> yellow alert, tier mediano.
  assert.equal(e.alert, 'yellow');
  assert.equal(e.tier, 'mediano');
  assert.ok(TIERS.includes(e.tier));
  // Issued time is the event time (onset can be in the future).
  assert.equal(e.time, new Date('2026-09-01T08:59:19-03:00').toISOString());
  // Structured validity window, so the map can render upcoming warnings at
  // full strength until the phenomenon actually starts.
  assert.equal(e.starts, new Date('2026-09-02T03:00:00-03:00').toISOString());
  assert.equal(e.ends, new Date('2026-09-02T08:59:59-03:00').toISOString());
  // The forecaster's description carries the specifics (gusts, mm, °C):
  // decoded from hex entities and exposed for the detail card.
  assert.match(e.details, /^El área será afectada por tormentas aisladas/);
  assert.match(e.details, /entre 20 y 50 mm/);
});

test('parseSmnCap takes the official SMN zone from the CAP file name', () => {
  const now = Date.parse('2026-09-02T06:00:00Z');
  const url =
    'https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_20260901090313_Tormenta_Llanura_alertas_alertas_1.xml';
  const e = parseSmnCap(capXml, now, url);
  assert.equal(e.area, 'Llanura');
  // Zonda files follow the same shape.
  const zondaUrl = url.replace('Tormenta_Llanura', 'Zonda_Cordillera');
  assert.equal(parseSmnCap(capXml, now, zondaUrl).area, 'Cordillera');
  // No url -> no area, never a crash.
  assert.equal(parseSmnCap(capXml, now).area, undefined);
});

test('parseSmnCap drops alerts that already expired', () => {
  const nowPastExpiry = Date.parse('2026-09-03T00:00:00Z'); // fixture expires Sep 2 08:59 -03
  assert.equal(parseSmnCap(capXml, nowPastExpiry), null);
});

test('parseSmnCap tolerates malformed input', () => {
  assert.equal(parseSmnCap('<xml>nope</xml>', Date.now()), null);
  assert.equal(parseSmnCap('', Date.now()), null);
  assert.equal(parseSmnCap(null, Date.now()), null);
});

test('smnKindOf maps SMN event wording to kinds (zonda, nieve, calor)', () => {
  assert.equal(smnKindOf('Viento Zonda'), 'wind');
  assert.equal(smnKindOf('Vientos fuertes'), 'wind');
  assert.equal(smnKindOf('Nevadas intensas'), 'snow');
  assert.equal(smnKindOf('Nieve'), 'snow');
  assert.equal(smnKindOf('Ola de calor'), 'heat');
  assert.equal(smnKindOf('Temperaturas extremas: calor'), 'heat');
  assert.equal(smnKindOf('Ola de frío'), 'cold');
  assert.equal(smnKindOf('Granizo'), 'hail');
  assert.equal(smnKindOf('Caída de granizo'), 'hail');
  assert.equal(smnKindOf('Tormentas'), 'storm');
  assert.equal(smnKindOf('Lluvias'), 'storm');
  assert.equal(smnKindOf('¿?'), 'storm'); // sensible default for weather alerts
});

test('SMN_INDEX_URL points at the public CAP index', () => {
  assert.equal(SMN_INDEX_URL, 'https://ssl.smn.gob.ar/CAP/AR.php');
});
