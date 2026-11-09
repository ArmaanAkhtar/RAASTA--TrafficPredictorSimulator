/**
 * scripts/test-routing.ts
 * Run: npx tsx scripts/test-routing.ts
 * Builds the road graph and finds better routes for a few busy roads on Wednesday 16:00.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getGraph } from '../src/lib/graph';
import { predict } from '../src/lib/prediction';
import { findAltRoute } from '../src/lib/routing';
import type { Pt, Road, RoadType } from '../src/lib/types';

const ROADS_FILE = path.join(process.cwd(), 'public', 'data', 'roads.geojson');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isRoadType(v: unknown): v is RoadType {
  return v === 'highway' || v === 'arterial' || v === 'local';
}
function isPt(v: unknown): v is Pt {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';
}

function loadRoads(): Road[] {
  if (!fs.existsSync(ROADS_FILE)) {
    console.error('public/data/roads.geojson not found. Run: npx tsx scripts/build-roads.ts');
    process.exit(1);
  }
  const data: unknown = JSON.parse(fs.readFileSync(ROADS_FILE, 'utf8'));
  if (!isRecord(data) || !Array.isArray(data.features)) process.exit(1);
  const features: unknown[] = data.features;
  const roads: Road[] = [];
  for (const f of features) {
    if (!isRecord(f) || !isRecord(f.properties) || !isRecord(f.geometry)) continue;
    const { id, name, type, lengthM, center } = f.properties;
    if (typeof id !== 'string' || typeof name !== 'string' || !isRoadType(type)) continue;
    if (typeof lengthM !== 'number' || !isPt(center)) continue;
    const coords = f.geometry.coordinates;
    if (!Array.isArray(coords)) continue;
    const segments: Pt[][] = [];
    for (const line of coords) {
      if (!Array.isArray(line)) continue;
      const pts: Pt[] = [];
      for (const p of line) if (isPt(p)) pts.push([p[0], p[1]]);
      if (pts.length >= 2) segments.push(pts);
    }
    roads.push({ id, name, type, segments, lengthM, center: [center[0], center[1]] });
  }
  return roads;
}

function main(): void {
  const roads = loadRoads();

  // Graph stats
  let t0 = performance.now();
  const g = getGraph(roads);
  const buildMs = performance.now() - t0;

  // Connected components (how well roads join up)
  const comp = new Int32Array(g.nodes.length).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < g.nodes.length; s++) {
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const u = stack.pop();
      if (u === undefined) break;
      size++;
      for (const e of g.adj[u]) {
        if (comp[e.to] === -1) {
          comp[e.to] = id;
          stack.push(e.to);
        }
      }
    }
    sizes.push(size);
  }
  const largest = Math.max(...sizes);

  console.log('\n=== Road graph ===');
  console.log(`Nodes: ${g.nodes.length}   Edges: ${g.edgeCount}   Build: ${buildMs.toFixed(0)} ms (once, then cached)`);
  console.log(`Largest connected part: ${((largest / g.nodes.length) * 100).toFixed(1)}% of nodes (${sizes.length} parts)`);

  // Routes
  const time = { day: 3, hour: 16, minute: 0 }; // Wednesday 4:00 PM
  const names = ['Shahrah-e-Faisal', 'University Road', 'M.A. Jinnah Road', 'Korangi Road', 'Shahrah-e-Pakistan'];
  const nameOf = new Map(roads.map((r) => [r.id, r.name]));

  console.log('\n=== Better routes, Wednesday 4:00 PM ===');
  for (const name of names) {
    const road = roads.find((r) => r.name === name);
    if (!road) {
      console.log(`\n${name}: not found`);
      continue;
    }
    const p = predict(road, time, false);
    t0 = performance.now();
    const route = findAltRoute(roads, road.id, time, false);
    const ms = performance.now() - t0;

    console.log(`\n${name}  (now ${p.nowScore}, ${p.nowLevel}, jam next hour ${p.jamChanceNextHour}%)`);
    if (!route) {
      console.log(`  no alternative found   [${ms.toFixed(1)} ms]`);
      continue;
    }
    const via = route.roadIds
      .slice(0, 4)
      .map((id) => nameOf.get(id) ?? id)
      .join(' -> ');
    console.log(`  via:        ${via}`);
    console.log(`  distance:   ${route.distanceKm} km, ${route.minutes} min, ${route.path.length} points`);
    console.log(`  jam chance: ${route.jamChance}%   (main road: ${p.jamChanceNextHour}%)`);
    console.log(`  saves:      ${route.minutesSaved} min`);
    console.log(`  time:       ${ms.toFixed(1)} ms ${ms < 50 ? 'OK' : '<-- slower than 50 ms'}`);
  }
  console.log('');
}

main();
