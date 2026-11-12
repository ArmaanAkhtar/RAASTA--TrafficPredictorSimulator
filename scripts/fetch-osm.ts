/**
 * scripts/fetch-osm.ts
 * Run: npx tsx scripts/fetch-osm.ts            (needs internet, takes 1-5 minutes)
 *
 * Downloads Karachi from OpenStreetMap (Overpass API), so nobody has to use overpass-turbo by hand:
 *   1. scripts/data/karachi_raw.geojson   main roads + slip roads + U-turn cuts   (for build-roads + build-graph)
 *   2. scripts/data/karachi_streets.json  street geometry and every named street    (for build-streets + build-places)
 *   3. scripts/data/karachi_places.json   areas, admin boundaries and landmarks    (for build-places)
 *   4. scripts/data/karachi_restrictions.json  turn restrictions: no right turn, only straight on ... (for build-graph)
 *      scripts/data/karachi_signals.json       traffic lights (crossing a main road is only easy there)
 *
 * Then run:
 *   npx tsx scripts/build-roads.ts
 *   npx tsx scripts/build-streets.ts
 *   npx tsx scripts/build-graph.ts
 *   npx tsx scripts/build-places.ts
 *   npx tsx scripts/build-cameras.ts
 *   (or simply: npm run data)
 *
 * Options:  --main-only, --streets-only, --places-only or --restrictions-only (only that part)
 * If it stops half way (Ctrl+C or no internet), just run it again: finished street parts are kept in
 * scripts/data/.osm-cache and skipped. Delete that folder to download everything fresh.
 * Uses only Node built-ins (Node 18+ fetch).
 */
import * as fs from 'fs';
import * as path from 'path';
import { BBOX, OVERPASS_BBOX } from './bbox';

const ROOT = process.cwd();
const OUT_MAIN = path.join(ROOT, 'scripts', 'data', 'karachi_raw.geojson');
const OUT_STREETS = path.join(ROOT, 'scripts', 'data', 'karachi_streets.json');
const OUT_PLACES = path.join(ROOT, 'scripts', 'data', 'karachi_places.json');
const OUT_RESTRICTIONS = path.join(ROOT, 'scripts', 'data', 'karachi_restrictions.json');
const OUT_SIGNALS = path.join(ROOT, 'scripts', 'data', 'karachi_signals.json');
// Each finished street part is saved here, so a re-run skips the parts that already downloaded
const CACHE_DIR = path.join(ROOT, 'scripts', 'data', '.osm-cache');
const WAIT_PER_TRY_MS = 270_000;

const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const MAIN_QUERY = (b: string) => `[out:json][timeout:240];
( way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|unclassified)$"](${b}); );
out geom;`;

// Galiyan: residential streets, small roads and service roads (not parking aisles / driveways)
const STREETS_QUERY = (b: string) => `[out:json][timeout:240];
(
  way["highway"~"^(residential|living_street|unclassified|road|tertiary|tertiary_link)$"](${b});
  way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through)$"](${b});
);
out skel geom;`;

