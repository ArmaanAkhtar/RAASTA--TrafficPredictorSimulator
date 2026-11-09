/**
 * scripts/build-places.ts
 * Run: npx tsx scripts/build-places.ts        (after: npx tsx scripts/fetch-osm.ts --places-only)
 *
 * Every Karachi area, its blocks / sectors, and famous places, for the map labels and the search.
 *   Input:  scripts/data/karachi_places.json  (OpenStreetMap places, from fetch-osm.ts)
 *   Output: public/data/places.json           { v: 1, places: [[name, kind, x, y, cat], ...] }
 *           kind: 0 area (Gulshan-e-Iqbal), 1 block / sector (Block 13-D, Gulshan-e-Iqbal), 2 famous place
 *           x, y: local metres;  cat: landmark type ('edu', 'hospital', 'park', ...) or ''
 * A bare "Block 5" gets the nearest area added ("Block 5, Gulshan-e-Iqbal") so the search can tell them apart.
 * Uses only Node built-ins.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PLACES, toLocal } from '../src/lib/places';

type Pt = [number, number];

const ROOT = process.cwd();
const IN_FILE = path.join(ROOT, 'scripts', 'data', 'karachi_places.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'places.json');

const BOX = { minX: -15000, maxX: 29000, minY: -13000, maxY: 29000 };
const PARENT_MAX_M = 6000; // a block takes the name of the nearest area within this distance

const AREA_PLACES = new Set(['suburb', 'town', 'village']);
const BLOCK_PLACES = new Set(['neighbourhood', 'quarter', 'city_block', 'locality', 'hamlet', 'isolated_dwelling']);

function category(t: Record<string, string>): string {
  const a = t.amenity ?? '';
  if (a === 'university' || a === 'college') return 'edu';
  if (a === 'hospital') return 'hospital';
  if (a === 'marketplace' || t.shop) return 'shop';
  if (a === 'bus_station' || t.railway === 'station') return 'station';
  if (a === 'stadium' || t.leisure === 'stadium' || t.leisure === 'sports_centre') return 'sport';
  if (a === 'place_of_worship') return 'worship';
  if (t.aeroway) return 'airport';
  if (t.leisure || t.tourism === 'zoo' || t.tourism === 'theme_park') return 'park';
  return 'sight'; // museum, attraction, viewpoint, historic
}

/** Latin part of a name ("Gulshan-e-Iqbal گلشن اقبال" -> "Gulshan-e-Iqbal"); '' if there is none. */
function latin(name: string | undefined): string {
  if (!name) return '';
  const cleaned = name
    .replace(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g, ' ')
    .replace(/[()[\]]+\s*[()[\]]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,\-–/]+|[\s,\-–/]+$/g, '');
  return (cleaned.match(/[A-Za-z]/g) ?? []).length >= 2 ? cleaned : '';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const isBareBlock = (name: string) =>
  /^(block|blk|sector|sec|phase|area|scheme|unit|town|no\.?)\b/i.test(name) || /^[0-9]+\s*[-/]?\s*[a-z]?$/i.test(name);

interface Item {
  name: string;
  kind: 0 | 1 | 2;
  p: Pt;
  cat: string;
}

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Missing ${path.relative(ROOT, IN_FILE)}. Run first:  npx tsx scripts/fetch-osm.ts --places-only`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf8')) as { places?: Array<{ lat: number; lon: number; tags: Record<string, string> }> };
  const raw = data.places ?? [];

  const items: Item[] = [];
  let noLatinName = 0;
  for (const r of raw) {
    const t = r.tags ?? {};
    const name = latin(t['name:en']) || latin(t.name);
    if (!name) {
      noLatinName++;
      continue;
    }
    const p = toLocal(r.lat, r.lon);
    if (p[0] < BOX.minX || p[0] > BOX.maxX || p[1] < BOX.minY || p[1] > BOX.maxY) continue;
    const place = t.place ?? '';
    const kind: 0 | 1 | 2 = AREA_PLACES.has(place) ? 0 : BLOCK_PLACES.has(place) ? 1 : place ? 1 : 2;
    items.push({ name, kind, p, cat: kind === 2 ? category(t) : '' });
  }

  // Parent areas: OSM suburbs/towns plus the hand-picked areas in src/lib/places.ts
  const parents = [
    ...items.filter((i) => i.kind === 0).map((i) => ({ name: i.name, p: i.p })),
    ...PLACES.filter((pl) => pl.kind === 'area').map((pl) => ({ name: pl.name, p: pl.point as Pt })),
  ];
  let named = 0;
  for (const it of items) {
    if (it.kind !== 1 || !isBareBlock(it.name)) continue;
    let best = '';
    let bestD = PARENT_MAX_M;
    for (const par of parents) {
      const d = Math.hypot(par.p[0] - it.p[0], par.p[1] - it.p[1]);
      if (d < bestD) {
        bestD = d;
        best = par.name;
      }
    }
    if (best) {
      it.name = `${it.name}, ${best}`;
      named++;
    }
  }

  // Drop duplicates: same name within 500 m (areas first), and names the hand-picked list already has
  items.sort((a, b) => a.kind - b.kind);
  const handNames = new Set(PLACES.map((pl) => norm(pl.name)));
  const kept: Item[] = [];
  const byName = new Map<string, Item[]>();
  let dupes = 0;
  for (const it of items) {
    const key = norm(it.name);
    if (handNames.has(key)) {
      dupes++;
      continue;
    }
    const same = byName.get(key) ?? [];
    if (same.some((s) => Math.hypot(s.p[0] - it.p[0], s.p[1] - it.p[1]) < 500)) {
      dupes++;
      continue;
    }
    same.push(it);
    byName.set(key, same);
    kept.push(it);
  }

  const places = kept.map((i) => [i.name, i.kind, Math.round(i.p[0]), Math.round(i.p[1]), i.cat]);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ v: 1, places }));

  const count = (k: number) => kept.filter((i) => i.kind === k).length;
  console.log('\n=== build-places: done ===');
  console.log(`From OpenStreetMap : ${raw.length} (${noLatinName} skipped: no English name)`);
  console.log(`Areas              : ${count(0)}`);
  console.log(`Blocks / sectors   : ${count(1)}  (${named} got their area name added)`);
  console.log(`Famous places      : ${count(2)}`);
  console.log(`Duplicates dropped : ${dupes}`);
  console.log(`File size          : ${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB -> ${path.relative(ROOT, OUT_FILE)}`);
  const sample = kept.filter((i) => /gulshan|nazimabad/i.test(i.name)).slice(0, 12).map((i) => i.name);
  if (sample.length) console.log(`Sample             : ${sample.join(' | ')}`);
}

main();
