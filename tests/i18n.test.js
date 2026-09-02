import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickLang,
  t,
  kindName,
  tierName,
  continentName,
  countryName,
  compassName,
  nearLabel,
  localizeTitle,
  alertLabel,
  formatDateTime
} from '../public/i18n.js';

test('pickLang matches the first supported browser language, falling back to en', () => {
  assert.equal(pickLang(['es-AR', 'en-US']), 'es');
  assert.equal(pickLang(['pt-BR']), 'pt');
  assert.equal(pickLang(['de']), 'de');
  assert.equal(pickLang(['ja-JP', 'fr-FR']), 'fr');
  assert.equal(pickLang(['ja-JP', 'zh-CN']), 'en');
  assert.equal(pickLang([]), 'en');
  assert.equal(pickLang(null), 'en');
});

test('t returns UI strings per language with English fallback', () => {
  assert.equal(t('report', 'es'), 'Ver informe completo');
  assert.equal(t('report', 'en'), 'View full report');
  assert.ok(t('report', 'pt').length > 0);
  // Unknown key falls back to the key itself, never crashes.
  assert.equal(t('__nope__', 'es'), '__nope__');
});

test('kindName and tierName translate across languages', () => {
  assert.equal(kindName('earthquake', 'es'), 'Sismo');
  assert.equal(kindName('earthquake', 'en'), 'Earthquake');
  assert.equal(kindName('wildfire', 'pt'), 'Incêndio');
  assert.equal(kindName('flood', 'de'), 'Überschwemmung');
  // Unknown kind degrades to the raw token.
  assert.equal(kindName('mystery', 'en'), 'mystery');

  assert.equal(tierName('gigante', 'es'), 'gigante');
  assert.equal(tierName('gigante', 'en'), 'giant');
  assert.equal(tierName('mediano', 'pt'), 'médio');
});

test('continentName maps the stored Spanish value to the viewer language', () => {
  assert.equal(continentName('América del Sur', 'en'), 'South America');
  assert.equal(continentName('América del Sur', 'es'), 'América del Sur');
  assert.equal(continentName('Oceanía', 'fr'), 'Océanie');
  // Unknown value passes through.
  assert.equal(continentName('Atlántida', 'en'), 'Atlántida');
});

test('countryName resolves ISO codes via Intl per language', () => {
  assert.equal(countryName('AR', 'es'), 'Argentina');
  assert.equal(countryName('DE', 'en'), 'Germany');
  assert.equal(countryName('US', 'es'), 'Estados Unidos');
  // A syntactically invalid code throws inside Intl -> falls back to itself.
  assert.equal(countryName('Z9', 'en'), 'Z9');
  assert.equal(countryName(null, 'en'), null);
});

test('compassName translates the 8 winds (E differs: L in pt, O in de)', () => {
  assert.equal(compassName(1, 'es'), 'NE');
  assert.equal(compassName(5, 'es'), 'SO');
  assert.equal(compassName(5, 'en'), 'SW');
  assert.equal(compassName(2, 'pt'), 'L');
  assert.equal(compassName(2, 'de'), 'O');
  assert.equal(compassName(7, 'en'), 'NW');
});

const NEAR = { name: 'Tocopilla', admin1: 'Antofagasta', cc: 'CL', distKm: 18.2, dir: 5 };

test('nearLabel renders the distance phrase in each language', () => {
  assert.equal(nearLabel(NEAR, 'es'), '18 km al SO de Tocopilla, Antofagasta, Chile');
  assert.equal(nearLabel(NEAR, 'en'), '18 km SW of Tocopilla, Antofagasta, Chile');
  assert.match(nearLabel(NEAR, 'pt'), /^18 km a SO de Tocopilla/);
  assert.match(nearLabel(NEAR, 'de'), /^18 km SW von Tocopilla/);
});

test('nearLabel drops the distance prefix when the event is on top of the city', () => {
  const close = { ...NEAR, distKm: 2.1 };
  assert.equal(nearLabel(close, 'es'), 'Tocopilla, Antofagasta, Chile');
  assert.equal(nearLabel(close, 'en'), 'Tocopilla, Antofagasta, Chile');
});

test('nearLabel skips a redundant admin1 and handles null input', () => {
  const dup = { name: 'Valparaíso', admin1: 'Valparaiso', cc: 'CL', distKm: 40, dir: 0 };
  assert.equal(nearLabel(dup, 'en'), '40 km N of Valparaíso, Chile');
  assert.equal(nearLabel(null, 'en'), null);
});

test('localizeTitle builds earthquake titles from nearData', () => {
  const quake = { kind: 'earthquake', title: 'Sismo: raw', nearData: NEAR };
  assert.equal(localizeTitle(quake, 'es'), 'Sismo: 18 km al SO de Tocopilla, Antofagasta, Chile');
  assert.equal(localizeTitle(quake, 'en'), 'Earthquake: 18 km SW of Tocopilla, Antofagasta, Chile');
});

test('localizeTitle names cyclones and adds the country when known', () => {
  const tc = { kind: 'cyclone', title: 'Tropical Cyclone KARINA-26', eventName: 'KARINA-26' };
  assert.equal(localizeTitle(tc, 'es'), 'Ciclón KARINA-26');
  assert.equal(localizeTitle(tc, 'en'), 'Cyclone KARINA-26');
  const tcLand = { ...tc, cc: 'MX' };
  assert.equal(localizeTitle(tcLand, 'es'), 'Ciclón KARINA-26 en México');
});

test('localizeTitle uses "kind in Country" when the feed provides a country code', () => {
  const flood = { kind: 'flood', title: 'Flood in Nepal', cc: 'NP' };
  assert.equal(localizeTitle(flood, 'es'), 'Inundación en Nepal');
  assert.equal(localizeTitle(flood, 'en'), 'Flood in Nepal');
  assert.equal(localizeTitle(flood, 'pt'), 'Inundação em Nepal');
});

test('localizeTitle falls back to "kind near City" and then to the raw title', () => {
  const fire = { kind: 'wildfire', title: 'Wildfire Ruggs, Morrow, Oregon', nearData: { name: 'Heppner', admin1: 'Oregon', cc: 'US', distKm: 20, dir: 3 } };
  assert.equal(localizeTitle(fire, 'es'), 'Incendio cerca de Heppner, Oregon, Estados Unidos');
  assert.equal(localizeTitle(fire, 'en'), 'Wildfire near Heppner, Oregon, United States');
  // Nothing structured -> raw feed title survives.
  const berg = { kind: 'ice', title: 'Iceberg A23a' };
  assert.equal(localizeTitle(berg, 'en'), 'Iceberg A23a');
});

test('alertLabel renders per language', () => {
  assert.equal(alertLabel('red', 'es'), 'alerta roja');
  assert.equal(alertLabel('red', 'en'), 'red alert');
  assert.equal(alertLabel('orange', 'es'), 'alerta naranja');
  assert.equal(alertLabel('green', 'de'), 'Grün-Alarm');
});

test('formatDateTime renders a localized date string (viewer clock)', () => {
  const out = formatDateTime('2026-09-02T12:00:00Z', 'es');
  assert.ok(typeof out === 'string' && /\d/.test(out), out);
  // Different languages produce their own month spellings.
  const en = formatDateTime('2026-12-02T12:00:00Z', 'en');
  const de = formatDateTime('2026-12-02T12:00:00Z', 'de');
  assert.match(en, /Dec/i);
  assert.match(de, /Dez/i);
});
