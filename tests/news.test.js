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
  countryNameFor
} from '../lib/news.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const xml = readFileSync(join(fixtures, 'gnews-sismo-chile.xml'), 'utf-8');

test('parseNewsRss extracts items from the real Google News feed', () => {
  const items = parseNewsRss(xml);
  assert.ok(items.length >= 10, `expected a rich feed, got ${items.length}`);
  for (const it of items) {
    assert.ok(it.title && typeof it.title === 'string');
    assert.match(it.link, /^https?:\/\//);
    assert.ok(!Number.isNaN(Date.parse(it.pubDate)), `bad date ${it.pubDate}`);
    assert.ok(it.source, 'source outlet name expected');
    // No unescaped XML entities leaking into display strings.
    assert.ok(!it.title.includes('&amp;') && !it.title.includes('&#39;'));
  }
});

test('parseNewsRss maps a synthetic item exactly and sorts newest first', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Viejo &amp; lejano</title><link>https://ejemplo.com/a</link>
      <pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
      <source url="https://ejemplo.com">El Diario</source></item>
    <item><title>Nuevo</title><link>https://ejemplo.com/b</link>
      <pubDate>Tue, 02 Sep 2026 10:00:00 GMT</pubDate>
      <source url="https://ejemplo.com">La Radio</source></item>
  </channel></rss>`;
  const items = parseNewsRss(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Nuevo');
  assert.equal(items[0].source, 'La Radio');
  assert.equal(items[1].title, 'Viejo & lejano');
  assert.equal(items[1].link, 'https://ejemplo.com/a');
});

test('parseNewsRss tolerates malformed input', () => {
  assert.deepEqual(parseNewsRss(''), []);
  assert.deepEqual(parseNewsRss(null), []);
  assert.deepEqual(parseNewsRss('<html>nope</html>'), []);
});

test('buildNewsRssUrl targets the zone edition of Google News', () => {
  assert.equal(
    buildNewsRssUrl({ q: 'sismo Tocopilla', gl: 'CL', hl: 'es' }),
    'https://news.google.com/rss/search?q=sismo%20Tocopilla&hl=es&gl=CL&ceid=CL%3Aes'
  );
});

test('zoneLang maps countries to their local press language', () => {
  assert.equal(zoneLang('AR'), 'es');
  assert.equal(zoneLang('CL'), 'es');
  assert.equal(zoneLang('BR'), 'pt');
  assert.equal(zoneLang('FR'), 'fr');
  assert.equal(zoneLang('DE'), 'de');
  assert.equal(zoneLang('JP'), 'ja');
  assert.equal(zoneLang('XX'), 'en'); // unknown -> English
  assert.equal(zoneLang(null), 'en');
});

test('buildNewsQuery phrases the search in the zone press language', () => {
  // Chilean papers write "sismo", not "earthquake".
  assert.equal(buildNewsQuery({ kind: 'earthquake', place: 'Tocopilla', hl: 'es' }), 'sismo Tocopilla');
  assert.equal(buildNewsQuery({ kind: 'wildfire', place: 'Pará', hl: 'pt' }), 'incêndio Pará');
  assert.equal(buildNewsQuery({ kind: 'flood', place: 'Nepal', hl: 'ne' }), 'flood Nepal'); // unsupported lang -> English
  assert.equal(buildNewsQuery({ kind: 'cyclone', place: '', hl: 'en' }), 'cyclone');
});

test('countryNameFor localizes country names for query building', () => {
  assert.equal(countryNameFor('NP', 'es'), 'Nepal');
  assert.equal(countryNameFor('DE', 'es'), 'Alemania');
  assert.equal(countryNameFor('BR', 'en'), 'Brazil');
  assert.equal(countryNameFor(null, 'es'), null);
});

test('editionFor keeps the zone edition when its language matches the viewer', () => {
  // Spanish viewer + Chilean quake -> Chilean press, in Spanish.
  assert.deepEqual(editionFor('es', 'CL'), { gl: 'CL', hl: 'es-419' });
  // Portuguese viewer + Brazilian fire -> Brazilian press.
  assert.deepEqual(editionFor('pt', 'BR'), { gl: 'BR', hl: 'pt-BR' });
});

test('editionFor falls back to the viewer-language edition elsewhere', () => {
  // Spanish viewer + Nepal flood -> Spanish-language edition, never English.
  assert.deepEqual(editionFor('es', 'NP'), { gl: 'AR', hl: 'es-419' });
  assert.deepEqual(editionFor('en', 'NP'), { gl: 'US', hl: 'en-US' });
  assert.deepEqual(editionFor('de', 'CL'), { gl: 'DE', hl: 'de' });
  // Unknown viewer language -> English edition; missing cc tolerated.
  assert.deepEqual(editionFor('xx', null), { gl: 'US', hl: 'en-US' });
});
