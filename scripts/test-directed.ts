/**
 * scripts/test-directed.ts
 * Run: npx tsx scripts/test-directed.ts
 * Checks the directed graph: trips never drive a one-way the wrong way, and never "jump" between roads.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PLACES } from '../src/lib/places';
import { parseRoadGraph, parseRoadGraphBinary, setDirectedGraph } from '../src/lib/roadGraph';
import { findAltRoute, findTrip } from '../src/lib/routing';
import type { Pt, Road, RoadType } from '../src/lib/types';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isType = (v: unknown): v is RoadType => v === 'highway' || v === 'arterial' || v === 'local';
const isPt = (v: unknown): v is Pt => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';

const roadsJson: unknown = JSON.parse(fs.readFileSync(path.join('public', 'data', 'roads.geojson'), 'utf8'));
const roads: Road[] = [];
if (isRec(roadsJson) && Array.isArray(roadsJson.features)) {
  for (const f of roadsJson.features as unknown[]) {
    if (!isRec(f) || !isRec(f.properties) || !isRec(f.geometry)) continue;
    const { id, name, type, lengthM, center } = f.properties;
    if (typeof id !== 'string' || typeof name !== 'string' || !isType(type) || typeof lengthM !== 'number' || !isPt(center)) continue;
    const segs: Pt[][] = [];
    const c = f.geometry.coordinates;
    if (Array.isArray(c)) for (const l of c) if (Array.isArray(l)) segs.push(l.filter(isPt).map((p) => [p[0], p[1]] as Pt));
    roads.push({ id, name, type, segments: segs, lengthM, center: [center[0], center[1]] });
  }
}

const t0 = performance.now();
const binPath = path.join('public', 'data', 'road_graph.bin');
const g = fs.existsSync(binPath)
  ? (() => {
      const b = fs.readFileSync(binPath);
      return parseRoadGraphBinary(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    })()
  : parseRoadGraph(JSON.parse(fs.readFileSync(path.join('public', 'data', 'road_graph.json'), 'utf8')));
if (!g) throw new Error('bad road_graph.json');
setDirectedGraph(g);
const mainCount = g.main.reduce((a, b) => a + b, 0);
console.log(`\nGraph: ${g.nodes.length} nodes, main network ${mainCount}, parsed in ${(performance.now() - t0).toFixed(0)} ms`);

const nameOf = new Map(roads.map((r) => [r.id, r.name]));
const place = (n: string) => PLACES.find((p) => p.name === n)!.point;
const time = { day: 3, hour: 16, minute: 0 };

// A "jump" = two consecutive path points further apart than any real edge piece could be
const maxGap = (pts: Pt[]) => pts.slice(1).reduce((m, p, i) => Math.max(m, Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), 0);

for (const [a, b] of [['Gulshan-e-Iqbal', 'Clifton'], ['Clifton', 'Gulshan-e-Iqbal'], ['University of Karachi', 'Saddar'], ['Jinnah International Airport', 'DHA (Defence)'], ['Korangi', 'Gulistan-e-Jauhar']] as const) {
  console.log(`\n${a} -> ${b} (Wed 4 PM)`);
  for (const mode of ['time', 'petrol'] as const) {
    const s = performance.now();
    const r = findTrip(roads, place(a), place(b), time, false, mode);
    const ms = performance.now() - s;
    if (!r) { console.log(`  ${mode} no route`); continue; }
    const inner = r.path.slice(1, -1);
    console.log(`  ${mode.padEnd(6)} ${r.distanceKm} km ${r.minutes} min ${r.fuelLitres.toFixed(2)} L  biggest step ${maxGap(inner).toFixed(0)} m  [${ms.toFixed(0)} ms]  via ${r.roadIds.slice(0, 3).map((id) => nameOf.get(id)).join(' -> ')}`);
  }
}

console.log('\nCar vs Bike vs Paidal, Gulshan-e-Iqbal -> Clifton (Wed 4 PM, Time save)');
for (const vehicle of ['car', 'bike', 'walk'] as const) {
  const r = findTrip(roads, place('Gulshan-e-Iqbal'), place('Clifton'), time, false, 'time', vehicle);
  console.log(`  ${vehicle.padEnd(5)} ${r ? `${r.distanceKm} km, ${r.minutes} min, ${r.fuelLitres.toFixed(2)} L` : 'no route'}`);
}

console.log('\nBetter routes (Wed 4 PM)');
for (const n of ['Shahrah-e-Faisal', 'University Road', 'M.A. Jinnah Road', 'Korangi Road', 'Shahrah-e-Pakistan']) {
  const road = roads.find((r) => r.name === n);
  if (!road) continue;
  const s = performance.now();
  const r = findAltRoute(roads, road.id, time, false);
  const ms = performance.now() - s;
  console.log(`  ${n.padEnd(20)} ${r ? `${r.distanceKm} km, ${r.minutes} min, saves ${r.minutesSaved}, jam ${r.jamChance}%  via ${r.roadIds.slice(0, 3).map((id) => nameOf.get(id)).join(' -> ')}` : 'no alternative'}  [${ms.toFixed(0)} ms]`);
}
console.log('');
