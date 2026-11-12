/**
 * scripts/build-roads.ts
 *
 * Converts the raw Overpass export into a clean, small roads file for the app.
 *   Run:    npx tsx scripts/build-roads.ts
 *   Input:  scripts/data/karachi_raw.geojson   (lon/lat, exported from overpass-turbo.eu)
 *   Output: public/data/roads.geojson          (local metres, one MultiLineString per named road)
 *
 * Uses only Node built-ins (fs, path). Run it from the project root.
 */
import * as fs from 'fs';
import * as path from 'path';
import { projectLatLon } from './bbox';

type Pt = [number, number];
type RoadType = 'highway' | 'arterial' | 'local';

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const ROOT = process.cwd();
const IN_FILE = path.join(ROOT, 'scripts', 'data', 'karachi_raw.geojson');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'roads.geojson');

const SIMPLIFY_TOLERANCE_M = 8;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

/** OSM highway value -> rank. *_link values are not here, so they are dropped. */
const HIGHWAY_RANK = new Map<string, number>([
  ['motorway', 3],
  ['trunk', 3],
  ['primary', 2],
  ['secondary', 1],
]);
const RANK_TO_TYPE: Record<number, RoadType> = { 3: 'highway', 2: 'arterial', 1: 'local' };

const KEY_ROADS = [
  'Shahrah-e-Faisal',
  'University Road',
  'M.A. Jinnah Road',
  'Rashid Minhas Road',
  'Shahrah-e-Pakistan',
  'Korangi Road',
  'Lyari Expressway',
  'I.I. Chundrigar Road',
];

/**
 * Spelling variants -> one canonical name.
 * Key = name in lowercase with everything except a-z and 0-9 removed (see canonKey).
 * If the stats say a key road is MISSING, look at the suggestions, add the
 * variant here and run the script again.
 */
