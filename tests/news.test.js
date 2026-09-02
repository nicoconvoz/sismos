import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildNewsRssUrl,
  buildNewsQuery,
  parseNewsRss,
  zoneLang,
  editionFor,
  countryNameFor,
  frameBlocked,
  filterBySince,
  filterByKeyword,
  properNameKeyword,
  termLadder
} from '../lib/news.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const xml = readFileSync(join(fixtures, 'bing-news-nepal.xml'), 'utf-8');

test('parseNewsRss extracts direct publisher links from the real Bing feed', () => {
  const items = parseNewsRss(xml);
  assert.ok(items.length >= 5, `expected a rich feed, got ${items.length}`);
  for (const it of items) {
    assert.ok(it.title && typeof it.title === 'string');
    // The whole point of Bing over Google News: links go straight to the
    // outlet (embeddable), never through an aggregator redirect.
    assert.match(it.link, /^https?:\/\//);
    assert.ok(!/bing\.com/.test(new URL(it.link).hostname), `aggregator link leaked: ${it.link}`);
    assert.ok(!Number.isNaN(Date.parse(it.pubDate)));
    assert.ok(it.source, 'source outlet name expected');
    // Entities (named and numeric) decoded for display.
    assert.ok(!/&#\d+;|&amp;/.test(it.title), `undecoded entity: ${it.title}`);
  }
});

test('parseNewsRss unwraps apiclick links and decodes numeric entities exactly', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Inundaci&#243;n &amp; alerta</title>
      <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;url=https%3a%2f%2furgente24.com%2fnota-n1&amp;c=99&amp;mkt=es-ar</link>
      <pubDate>Tue, 01 Sep 2026 14:00:00 GMT</pubDate>
      <News:Source>Urgente24</News:Source></item>
    <item><title>Directo</title>
      <link>https://ejemplo.com/b</link>
      <pubDate>Tue, 02 Sep 2026 10:00:00 GMT</pubDate>
      <News:Source>El Diario</News:Source></item>
  </channel></rss>`;
  const items = parseNewsRss(rss);
  assert.equal(items.length, 2);
  // Sorted newest first; direct links pass through untouched.
  assert.equal(items[0].link, 'https://ejemplo.com/b');
  assert.equal(items[1].title, 'Inundación & alerta');
  assert.equal(items[1].link, 'https://urgente24.com/nota-n1');
  assert.equal(items[1].source, 'Urgente24');
});

test('parseNewsRss tolerates malformed input', () => {
  assert.deepEqual(parseNewsRss(''), []);
  assert.deepEqual(parseNewsRss(null), []);
  assert.deepEqual(parseNewsRss('<html>nope</html>'), []);
});

test('buildNewsRssUrl targets the Bing News market edition', () => {
  assert.equal(
    buildNewsRssUrl({ q: 'sismo Tocopilla', mkt: 'es-CL' }),
    'https://www.bing.com/news/search?q=sismo%20Tocopilla&format=RSS&setmkt=es-CL'
  );
});

test('buildNewsQuery phrases the search in the given language', () => {
  assert.equal(buildNewsQuery({ kind: 'earthquake', place: 'Tocopilla', hl: 'es' }), 'sismo Tocopilla');
  assert.equal(buildNewsQuery({ kind: 'wildfire', place: 'Pará', hl: 'pt' }), 'incêndio Pará');
  assert.equal(buildNewsQuery({ kind: 'flood', place: 'Nepal', hl: 'ne' }), 'flood Nepal'); // unsupported lang -> English
  assert.equal(buildNewsQuery({ kind: 'cyclone', place: '', hl: 'en' }), 'cyclone');
});

test('zoneLang maps countries to their local press language', () => {
  assert.equal(zoneLang('AR'), 'es');
  assert.equal(zoneLang('BR'), 'pt');
  assert.equal(zoneLang('XX'), 'en');
  assert.equal(zoneLang(null), 'en');
});

test('countryNameFor localizes country names for query building', () => {
  assert.equal(countryNameFor('NP', 'es'), 'Nepal');
  assert.equal(countryNameFor('DE', 'es'), 'Alemania');
  assert.equal(countryNameFor('BR', 'en'), 'Brazil');
  assert.equal(countryNameFor(null, 'es'), null);
});

test('filterBySince keeps only coverage published strictly after the event', () => {
  const items = [
    { title: 'old flood', pubDate: '2026-08-10T12:00:00.000Z' },
    { title: 'three hours before', pubDate: '2026-08-25T19:00:00.000Z' },
    { title: 'same day, after', pubDate: '2026-08-26T06:00:00.000Z' },
    { title: 'a week later', pubDate: '2026-09-01T10:00:00.000Z' }
  ];
  // Event started Aug 25 22:00 UTC: anything published earlier is about
  // something else — no slop margin by default.
  const kept = filterBySince(items, '2026-08-25T22:00:00Z');
  assert.deepEqual(kept.map((i) => i.title), ['same day, after', 'a week later']);
  // No since -> unchanged.
  assert.equal(filterBySince(items, null).length, 4);
  // Bad since -> unchanged (never hide everything by accident).
  assert.equal(filterBySince(items, 'garbage').length, 4);
});

test('termLadder retries city -> state -> country until something is found', () => {
  // Local press: the town first, but the press mostly covers the STATE
  // ("sismo Oaxaca"), then the country as a last resort.
  assert.deepEqual(
    termLadder({ localPress: true, place: 'San Miguel del Puerto', admin1: 'Oaxaca', country: 'México' }),
    ['San Miguel del Puerto', 'Oaxaca', 'México']
  );
  // Foreign-language press: the town is useless; state, then country.
  assert.deepEqual(
    termLadder({ localPress: false, place: 'Panauti', admin1: 'Bagmati Province', country: 'Nepal' }),
    ['Bagmati Province', 'Nepal']
  );
  // Named storms search by name only — a country fallback would mix in
  // every other storm of the season.
  assert.deepEqual(
    termLadder({ localPress: false, place: '', admin1: null, country: 'México', properName: 'Karina' }),
    ['Karina']
  );
  // Duplicates and empties collapse (city named like its state).
  assert.deepEqual(
    termLadder({ localPress: true, place: 'Oaxaca', admin1: 'Oaxaca', country: 'México' }),
    ['Oaxaca', 'México']
  );
  assert.deepEqual(termLadder({ localPress: true, place: '', admin1: null, country: null }), []);
});

test('properNameKeyword cleans agency storm names for searching', () => {
  assert.equal(properNameKeyword('KARINA-26'), 'Karina');
  assert.equal(properNameKeyword('Edouard'), 'Edouard');
  assert.equal(properNameKeyword(''), null);
  assert.equal(properNameKeyword(null), null);
});

test('filterByKeyword requires a keyword in the title, accent-insensitively', () => {
  const items = [
    { title: 'El ciclón Edouard tocó tierra en el Golfo de México' },
    { title: 'Huracán KARINA se intensifica frente a Baja California' },
    { title: 'Instituto quiere el invicto ante un “Ciclón” necesitado' },
    { title: 'Inundacion en NEPAL: rescates continúan' }
  ];
  // Named storm: only its own coverage survives — no Edouard, no football.
  assert.deepEqual(
    filterByKeyword(items, ['Karina']).map((i) => i.title),
    ['Huracán KARINA se intensifica frente a Baja California']
  );
  // Unnamed events accept place OR country (accent differences tolerated).
  assert.deepEqual(
    filterByKeyword(items, ['Panauti', 'Nepal']).map((i) => i.title),
    ['Inundacion en NEPAL: rescates continúan']
  );
  // No keywords -> unchanged.
  assert.equal(filterByKeyword(items, []).length, 4);
  assert.equal(filterByKeyword(items, [null, '']).length, 4);
});

test('frameBlocked reads X-Frame-Options and CSP frame-ancestors', () => {
  const h = (obj) => new Map(Object.entries(obj));
  // Explicit denials.
  assert.equal(frameBlocked(h({ 'x-frame-options': 'DENY' })), true);
  assert.equal(frameBlocked(h({ 'x-frame-options': 'sameorigin' })), true);
  assert.equal(frameBlocked(h({ 'content-security-policy': "frame-ancestors 'self'" })), true);
  assert.equal(frameBlocked(h({ 'content-security-policy': 'frame-ancestors https://msn.com' })), true);
  // Permissive or absent policies embed fine.
  assert.equal(frameBlocked(h({ 'content-security-policy': 'frame-ancestors *' })), false);
  assert.equal(frameBlocked(h({ 'content-security-policy': "default-src 'self'" })), false);
  assert.equal(frameBlocked(h({ 'x-frame-options': 'ALLOWALL' })), false);
  assert.equal(frameBlocked(h({})), false);
});

test('editionFor keeps the zone market when its language matches the viewer', () => {
  // Spanish viewer + Chilean quake -> Chilean market, Spanish press.
  assert.deepEqual(editionFor('es', 'CL'), { mkt: 'es-CL' });
  assert.deepEqual(editionFor('pt', 'BR'), { mkt: 'pt-BR' });
});

test('editionFor falls back to the viewer-language market elsewhere', () => {
  // Spanish viewer + Nepal flood -> Spanish market, never English.
  assert.deepEqual(editionFor('es', 'NP'), { mkt: 'es-AR' });
  assert.deepEqual(editionFor('en', 'NP'), { mkt: 'en-US' });
  assert.deepEqual(editionFor('de', 'CL'), { mkt: 'de-DE' });
  assert.deepEqual(editionFor('xx', null), { mkt: 'en-US' });
});