// Karachi areas, named land use, amenities, landmarks, bridges and junctions
const NAMED_TAG = '[~"^(name|name:en|name:ur|alt_name|old_name|short_name)$"~"."]';
const PLACES_QUERY = (b: string) => `[out:json][timeout:240];
(
  nwr["place"~"^(city|town|suburb|quarter|neighbourhood|city_block|village|hamlet|locality|isolated_dwelling)$"]${NAMED_TAG}(${b});
  nwr["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"]${NAMED_TAG}(${b});
  nwr["landuse"~"^(residential|commercial|industrial)$"]${NAMED_TAG}(${b});
  nwr["amenity"~"^(university|college|school|hospital|clinic|marketplace|place_of_worship|bus_station|station|ferry_terminal|stadium)$"]${NAMED_TAG}(${b});
  nwr["building"~"^(university|college|school|hospital|clinic)$"]${NAMED_TAG}(${b});
  nwr["shop"~"^(mall|department_store|supermarket)$"]${NAMED_TAG}(${b});
  nwr["leisure"~"^(park|stadium|water_park|golf_course|sports_centre|nature_reserve)$"]${NAMED_TAG}(${b});
  nwr["historic"]${NAMED_TAG}(${b});
  nwr["aeroway"~"^(airport|aerodrome|terminal)$"]${NAMED_TAG}(${b});
  nwr["railway"="station"]${NAMED_TAG}(${b});
  nwr["natural"="beach"]${NAMED_TAG}(${b});
  nwr["tourism"~"^(attraction|museum|zoo|theme_park|viewpoint|aquarium)$"]${NAMED_TAG}(${b});
  nwr["junction"~"^(roundabout|circular)$"]${NAMED_TAG}(${b});
  way["highway"="mini_roundabout"]${NAMED_TAG}(${b});
  way["bridge"]${NAMED_TAG}(${b});
  way["bridge:name"]${NAMED_TAG}(${b});
);
out tags center bb;`;

const CITY_BLOCKS_QUERY = (b: string) => `[out:json][timeout:120];
nwr["place"="city_block"]${NAMED_TAG}(${b});
out tags center bb;`;

// Turn restrictions mapped in OpenStreetMap (relations: from way, via node, to way)
const RESTRICTIONS_QUERY = (b: string) => `[out:json][timeout:240];
relation["type"="restriction"](${b});
out geom;`;

const SIGNALS_QUERY = (b: string) => `[out:json][timeout:240];
node["highway"="traffic_signals"](${b});
out skel;`;

interface OverpassMember {
  type: string;
  ref: number;
  role: string;
  lat?: number;
  lon?: number;
}

interface OverpassWay {
  members?: OverpassMember[];
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number } | null>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

const isWayWithGeometry = (e: OverpassWay) => e.type === 'way' && Array.isArray(e.geometry);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function splitBbox(rows = 2, columns = 2): Array<[number, number, number, number]> {
  const { south, west, north, east } = BBOX;
  const tiles: Array<[number, number, number, number]> = [];
  for (let row = 0; row < rows; row++) {
    const tileSouth = south + ((north - south) * row) / rows;
    const tileNorth = south + ((north - south) * (row + 1)) / rows;
    for (let column = 0; column < columns; column++) {
      const tileWest = west + ((east - west) * column) / columns;
      const tileEast = west + ((east - west) * (column + 1)) / columns;
      tiles.push([tileSouth, tileWest, tileNorth, tileEast]);
    }
  }
  return tiles;
}

let preferred = 0; // the last server that answered is asked first next time

async function overpass(query: string, label: string, keep: (e: OverpassWay) => boolean = isWayWithGeometry): Promise<OverpassWay[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
  const idx = (preferred + attempt) % ENDPOINTS.length;
  const url = ENDPOINTS[idx];
  const host = new URL(url).host;
  process.stdout.write(`  ${label}: asking ${host} ... `);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'RaastaTrafficPredictorSimulator/0.1 (+https://github.com/ArmaanAkhtar/RAASTA--TrafficPredictorSimulator)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(WAIT_PER_TRY_MS),
    });
    if (!res.ok) {
      console.log(`HTTP ${res.status}, trying the next server`);
      continue;
    }
    const data = (await res.json()) as { elements?: OverpassWay[]; remark?: string };
    if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
      console.log(`server error (${data.remark.slice(0, 80)}), trying the next server`);
      continue;
    }
    const ways = (data.elements ?? []).filter(keep);
    console.log(`${ways.length} items`);
    preferred = idx;
    return ways;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(/abort|timeout/i.test(msg) ? 'no answer within 4.5 min' : `failed (${msg})`);
  }
  if (attempt === 0) console.log('  retrying once on another Overpass server');
  }
  throw new Error(`Could not download ${label} after one retry. Check the internet connection and try again in a few minutes.`);
}