const ALIASES: Record<string, string> = {
  // Shahrah-e-Faisal
  shahrahefaisal: 'Shahrah-e-Faisal',
  sharahefaisal: 'Shahrah-e-Faisal',
  shahraefaisal: 'Shahrah-e-Faisal',
  sharaefaisal: 'Shahrah-e-Faisal',
  shahrahifaisal: 'Shahrah-e-Faisal',
  shahraheefaisal: 'Shahrah-e-Faisal',
  faisalroad: 'Shahrah-e-Faisal',
  shahrahefaisaldrighroad: 'Shahrah-e-Faisal',
  shahrahefaisalscandalpointroad: 'Shahrah-e-Faisal',
  shahrahefaisalshahrahefaisaldrighroad: 'Shahrah-e-Faisal',
  sharaefaisaldrighroad: 'Shahrah-e-Faisal',
  // University Road
  universityroad: 'University Road',
  universityrd: 'University Road',
  // M.A. Jinnah Road
  majinnahroad: 'M.A. Jinnah Road',
  majinnahrd: 'M.A. Jinnah Road',
  mohammadalijinnahroad: 'M.A. Jinnah Road',
  muhammadalijinnahroad: 'M.A. Jinnah Road',
  mohammedalijinnahroad: 'M.A. Jinnah Road',
  // Rashid Minhas Road
  rashidminhasroad: 'Rashid Minhas Road',
  rashidminhasrd: 'Rashid Minhas Road',
  shaheedrashidminhasroad: 'Rashid Minhas Road',
  // Shahrah-e-Pakistan
  shahrahepakistan: 'Shahrah-e-Pakistan',
  sharahepakistan: 'Shahrah-e-Pakistan',
  shahraepakistan: 'Shahrah-e-Pakistan',
  sharaepakistan: 'Shahrah-e-Pakistan',
  // Korangi Road
  korangiroad: 'Korangi Road',
  korangird: 'Korangi Road',
  // Lyari Expressway
  lyariexpressway: 'Lyari Expressway',
  lyariexpresswaynorthbound: 'Lyari Expressway',
  lyariexpresswaysouthbound: 'Lyari Expressway',
  // I.I. Chundrigar Road
  iichundrigarroad: 'I.I. Chundrigar Road',
  iichundrigarrd: 'I.I. Chundrigar Road',
  ibrahimismailchundrigarroad: 'I.I. Chundrigar Road',
};

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPosition(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function canonKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

function project([lon, lat]: Pt): Pt {
  return projectLatLon(lat, lon);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function lineLength(line: Pt[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1], line[i]);
  return total;
}

/** Distance from p to the segment a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker, iterative (no recursion depth issues on long roads). */
function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [s, e] = range;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Round to 1 decimal and remove consecutive duplicate points. */
function roundLine(line: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const [x, y] of line) {
    const p: Pt = [r1(x), r1(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

function toLine(v: unknown): Pt[] | null {
  if (!Array.isArray(v)) return null;
  const out: Pt[] = [];
  for (const p of v) if (isPosition(p)) out.push([p[0], p[1]]);
  return out.length >= 2 ? out : null;
}

/** Pull lon/lat lines out of any line-like geometry (closed ways may come as Polygon). */
function extractLines(geometry: unknown): Pt[][] {
  if (!isRecord(geometry)) return [];
  const coords = geometry.coordinates;
  if (!Array.isArray(coords)) return [];
  let raw: unknown[] = [];
  if (geometry.type === 'LineString') raw = [coords];
  else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') raw = coords;
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of coords) if (Array.isArray(poly)) raw.push(...poly);
  }
  const lines: Pt[][] = [];
  for (const l of raw) {
    const line = toLine(l);
    if (line) lines.push(line);
  }
  return lines;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
interface Group {
  name: string;
  rank: number;
  lines: Pt[][];
}

interface OutRoad {
  id: string;
  name: string;
  type: RoadType;
  lengthM: number;
  center: Pt;
  segments: Pt[][];
}

function main(): void {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`\nInput file not found:\n  ${IN_FILE}`);
    console.error('Export GeoJSON from overpass-turbo.eu and save it there, then run again.\n');
    process.exit(1);
  }

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  } catch (err) {
    console.error('Could not parse karachi_raw.geojson as JSON:', err);
    process.exit(1);
  }

  if (!isRecord(data) || !Array.isArray(data.features)) {
    console.error('karachi_raw.geojson is not a GeoJSON FeatureCollection.');
    process.exit(1);
  }

  const features: unknown[] = data.features;
  const groups = new Map<string, Group>();
  let unnamedCount = 0;
  let droppedType = 0;
  let droppedUnnamed = 0;
  let droppedGeometry = 0;

  for (const f of features) {
    if (!isRecord(f)) continue;
    const props = isRecord(f.properties) ? f.properties : {};
    // Older overpass-turbo exports nest tags under properties.tags
    const tags = isRecord(props.tags) ? props.tags : props;

    const highway = str(tags.highway);
    const rank = highway ? HIGHWAY_RANK.get(highway) : undefined;
    if (rank === undefined) {
      droppedType++;
      continue;
    }

    const rawName = str(tags['name:en']) ?? str(tags.name) ?? str(tags.ref);
    let name: string;
    if (rawName) {
      const clean = normaliseName(rawName);
      name = ALIASES[canonKey(clean)] ?? clean;
    } else if (rank === 3) {
      unnamedCount++;
      name = `Unnamed Highway ${unnamedCount}`;
    } else {
      droppedUnnamed++;
      continue;
    }

    const lines: Pt[][] = [];
    for (const lonLat of extractLines(f.geometry)) {
      const local = lonLat.map(project);
      const clean = roundLine(simplify(local, SIMPLIFY_TOLERANCE_M));
      if (clean.length >= 2) lines.push(clean);
    }
    if (lines.length === 0) {
      droppedGeometry++;
      continue;
    }

    const existing = groups.get(name);
    if (existing) {
      existing.lines.push(...lines);
      existing.rank = Math.max(existing.rank, rank);
    } else {
      groups.set(name, { name, rank, lines });
    }
  }

  // Build output roads
  const usedIds = new Set<string>();
  const roads: OutRoad[] = [];
  for (const g of groups.values()) {
    let base = slugify(g.name) || 'road';
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    base = id;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lengthM = 0;
    for (const line of g.lines) {
      lengthM += lineLength(line);
      for (const [x, y] of line) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    roads.push({
      id,
      name: g.name,
      type: RANK_TO_TYPE[g.rank] ?? 'local',
      lengthM: Math.round(lengthM),
      center: [r1((minX + maxX) / 2), r1((minY + maxY) / 2)],
      segments: g.lines,
    });
  }
  roads.sort((a, b) => b.lengthM - a.lengthM);

  const out = {
    type: 'FeatureCollection',
    features: roads.map((r) => ({
      type: 'Feature',
      properties: { id: r.id, name: r.name, type: r.type, lengthM: r.lengthM, center: r.center },
      geometry: { type: 'MultiLineString', coordinates: r.segments },
    })),
  };

  const json = JSON.stringify(out);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, json, 'utf8');

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------
  const bytes = Buffer.byteLength(json, 'utf8');
  const totalKm = roads.reduce((s, r) => s + r.lengthM, 0) / 1000;
  const byType = (t: RoadType) => roads.filter((r) => r.type === t).length;

  console.log('\n=== build-roads: done ===');
  console.log(`Input features   : ${features.length}`);
  console.log(`Dropped          : ${droppedType} other types/links, ${droppedUnnamed} unnamed, ${droppedGeometry} bad geometry`);
  console.log(`Roads            : ${roads.length}  (highway ${byType('highway')}, arterial ${byType('arterial')}, local ${byType('local')})`);
  console.log(`Total length     : ${totalKm.toFixed(1)} km`);
  console.log(`File size        : ${(bytes / 1024).toFixed(0)} KB ${bytes > MAX_FILE_BYTES ? '  <-- OVER 3 MB, raise SIMPLIFY_TOLERANCE_M' : '(OK, under 3 MB)'}`);
  console.log(`Written to       : ${path.relative(ROOT, OUT_FILE)}`);

  console.log('\nTop 15 longest roads:');
  roads.slice(0, 15).forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(40)} ${(r.lengthM / 1000).toFixed(1).padStart(6)} km  ${r.type}`);
  });

  console.log('\nKey roads check:');
  let missing = 0;
  for (const key of KEY_ROADS) {
    const found = roads.find((r) => canonKey(r.name) === canonKey(key));
    if (found) {
      console.log(`  found    ${key.padEnd(24)} ${(found.lengthM / 1000).toFixed(1)} km`);
    } else {
      missing++;
      const words = key.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5);
      const similar = roads
        .filter((r) => words.some((w) => r.name.toLowerCase().includes(w)))
        .slice(0, 3)
        .map((r) => `"${r.name}"`);
      console.log(`  MISSING  ${key.padEnd(24)} ${similar.length ? `similar: ${similar.join(', ')}` : ''}`);
    }
  }
  if (missing > 0) {
    console.log('\nTip: if a similar name is listed, add it to ALIASES in this script and run again.');
  }
  console.log('');
}

main();
