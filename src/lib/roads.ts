// src/lib/roads.ts
// Loads the cleaned roads file produced by scripts/build-roads.ts.
import type { Pt, Road, RoadType } from './types';

const ROADS_URL = '/data/roads.geojson';
const ROAD_TYPES: readonly RoadType[] = ['highway', 'arterial', 'local'];

// ---------- runtime type guards (no `any`) ----------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPt(v: unknown): v is Pt {
  return Array.isArray(v) && v.length >= 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1]);
}

function isRoadType(v: unknown): v is RoadType {
  return typeof v === 'string' && (ROAD_TYPES as readonly string[]).includes(v);
}

function parseSegments(geometry: unknown): Pt[][] {
  if (!isRecord(geometry)) return [];
  const coords = geometry.coordinates;
  if (!Array.isArray(coords)) return [];

  let lines: unknown[] = [];
  if (geometry.type === 'MultiLineString') lines = coords;
  else if (geometry.type === 'LineString') lines = [coords];

  const segments: Pt[][] = [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    const pts: Pt[] = [];
    for (const p of line) if (isPt(p)) pts.push([p[0], p[1]]);
    if (pts.length >= 2) segments.push(pts);
  }
  return segments;
}

function parseRoad(feature: unknown): Road | null {
  if (!isRecord(feature) || !isRecord(feature.properties)) return null;
  const { id, name, type, lengthM, center } = feature.properties;
  if (
    typeof id !== 'string' ||
    id === '' ||
    typeof name !== 'string' ||
    !isRoadType(type) ||
    !isFiniteNumber(lengthM) ||
    !isPt(center)
  ) {
    return null;
  }
  const segments = parseSegments(feature.geometry);
  if (segments.length === 0) return null;
  return { id, name, type, segments, lengthM, center: [center[0], center[1]] };
}

/** Fetches /data/roads.geojson and returns validated roads. */
export async function loadRoads(): Promise<Road[]> {
  let res: Response;
  try {
    res = await fetch(ROADS_URL);
  } catch (err) {
    throw new Error(`Could not fetch ${ROADS_URL}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    throw new Error(
      `${ROADS_URL} not found (HTTP ${res.status}). Generate it with: npx tsx scripts/build-roads.ts`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${ROADS_URL} is not valid JSON. Re-run: npx tsx scripts/build-roads.ts`);
  }

  if (!isRecord(data) || !Array.isArray(data.features)) {
    throw new Error(`${ROADS_URL} is not a GeoJSON FeatureCollection.`);
  }

  const features: unknown[] = data.features;
  const roads: Road[] = [];
  let skipped = 0;
  for (const f of features) {
    const road = parseRoad(f);
    if (road) roads.push(road);
    else skipped++;
  }

  if (skipped > 0) console.warn(`loadRoads: skipped ${skipped} invalid feature(s).`);
  if (roads.length === 0) throw new Error(`${ROADS_URL} contains no valid roads.`);
  return roads;
}