function logFileSize(file: string): string {
  return `${(fs.statSync(file).size / 1e6).toFixed(2)} MB`;
}

const coords = (w: OverpassWay): Array<[number, number]> =>
  (w.geometry ?? []).filter((g): g is { lat: number; lon: number } => g !== null).map((g) => [g.lon, g.lat]);

async function fetchMain() {
  console.log('\n1/4  Main roads, slip roads and U-turn cuts');
  const ways = await overpass(MAIN_QUERY(OVERPASS_BBOX), 'main roads');
  // Same shape as an overpass-turbo GeoJSON export (tags flattened into properties)
  const features = ways
    .map((w) => ({ w, line: coords(w) }))
    .filter(({ line }) => line.length >= 2)
    .map(({ w, line }) => ({
      type: 'Feature',
      id: `way/${w.id}`,
      properties: { '@id': `way/${w.id}`, ...(w.tags ?? {}) },
      geometry: { type: 'LineString', coordinates: line },
    }));
  fs.mkdirSync(path.dirname(OUT_MAIN), { recursive: true });
  fs.writeFileSync(OUT_MAIN, JSON.stringify({ type: 'FeatureCollection', features }));
  const links = ways.filter((way) => String(way.tags?.highway ?? '').endsWith('_link')).length;
  console.log(`  wrote ${features.length} ways (${links} slip roads), ${logFileSize(OUT_MAIN)} -> ${path.relative(ROOT, OUT_MAIN)}`);
}

async function fetchStreets() {
  console.log('\n2/4  Every street and gali (in 4 parts so the server does not time out)');
  const tiles = splitBbox();
  const seen = new Set<number>();
  const ways: number[][] = [];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (let i = 0; i < tiles.length; i++) {
    const cacheFile = path.join(CACHE_DIR, `streets-${OVERPASS_BBOX.replaceAll(',', '-')}-${i + 1}.json`);
    let list: OverpassWay[];
    if (fs.existsSync(cacheFile)) {
      list = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as OverpassWay[];
      console.log(`  streets part ${i + 1}/4: already downloaded (${list.length} ways)`);
    } else {
      list = await overpass(STREETS_QUERY(tiles[i].join(',')), `streets part ${i + 1}/4`);
      fs.writeFileSync(cacheFile, JSON.stringify(list));
      if (i < tiles.length - 1) await sleep(3000); // be polite to the free server
    }
    for (const way of list) {
      if (seen.has(way.id)) continue; // ways crossing a tile edge come twice
      seen.add(way.id);
      const line = coords(way);
      if (line.length < 2) continue;
      // flat [lon, lat, lon, lat, ...] with ~10 cm precision, keeps the file small
      ways.push(line.flatMap(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]));
    }
  }
  const namedStreets = await fetchNamedStreets(tiles);
  fs.writeFileSync(OUT_STREETS, JSON.stringify({ v: 2, ways, namedStreets }));
  const mb = fs.statSync(OUT_STREETS).size / 1e6;
  console.log(`  wrote ${ways.length} streets and ${namedStreets.length} named streets (${mb.toFixed(2)} MB) -> ${path.relative(ROOT, OUT_STREETS)}`);
}

