/**
 * scripts/build-cameras.ts
 * Run: npx tsx scripts/build-cameras.ts      (after scripts/build-roads.ts)
 * Writes public/data/cameras.json: traffic cameras per road, for the "live view" feature.
 *
 * WHERE THE NUMBERS COME FROM (no official per-camera list is public):
 *  - Reported e-challan camera zones per road (minimum counts + named spots), challandekhao.com, 2025:
 *      Shahrah-e-Faisal 12+, DHA/Clifton 10+, Lyari Expressway 8+, University Road 6+,
 *      M.A. Jinnah Road 5+, Korangi Road 5+, Rashid Minhas Road 4+
 *  - Karachi Safe City Phase I (Dawn, 2024; ~1,300 cameras on 300 poles): live poles at
 *    Shahrah-e-Faisal, Expo Centre, Airport surroundings, Civic Centre; Red Zone + airport corridor.
 * Named spots use approximate coordinates and are snapped to the road; the remaining cameras
 * on a road are spread evenly along it. Replace with the official list when Sindh Safe City shares it.
 *
 * videoSrc is empty: the live feeds need access from the Sindh Government (Safe City Authority).
 */
import * as fs from 'fs';
import * as path from 'path';
import { projectLatLon } from './bbox';

type Pt = [number, number];

const ROOT = process.cwd();
const ROADS_FILE = path.join(ROOT, 'public', 'data', 'roads.geojson');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'cameras.json');

const ECHALLAN = 'Reported e-challan camera zone (2025)';
const SAFE_CITY = 'Karachi Safe City Phase I coverage';

interface Plan {
  roadId: string;
  count: number;
  source: string;
  spots: Array<[name: string, lat: number, lon: number]>;
}

const PLANS: Plan[] = [
  {
    roadId: 'shahrah-e-faisal', count: 12, source: `${ECHALLAN} · ${SAFE_CITY}`,
    spots: [
      ['Metropole', 24.8486, 67.0305], ['FTC', 24.8580, 67.0560], ['Nursery', 24.8652, 67.0740],
      ['PECHS / Tariq Road junction', 24.8705, 67.0800], ['Karsaz', 24.8790, 67.0930],
      ['Drigh Road', 24.8848, 67.1200], ['Star Gate (Airport approach)', 24.8890, 67.1520],
      ['Malir Halt', 24.8960, 67.1980],
    ],
  },
  {
    roadId: 'university-road', count: 6, source: `${ECHALLAN} · ${SAFE_CITY}`,
    spots: [
      ['Civic Centre', 24.9016, 67.0716], ['Hassan Square / Expo Centre', 24.9035, 67.0781],
      ['NIPA Chowrangi', 24.9172, 67.0970], ['Samama', 24.9236, 67.1237], ['Safoora Chowk', 24.9327, 67.1374],
    ],
  },
  { roadId: 'lyari-expressway', count: 8, source: ECHALLAN, spots: [['Sohrab Goth', 24.9470, 67.0870], ['Mauripur Road', 24.8660, 66.9810]] },
  {
    roadId: 'm-a-jinnah-road', count: 5, source: ECHALLAN,
    spots: [['Tower', 24.8491, 66.9967], ['Jubilee Market', 24.8600, 67.0120], ['Regal Chowk', 24.8597, 67.0222]],
  },
  { roadId: 'rashid-minhas-road', count: 4, source: ECHALLAN, spots: [['Karsaz end', 24.8830, 67.0950], ['Johar Mor', 24.9020, 67.1140]] },
  { roadId: 'korangi-road', count: 5, source: ECHALLAN, spots: [['Korangi Crossing', 24.8326, 67.1080], ['Bilal Chowrangi', 24.8400, 67.0820]] },
  // DHA / Clifton (10+ reported): Khayaban-e-Shaheen, Khayaban-e-Ittehad, Clifton underpass, Sea View
  { roadId: 'khayaban-e-shaheen', count: 3, source: ECHALLAN, spots: [] },
  { roadId: 'khayaban-e-ittehad', count: 3, source: ECHALLAN, spots: [] },
  { roadId: 'clifton-bridge', count: 1, source: ECHALLAN, spots: [['Clifton underpass / bridge', 24.8290, 67.0300]] },
  { roadId: 'sunset-boulevard', count: 1, source: ECHALLAN, spots: [] },
  { roadId: 'khayaban-e-saadi', count: 2, source: ECHALLAN, spots: [['Sea View', 24.7980, 67.0430]] },
  // Safe City: Red Zone (financial district) and the airport corridor
  { roadId: 'i-i-chundrigar-road', count: 3, source: SAFE_CITY, spots: [] },
  { roadId: 'airport-road', count: 2, source: SAFE_CITY, spots: [['Airport surroundings', 24.9030, 67.1600]] },
];

