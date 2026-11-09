/**
 * scripts/fetch-osm.ts
 * Run: npx tsx scripts/fetch-osm.ts            (needs internet, takes 1-5 minutes)
 *
 * Downloads Karachi from OpenStreetMap (Overpass API), so nobody has to use overpass-turbo by hand:
 *   1. scripts/data/karachi_raw.geojson   main roads + slip roads + U-turn cuts   (for build-roads + build-graph)
 *   2. scripts/data/karachi_streets.json  every street and gali                    (for build-streets + build-graph)
 *   3. scripts/data/karachi_places.json   areas, blocks / sectors and famous places (for build-places)
 *   4. scripts/data/karachi_restrictions.json  turn restrictions: no right turn, only straight on ... (for build-graph)
 *      scripts/data/karachi_signals.json       traffic lights (crossing a main road is only easy there)
 *
 * Then run:
 *   npx tsx scripts/build-roads.ts
 *   npx tsx scripts/build-graph.ts
 *   npx tsx scripts/build-streets.ts
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

const ROOT = process.cwd();
const OUT_MAIN = path.join(ROOT, 'scripts', 'data', 'karachi_raw.geojson');
const OUT_STREETS = path.join(ROOT, 'scripts', 'data', 'karachi_streets.json');
const OUT_PLACES = path.join(ROOT, 'scripts', 'data', 'karachi_places.json');
const OUT_RESTRICTIONS = path.join(ROOT, 'scripts', 'data', 'karachi_restrictions.json');
const OUT_SIGNALS = path.join(ROOT, 'scripts', 'data', 'karachi_signals.json');
// Each finished street part is saved here, so a re-run skips the parts that already downloaded
const CACHE_DIR = path.join(ROOT, 'scripts', 'data', '.osm-cache');
const WAIT_PER_TRY_MS = 120_000; // give up on a silent server after 2 minutes and ask the next one

// south, west, north, east
const BBOX: [number, number, number, number] = [24.8, 66.95, 25.02, 67.2];

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const MAIN_QUERY = (b: string) => `[out:json][timeout:180];
( way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|unclassified)$"](${b}); );
out geom;`;

// Galiyan: residential streets, small roads and service roads (not parking aisles / driveways)
const STREETS_QUERY = (b: string) => `[out:json][timeout:240];
(
  way["highway"~"^(residential|living_street|unclassified|road|tertiary|tertiary_link)$"](${b});
  way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through)$"](${b});
);
out skel geom;`;

// Areas (Gulshan, Nazimabad ...), their blocks / sectors, and famous places
const PLACES_QUERY = (b: string) => `[out:json][timeout:180];
(
  nwr["place"~"^(suburb|neighbourhood|quarter|town|village|city_block|locality|hamlet|isolated_dwelling)$"]["name"](${b});
  nwr["tourism"~"^(attraction|museum|zoo|theme_park|viewpoint|aquarium)$"]["name"](${b});
  nwr["amenity"~"^(university|college|hospital|marketplace|bus_station|stadium)$"]["name"](${b});
  nwr["shop"~"^(mall|department_store)$"]["name"](${b});
  nwr["leisure"~"^(park|stadium|water_park|golf_course|sports_centre)$"]["name"](${b});
  nwr["historic"]["name"](${b});
  nwr["aeroway"="aerodrome"]["name"](${b});
  nwr["railway"="station"]["name"](${b});
  nwr["amenity"="place_of_worship"]["name"~"Masjid|Mosque|Mazar|Cathedral|Church|Mandir|Temple",i]["building"](${b});
);
out tags center;`;

// Turn restrictions mapped in OpenStreetMap (relations: from way, via node, to way)
const RESTRICTIONS_QUERY = (b: string) => `[out:json][timeout:120];
relation["type"="restriction"](${b});
out geom;`;

const SIGNALS_QUERY = (b: string) => `[out:json][timeout:120];
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
}

const isWayWithGeometry = (e: OverpassWay) => e.type === 'way' && Array.isArray(e.geometry);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let preferred = 0; // the last server that answered is asked first next time

async function overpass(query: string, label: string, keep: (e: OverpassWay) => boolean = isWayWithGeometry): Promise<OverpassWay[]> {
  for (let round = 0; round < 3; round++) {
    const order = ENDPOINTS.map((_, i) => (preferred + i) % ENDPOINTS.length);
    for (const idx of order) {
      const url = ENDPOINTS[idx];
      const host = new URL(url).host;
      process.stdout.write(`  ${label}: asking ${host} ... `);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'raasta-build-script/1.0' },
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
        console.log(/abort|timeout/i.test(msg) ? 'no answer in 2 min, trying the next server' : `failed (${msg})`);
      }
    }
    console.log(`  all servers busy, waiting 30 s (round ${round + 1}/3)`);
    await sleep(30_000);
  }
  throw new Error(`Could not download ${label}. Check the internet connection and try again in a few minutes.`);
}

const coords = (w: OverpassWay): Array<[number, number]> =>
  (w.geometry ?? []).filter((g): g is { lat: number; lon: number } => g !== null).map((g) => [g.lon, g.lat]);

async function fetchMain() {
  console.log('\n1/4  Main roads, slip roads and U-turn cuts');
  const ways = await overpass(MAIN_QUERY(BBOX.join(',')), 'main roads');
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
  const links = features.filter((f) => String(f.properties.highway ?? '').endsWith('_link')).length;
  console.log(`  wrote ${features.length} ways (${links} slip roads) -> ${path.relative(ROOT, OUT_MAIN)}`);
}

async function fetchStreets() {
  console.log('\n2/4  Every street and gali (in 4 parts so the server does not time out)');
  const [s, w, n, e] = BBOX;
  const midLat = (s + n) / 2;
  const midLon = (w + e) / 2;
  const tiles: Array<[number, number, number, number]> = [
    [s, w, midLat, midLon],
    [s, midLon, midLat, e],
    [midLat, w, n, midLon],
    [midLat, midLon, n, e],
  ];
  const seen = new Set<number>();
  const ways: number[][] = [];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (let i = 0; i < tiles.length; i++) {
    const cacheFile = path.join(CACHE_DIR, `streets-${i + 1}.json`);
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
  fs.writeFileSync(OUT_STREETS, JSON.stringify({ v: 1, ways }));
  const mb = fs.statSync(OUT_STREETS).size / 1e6;
  console.log(`  wrote ${ways.length} streets (${mb.toFixed(1)} MB) -> ${path.relative(ROOT, OUT_STREETS)}`);
}

async function fetchPlaces() {
  console.log('\n3/4  Areas, blocks and famous places');
  const list = await overpass(PLACES_QUERY(BBOX.join(',')), 'places', (e) => !!e.tags?.name);
  const places = list
    .map((e) => {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      const t = e.tags ?? {};
      if (lat === undefined || lon === undefined) return null;
      // keep only the tags build-places.ts needs
      const keepTags = ['name', 'name:en', 'place', 'tourism', 'amenity', 'shop', 'leisure', 'historic', 'aeroway', 'railway'];
      const tags: Record<string, string> = {};
      for (const k of keepTags) if (t[k]) tags[k] = t[k];
      return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, tags };
    })
    .filter((p) => p !== null);
  fs.writeFileSync(OUT_PLACES, JSON.stringify({ v: 1, places }));
  console.log(`  wrote ${places.length} places -> ${path.relative(ROOT, OUT_PLACES)}`);
}

async function fetchRestrictions() {
  console.log('\n4/4  Turn restrictions and traffic lights');
  const list = await overpass(RESTRICTIONS_QUERY(BBOX.join(',')), 'turn restrictions', (e) => e.type === 'relation');
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
  console.log(`  wrote ${items.length} turn restrictions -> ${path.relative(ROOT, OUT_RESTRICTIONS)}`);

  await sleep(3000);
  const nodes = await overpass(SIGNALS_QUERY(BBOX.join(',')), 'traffic lights', (e) => e.type === 'node');
  const signals = nodes
    .filter((n) => n.lat !== undefined && n.lon !== undefined)
    .map((n) => [Math.round((n.lon ?? 0) * 1e6) / 1e6, Math.round((n.lat ?? 0) * 1e6) / 1e6]);
  fs.writeFileSync(OUT_SIGNALS, JSON.stringify({ v: 1, signals }));
  console.log(`  wrote ${signals.length} traffic lights -> ${path.relative(ROOT, OUT_SIGNALS)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = ['--main-only', '--streets-only', '--places-only', '--restrictions-only'].find((a) => args.includes(a));
  if (!only || only === '--main-only') await fetchMain();
  if (!only || only === '--streets-only') await fetchStreets();
  if (!only || only === '--places-only') await fetchPlaces();
  if (!only || only === '--restrictions-only') await fetchRestrictions();
  console.log('\nDone. Now run: npx tsx scripts/build-roads.ts, build-graph.ts, build-streets.ts, build-places.ts, build-cameras.ts');
}

main().catch((err) => {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
