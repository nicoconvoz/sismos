// One-off generator for lib/data/cities.json — the offline nearest-city
// dataset used by /api/geocode.
//
// Sources (GeoNames, CC-BY 4.0, https://www.geonames.org/):
// - cities1000.zip: all populated places with population > 1000 (~170k rows,
//   tab-separated: geonameid, name, asciiname, alternatenames, lat, lon,
//   feature class, feature code, country code, cc2, admin1 code, ...).
// - admin1CodesASCII.txt: maps "<CC>.<admin1 code>" -> admin1 name
//   (e.g. "AR.18" -> "San Juan").
//
// Output format (compact array-of-arrays to keep the file small):
//   [name, lat, lon, admin1Name, countryCode]
// - name: the local UTF-8 `name` column (NOT asciiname).
// - lat/lon rounded to 3 decimals (~110 m — far below epicenter accuracy).
// - admin1Name: '' when unknown.
// - Country names are NOT stored: the runtime resolves them in Spanish via
//   Intl.DisplayNames.
// Rows kept: PPL* main codes only — sections/parts (PPLX), abandoned (PPLQ),
// destroyed (PPLW) and historical (PPLH, PPLCH) places are skipped.
//
// Usage:
//   node tools/build-cities.js [cities1000.txt admin1CodesASCII.txt]
// With no arguments it downloads the dumps to the OS temp dir (extracting
// the zip with the system `unzip`, or PowerShell Expand-Archive on Windows).

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const GEONAMES = 'https://download.geonames.org/export/dump';
const KEEP_CODES = new Set([
  'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLF', 'PPLG', 'PPLL', 'PPLS'
]);

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'data', 'cities.json');

async function download(url, dest) {
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function extractZip(zipPath, entryName, destDir) {
  try {
    const out = execFileSync('unzip', ['-p', zipPath, entryName], { maxBuffer: 1 << 28 });
    const dest = join(destDir, entryName);
    writeFileSync(dest, out);
    return dest;
  } catch {
    // Windows fallback without unzip in PATH.
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${destDir}'`
    ]);
    return join(destDir, entryName);
  }
}

async function resolveInputs() {
  const [citiesArg, adminArg] = process.argv.slice(2);
  if (citiesArg && adminArg) return { citiesTxt: citiesArg, adminTxt: adminArg };

  const dir = join(tmpdir(), 'sismos-geonames');
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, 'cities1000.zip');
  const adminTxt = join(dir, 'admin1CodesASCII.txt');
  if (!existsSync(zipPath)) await download(`${GEONAMES}/cities1000.zip`, zipPath);
  if (!existsSync(adminTxt)) await download(`${GEONAMES}/admin1CodesASCII.txt`, adminTxt);
  return { citiesTxt: extractZip(zipPath, 'cities1000.txt', dir), adminTxt };
}

const { citiesTxt, adminTxt } = await resolveInputs();

// "<CC>.<code>" -> UTF-8 admin1 name (2nd column of admin1CodesASCII.txt).
const admin1 = new Map();
for (const line of readFileSync(adminTxt, 'utf-8').split('\n')) {
  const [code, name] = line.split('\t');
  if (code && name) admin1.set(code.trim(), name.trim());
}

const rows = [];
let skipped = 0;
for (const line of readFileSync(citiesTxt, 'utf-8').split('\n')) {
  if (!line.trim()) continue;
  const c = line.split('\t');
  const [, name, , , lat, lon, featureClass, featureCode, cc, , admin1Code] = c;
  if (featureClass !== 'P' || !KEEP_CODES.has(featureCode)) {
    skipped++;
    continue;
  }
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!name || !cc || !Number.isFinite(latN) || !Number.isFinite(lonN)) {
    skipped++;
    continue;
  }
  rows.push([
    name,
    Math.round(latN * 1000) / 1000,
    Math.round(lonN * 1000) / 1000,
    admin1.get(`${cc}.${admin1Code}`) || '',
    cc
  ]);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rows));
const mb = (readFileSync(outPath).length / 1024 / 1024).toFixed(2);
console.log(`wrote ${rows.length} cities (${skipped} rows skipped) -> ${outPath} (${mb} MB)`);