const MIN_GAP_M = 500; // evenly spread cameras keep at least this far from named ones

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPt = (v: unknown): v is Pt => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface RoadInfo {
  id: string;
  name: string;
  points: Pt[];
}

function main(): void {
  if (!fs.existsSync(ROADS_FILE)) {
    console.error('public/data/roads.geojson not found. Run: npx tsx scripts/build-roads.ts');
    process.exit(1);
  }
  const data: unknown = JSON.parse(fs.readFileSync(ROADS_FILE, 'utf8'));
  if (!isRecord(data) || !Array.isArray(data.features)) process.exit(1);
  const roads = new Map<string, RoadInfo>();
  for (const f of data.features as unknown[]) {
    if (!isRecord(f) || !isRecord(f.properties) || !isRecord(f.geometry)) continue;
    const { id, name } = f.properties;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    const points: Pt[] = [];
    const coords = f.geometry.coordinates;
    if (Array.isArray(coords)) for (const l of coords) if (Array.isArray(l)) for (const p of l) if (isPt(p)) points.push([p[0], p[1]]);
    roads.set(id, { id, name, points });
  }

  const out: Array<Record<string, unknown>> = [];
  let n = 0;
  for (const plan of PLANS) {
    const road = roads.get(plan.roadId);
    if (!road || road.points.length < 2) {
      console.log(`  MISSING road ${plan.roadId}`);
      continue;
    }
    const placed: Array<{ spot: string; p: Pt }> = [];

    // Named spots, snapped to the nearest point of the road
    for (const [spot, lat, lon] of plan.spots.slice(0, plan.count)) {
      const target = projectLatLon(lat, lon);
      let best = road.points[0];
      for (const p of road.points) if (dist(p, target) < dist(best, target)) best = p;
      placed.push({ spot, p: best });
    }

    // The rest: evenly along the road's long direction, away from cameras already placed
    const xs = road.points.map((p) => p[0]);
    const ys = road.points.map((p) => p[1]);
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const sorted = [...road.points].sort((a, b) => (alongX ? a[0] - b[0] : a[1] - b[1]));
    const missing = plan.count - placed.length;
    let section = 1;
    for (let k = 1; k <= missing * 3 && placed.length < plan.count; k++) {
      const share = ((k - 0.5) / (missing * 3)) % 1;
      const p = sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
      if (placed.some((c) => dist(c.p, p) < MIN_GAP_M)) continue;
      placed.push({ spot: `${road.name} camera ${section++}`, p });
    }
    // Short roads: allow closer spacing if still short
    for (let k = 0; placed.length < plan.count && k < sorted.length; k += Math.max(1, Math.floor(sorted.length / plan.count))) {
      placed.push({ spot: `${road.name} camera ${section++}`, p: sorted[k] });
    }

    for (const c of placed) {
      n++;
      out.push({
        id: `cam-${String(n).padStart(3, '0')}`,
        name: c.spot,
        roadId: road.id,
        roadName: road.name,
        position: [Math.round(c.p[0] * 10) / 10, Math.round(c.p[1] * 10) / 10],
        videoSrc: '', // set when Sindh Safe City grants access to the live feed
        source: plan.source,
      });
    }
    console.log(`  ${road.name.padEnd(24)} ${placed.length} cameras  (${plan.spots.length} named spots)`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${out.length} cameras (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB) to public/data/cameras.json\n`);
}

main();
