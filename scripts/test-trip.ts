/**
 * scripts/test-trip.ts
 * Run: npx tsx scripts/test-trip.ts
 * Compares Time save vs Petrol save for a few common Karachi trips (Wednesday 5 PM).
 */
import * as fs from 'fs';
import * as path from 'path';
import { PLACES } from '../src/lib/places';
import { planDeparture } from '../src/lib/departure';
import { findTrip } from '../src/lib/routing';
import type { Pt, Road, RoadType } from '../src/lib/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isType = (v: unknown): v is RoadType => v === 'highway' || v === 'arterial' || v === 'local';
const isPt = (v: unknown): v is Pt => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';

function loadRoads(): Road[] {
  const data: unknown = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'roads.geojson'), 'utf8'));
  if (!isRecord(data) || !Array.isArray(data.features)) throw new Error('bad roads.geojson');
  const out: Road[] = [];
  for (const f of data.features as unknown[]) {
    if (!isRecord(f) || !isRecord(f.properties) || !isRecord(f.geometry)) continue;
    const { id, name, type, lengthM, center } = f.properties;
    if (typeof id !== 'string' || typeof name !== 'string' || !isType(type) || typeof lengthM !== 'number' || !isPt(center)) continue;
    const segments: Pt[][] = [];
    const coords = f.geometry.coordinates;
    if (Array.isArray(coords)) for (const line of coords) if (Array.isArray(line)) segments.push(line.filter(isPt).map((p) => [p[0], p[1]] as Pt));
    out.push({ id, name, type, segments: segments.filter((s) => s.length >= 2), lengthM, center: [center[0], center[1]] });
  }
  return out;
}

const roads = loadRoads();
const nameOf = new Map(roads.map((r) => [r.id, r.name]));
const place = (n: string) => {
  const p = PLACES.find((x) => x.name === n);
  if (!p) throw new Error(`no place ${n}`);
  return p.point;
};
const time = { day: 3, hour: 17, minute: 0 };
const trips: Array<[string, string]> = [
  ['Gulshan-e-Iqbal', 'Clifton'],
  ['University of Karachi', 'Saddar'],
  ['Jinnah International Airport', 'DHA (Defence)'],
  ['North Nazimabad', 'I.I. Chundrigar Road (Tower)'],
  ['Korangi', 'Gulistan-e-Jauhar'],
];
for (const [a, b] of trips) {
  console.log(`\n${a} -> ${b}  (Wed 5 PM)`);
  for (const mode of ['time', 'petrol'] as const) {
    const t0 = performance.now();
    const r = findTrip(roads, place(a), place(b), time, false, mode);
    const ms = performance.now() - t0;
    if (!r) { console.log(`  ${mode.padEnd(6)} no route`); continue; }
    const via = r.roadIds.slice(0, 3).map((id) => nameOf.get(id) ?? id).join(' -> ');
    console.log(`  ${mode.padEnd(6)} ${String(r.distanceKm).padStart(5)} km  ${String(r.minutes).padStart(3)} min  ${r.fuelLitres.toFixed(2)} L  jam ${r.jamChance}%  [${ms.toFixed(0)} ms]  via ${via}`);
  }
}

// Best time to leave (next 2 hours) for a few start times
const fmt = (t: { hour: number; minute: number }) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
console.log('\n=== Best time to leave (next 2 h), Gulshan-e-Iqbal -> Clifton ===');
for (const hour of [7, 9, 16, 17, 19, 22]) {
  for (const mode of ['time', 'petrol'] as const) {
    const start = { day: 3, hour, minute: 0 };
    const { slots, advice } = planDeparture(roads, place('Gulshan-e-Iqbal'), place('Clifton'), start, false, mode);
    const row = slots.map((s) => (s.trip ? `${s.trip.minutes}${s.trafficFree ? '*' : ''}` : '-')).join(' ');
    const msg =
      advice.kind === 'wait' ? `WAIT till ${fmt(advice.slot.time)} (traffic-free, saves ${advice.savesMin} min)`
      : advice.kind === 'better-later' ? `leave ${fmt(advice.slot.time)} (saves ${advice.savesMin} min, not fully clear)`
      : advice.kind === 'clear-now' ? 'clear now, leave now'
      : advice.kind === 'jammed' ? 'JAMMED for 2 h, choose Time or Petrol save'
      : advice.kind === 'steady' ? (advice.worsens ? 'leave now, it gets busier later' : 'busy but steady for 2 h, just go')
      : advice.kind === 'walk' ? 'walking'
      : 'no route';
    console.log(`  ${fmt(start)} ${mode.padEnd(6)} [${row}]  -> ${msg}`);
  }
}
console.log('  (minutes per 15-min departure slot, * = traffic-free)');
console.log('');