async function fetchNamedStreets(tiles: Array<[number, number, number, number]>) {
  const seen = new Set<number>();
  const namedStreets: Array<{ id: number; name: string; center: [number, number]; tags: Record<string, string> }> = [];
  for (let i = 0; i < tiles.length; i++) {
    const cacheFile = path.join(CACHE_DIR, `named-streets-v1-${OVERPASS_BBOX.replaceAll(',', '-')}-${i + 1}.json`);
    let list: OverpassWay[];
    if (fs.existsSync(cacheFile)) {
      list = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as OverpassWay[];
      console.log(`  named streets part ${i + 1}/${tiles.length}: cached (${list.length} ways)`);
    } else {
      const tile = tiles[i].join(',');
      const query = `[out:json][timeout:240];
(
  way["highway"~"^(residential|living_street|unclassified|road|tertiary|tertiary_link)$"]${NAMED_TAG}(${tile});
  way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through)$"]${NAMED_TAG}(${tile});
);
out tags center;`;
      list = await overpass(query, `named streets part ${i + 1}/${tiles.length}`, (element) =>
        element.type === 'way' && !!(element.tags?.name || element.tags?.['name:en'] || element.tags?.['name:ur']),
      );
      fs.writeFileSync(cacheFile, JSON.stringify(list));
      if (i < tiles.length - 1) await sleep(3000);
    }
    for (const way of list) {
      if (seen.has(way.id) || !way.center) continue;
      seen.add(way.id);
      const tags = way.tags ?? {};
      const keepTags = ['name', 'name:en', 'name:ur', 'alt_name', 'old_name', 'short_name', 'loc_name', 'official_name', 'highway'];
      const namedTags: Record<string, string> = {};
      for (const key of keepTags) if (tags[key]) namedTags[key] = tags[key];
      namedStreets.push({
        id: way.id,
        name: tags['name:en'] ?? tags.name ?? tags['name:ur'] ?? '',
        center: [Math.round(way.center.lon * 1e6) / 1e6, Math.round(way.center.lat * 1e6) / 1e6],
        tags: namedTags,
      });
    }
  }
  return namedStreets;
}

