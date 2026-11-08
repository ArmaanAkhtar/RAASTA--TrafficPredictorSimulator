/**
 * scripts/test-prediction.ts
 * Run: npx tsx scripts/test-prediction.ts
 * Prints predictions for a few real roads so you can sanity-check the CONFIG numbers.
 */
import * as fs from 'fs';
import * as path from 'path';
import { predict } from '../src/lib/prediction';
import { RUSH_PROFILES } from '../src/lib/rushProfiles';
import type { Pt, Road, RoadType } from '../src/lib/types';

const ROOT = process.cwd();
const ROADS_FILE = path.join(ROOT, 'public', 'data', 'roads.geojson');
const PROFILES_JSON = path.join(ROOT, 'public', 'data', 'rush_profiles.json');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isRoadType(v: unknown): v is RoadType {
  return v === 'highway' || v === 'arterial' || v === 'local';
}
function isPt(v: unknown): v is Pt {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';
}

function loadRoadsFromDisk(): Road[] {
  if (!fs.existsSync(ROADS_FILE)) {
    console.error('public/data/roads.geojson not found. Run: npx tsx scripts/build-roads.ts');
    process.exit(1);
  }
  const data: unknown = JSON.parse(fs.readFileSync(ROADS_FILE, 'utf8'));
  if (!isRecord(data) || !Array.isArray(data.features)) {
    console.error('roads.geojson is not a FeatureCollection.');
    process.exit(1);
  }
  const roads: Road[] = [];
  const features: unknown[] = data.features;
  for (const f of features) {
    if (!isRecord(f) || !isRecord(f.properties)) continue;
    const { id, name, type, lengthM, center } = f.properties;
    if (typeof id !== 'string' || typeof name !== 'string' || !isRoadType(type)) continue;
    if (typeof lengthM !== 'number' || !isPt(center)) continue;
    // Segments are not needed for prediction
    roads.push({ id, name, type, segments: [], lengthM, center: [center[0], center[1]] });
  }
  return roads;
}

const pad = (s: string, n: number) => s.padEnd(n);
const cell = (score: number, level: string, jam: number) =>
  `${String(score).padStart(3)} ${level[0].toUpperCase()} ${String(jam).padStart(3)}%`;

function main(): void {
  // 1. JSON vs TS sync check
  if (fs.existsSync(PROFILES_JSON)) {
    const json: unknown = JSON.parse(fs.readFileSync(PROFILES_JSON, 'utf8'));
    const same = JSON.stringify(json) === JSON.stringify(RUSH_PROFILES);
    console.log(
      same
        ? 'rush_profiles.json matches rushProfiles.ts: OK'
        : 'WARNING: rush_profiles.json and rushProfiles.ts are different. Copy the numbers across.',
    );
  } else {
    console.log('WARNING: public/data/rush_profiles.json not found.');
  }

  const roads = loadRoadsFromDisk();
  const wanted = ['Shahrah-e-Faisal', 'University Road', 'Rashid Minhas Road', 'I.I. Chundrigar Road'];
  const picked: Road[] = [];
  for (const name of wanted) {
    const r = roads.find((x) => x.name === name);
    if (r) picked.push(r);
    else console.log(`(not found in roads.geojson: ${name})`);
  }
  // One ordinary road that uses the generic type profile
  const generic = roads.find((r) => r.type === 'arterial' && !(r.name in RUSH_PROFILES.byRoad));
  if (generic) picked.push(generic);

  // 2. Wednesday table
  const hours = [3, 9, 13, 16, 18, 22];
  console.log('\nWednesday   (cell = score, level L/M/H, jam chance next hour)\n');
  console.log(pad('Road', 26) + hours.map((h) => pad(`${String(h).padStart(2, '0')}:00`, 13)).join(''));
  console.log('-'.repeat(26 + hours.length * 13));
  for (const r of picked) {
    const row = hours.map((h) => {
      const p = predict(r, { day: 3, hour: h, minute: 0 }, false);
      return pad(cell(p.nowScore, p.nowLevel, p.jamChanceNextHour), 13);
    });
    console.log(pad(r.name.slice(0, 25), 26) + row.join(''));
  }

  // 3. Special days + rain
  const specials: Array<{ label: string; day: number; hour: number; rain: boolean }> = [
    { label: 'Fri 13:00 (Jummah)', day: 5, hour: 13, rain: false },
    { label: 'Fri 15:00 (surge)', day: 5, hour: 15, rain: false },
    { label: 'Sun 18:00', day: 0, hour: 18, rain: false },
    { label: 'Wed 18:00 + rain', day: 3, hour: 18, rain: true },
  ];
  console.log('\nSpecial cases\n');
  console.log(pad('Road', 26) + specials.map((s) => pad(s.label, 20)).join(''));
  console.log('-'.repeat(26 + specials.length * 20));
  for (const r of picked) {
    const row = specials.map((s) => {
      const p = predict(r, { day: s.day, hour: s.hour, minute: 0 }, s.rain);
      return pad(cell(p.nowScore, p.nowLevel, p.jamChanceNextHour), 20);
    });
    console.log(pad(r.name.slice(0, 25), 26) + row.join(''));
  }

  // 4. Sanity checks
  console.log('\nSanity checks');
  const faisal = roads.find((r) => r.name === 'Shahrah-e-Faisal');
  if (faisal) {
    const peak = predict(faisal, { day: 3, hour: 17, minute: 0 }, false);
    const night = predict(faisal, { day: 3, hour: 3, minute: 0 }, false);
    console.log(`  ${peak.nowLevel === 'heavy' ? 'PASS' : 'FAIL'}  Shahrah-e-Faisal Wed 17:00 is heavy (${peak.nowScore})`);
    console.log(`  ${night.nowLevel === 'light' ? 'PASS' : 'FAIL'}  Shahrah-e-Faisal Wed 03:00 is light (${night.nowScore})`);
    const p = predict(faisal, { day: 3, hour: 16, minute: 30 }, false);
    console.log(`  ${p.hourly.length === 24 ? 'PASS' : 'FAIL'}  hourly has 24 entries`);
    console.log(`  info  Demo moment: ${DAYS[3]} 16:00 -> score ${predict(faisal, { day: 3, hour: 16, minute: 0 }, false).nowScore}, jam next hour ${predict(faisal, { day: 3, hour: 16, minute: 0 }, false).jamChanceNextHour}%`);
  } else {
    console.log('  FAIL  Shahrah-e-Faisal not found in roads.geojson');
  }

  // 5. Speed
  const t0 = Date.now();
  for (const r of roads) predict(r, { day: 3, hour: 17, minute: 0 }, false);
  console.log(`  info  predict() for all ${roads.length} roads took ${Date.now() - t0} ms\n`);
}

main();