async function fetchPlaces() {
  console.log('\n3/4  Areas and landmarks (in 16 parts)');
  const seen = new Set<string>();
  const list: OverpassWay[] = [];
  const tiles = splitBbox(4, 4);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (let i = 0; i < tiles.length; i++) {
    const cacheFile = path.join(CACHE_DIR, `places-v3-${OVERPASS_BBOX.replaceAll(',', '-')}-${i + 1}.json`);
    let part: OverpassWay[];
    if (fs.existsSync(cacheFile)) {
      part = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as OverpassWay[];
      console.log(`  places part ${i + 1}/${tiles.length}: already downloaded (${part.length} items)`);
    } else {
      part = await overpass(
        PLACES_QUERY(tiles[i].join(',')),
        `places part ${i + 1}/${tiles.length}`,
        (e) => !!e.tags?.name || !!e.tags?.['name:en'] || !!e.tags?.['name:ur'] ||
          !!e.tags?.alt_name || !!e.tags?.['bridge:name'],
      );
      fs.writeFileSync(cacheFile, JSON.stringify(part));
      if (i < tiles.length - 1) await sleep(3000);
    }
    for (const element of part) {
      const key = `${element.type}/${element.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(element);
    }
    if (i < tiles.length - 1) await sleep(3000);
  }
  const supplementalTiles = splitBbox(2, 2);
  const knownIds = new Set(list.map((element) => `${element.type}/${element.id}`));
  for (let i = 0; i < supplementalTiles.length; i++) {
    const cacheFile = path.join(CACHE_DIR, `city-blocks-v1-${OVERPASS_BBOX.replaceAll(',', '-')}-${i + 1}.json`);
    let part: OverpassWay[];
    if (fs.existsSync(cacheFile)) {
      part = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as OverpassWay[];
      console.log(`  city blocks part ${i + 1}/${supplementalTiles.length}: cached (${part.length} items)`);
    } else {
      part = await overpass(
        CITY_BLOCKS_QUERY(supplementalTiles[i].join(',')),
        `city blocks part ${i + 1}/${supplementalTiles.length}`,
        (element) => !!element.tags?.name || !!element.tags?.['name:en'] || !!element.tags?.['name:ur'],
      );
      fs.writeFileSync(cacheFile, JSON.stringify(part));
      if (i < supplementalTiles.length - 1) await sleep(3000);
    }
    for (const element of part) {
      const key = `${element.type}/${element.id}`;
      if (knownIds.has(key)) continue;
      knownIds.add(key);
      list.push(element);
    }
  }
  const places = list
    .map((e) => {
      const lat = e.lat ?? e.center?.lat ?? (e.bounds ? (e.bounds.minlat + e.bounds.maxlat) / 2 : undefined);
      const lon = e.lon ?? e.center?.lon ?? (e.bounds ? (e.bounds.minlon + e.bounds.maxlon) / 2 : undefined);
      const t = e.tags ?? {};
      if (lat === undefined || lon === undefined) return null;
      const keepTags = [
        'name', 'name:en', 'name:ur', 'alt_name', 'old_name', 'short_name', 'loc_name', 'official_name',
        'place', 'boundary', 'admin_level', 'landuse', 'tourism', 'amenity', 'shop', 'leisure', 'historic',
        'aeroway', 'railway', 'public_transport', 'station', 'natural', 'highway', 'junction', 'bridge', 'bridge:name', 'building',
      ];
      const tags: Record<string, string> = {};
      for (const k of keepTags) if (t[k]) tags[k] = t[k];
      return {
        id: e.id,
        osmType: e.type,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        bounds: e.bounds,
        tags,
      };
    })
    .filter((p) => p !== null);
  fs.writeFileSync(OUT_PLACES, JSON.stringify({ v: 1, places }));
  console.log(`  wrote ${places.length} places, ${logFileSize(OUT_PLACES)} -> ${path.relative(ROOT, OUT_PLACES)}`);
}

async function fetchRestrictions() {
  console.log('\n4/4  Turn restrictions and traffic lights');
  const list = await overpass(RESTRICTIONS_QUERY(OVERPASS_BBOX), 'turn restrictions', (e) => e.type === 'relation');
  const items: Array<{ r: string; from: number; to: number; via: [number, number] }> = [];
  for (const rel of list) {
    const r = rel.tags?.restriction ?? rel.tags?.['restriction:motorcar'] ?? '';
    const members = rel.members ?? [];
    const from = members.find((m) => m.role === 'from' && m.type === 'way');
    const to = members.find((m) => m.role === 'to' && m.type === 'way');
    const via = members.find((m) => m.role === 'via' && m.type === 'node');
    // only the common "from way, via node, to way" form (via-way restrictions are rare and skipped)
    if (!r || !from || !to || !via || via.lat === undefined || via.lon === undefined) continue;
    items.push({ r, from: from.ref, to: to.ref, via: [via.lon, via.lat] });
  }
  fs.writeFileSync(OUT_RESTRICTIONS, JSON.stringify({ v: 1, items }));
  console.log(`  wrote ${items.length} turn restrictions, ${logFileSize(OUT_RESTRICTIONS)} -> ${path.relative(ROOT, OUT_RESTRICTIONS)}`);

  await sleep(3000);
  const nodes = await overpass(SIGNALS_QUERY(OVERPASS_BBOX), 'traffic lights', (e) => e.type === 'node');
  const signals = nodes
    .filter((n) => n.lat !== undefined && n.lon !== undefined)
    .map((n) => [Math.round((n.lon ?? 0) * 1e6) / 1e6, Math.round((n.lat ?? 0) * 1e6) / 1e6]);
  fs.writeFileSync(OUT_SIGNALS, JSON.stringify({ v: 1, signals }));
  console.log(`  wrote ${signals.length} traffic lights, ${logFileSize(OUT_SIGNALS)} -> ${path.relative(ROOT, OUT_SIGNALS)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = ['--main-only', '--streets-only', '--places-only', '--restrictions-only'].find((a) => args.includes(a));
  if (!only || only === '--main-only') await fetchMain();
  if (!only || only === '--streets-only') await fetchStreets();
  if (!only || only === '--places-only') await fetchPlaces();
  if (!only || only === '--restrictions-only') await fetchRestrictions();
  console.log('\nDone. Run build-roads.ts, build-streets.ts, build-graph.ts, build-places.ts, then build-cameras.ts with npx tsx.');
}

main().catch((err) => {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
