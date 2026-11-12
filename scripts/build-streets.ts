/**
 * scripts/build-streets.ts
 * Run: npx tsx scripts/build-streets.ts       (after: npx tsx scripts/fetch-osm.ts)
 *
 * Every street / gali of Karachi as a small binary file for the 3D map (drawn like Google Maps'
 * grey street grid under the main roads). Streets are only drawn, not used for traffic prediction.
 *   Input:  scripts/data/karachi_streets.json   { v: 1, ways: [[lon, lat, lon, lat, ...], ...] }
 *   Output: public/data/streets.bin
 *
 * Format of streets.bin (little-endian Int32, local metres, 1 m precision):
 *   [n, x0, y0, x1, y1, ... x(n-1), y(n-1),   n, x0, y0, ...]   one polyline after another
 * Uses only Node built-ins.
 */
import * as fs from 'fs';
import * as path from 'path';
import { projectLatLon } from './bbox';

type Pt = [number, number];

const ROOT = process.cwd();
const IN_FILE = path.join(ROOT, 'scripts', 'data', 'karachi_streets.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'streets.bin');

const project = (lon: number, lat: number): Pt => projectLatLon(lat, lon);

const SIMPLIFY_M = 12;
const MAX_POINTS = 30000;
const FILE_MAGIC = 0x53545232; // STR2

/** Douglas-Peucker */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Missing ${path.relative(ROOT, IN_FILE)}. Run first:  npx tsx scripts/fetch-osm.ts --streets-only`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf8')) as { ways?: unknown };
  const ways = Array.isArray(data.ways) ? (data.ways as unknown[]) : [];

  const out: number[] = [];
  let polylines = 0;
  let points = 0;
  let rawPoints = 0;
  let totalM = 0;

  const flush = (line: Pt[]) => {
    if (line.length < 2) return;
    for (let start = 0; start < line.length - 1; start += MAX_POINTS - 1) {
      const part = line.slice(start, start + MAX_POINTS);
      if (part.length < 2) break;
      out.push(part.length);
      for (const [x, y] of part) out.push(x, y);
      polylines++;
      points += part.length;
    }
  };

  for (const w of ways) {
    if (!Array.isArray(w) || w.length < 4) continue;
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < w.length; i += 2) {
      const lon = Number(w[i]);
      const lat = Number(w[i + 1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push(project(lon, lat));
    }
    rawPoints += pts.length;
    for (let i = 1; i < pts.length; i++) totalM += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);

    // simplify, round to whole metres and drop repeats
    let line: Pt[] = [];
    for (const [x, y] of simplify(pts, SIMPLIFY_M)) {
      const p: Pt = [Math.round(x), Math.round(y)];
      const last = line[line.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p);
    }
    flush(line);
  }

  const buf = Buffer.alloc((out.length + 1) * 4);
  buf.writeInt32LE(FILE_MAGIC, 0);
  out.forEach((v, i) => buf.writeInt32LE(v, (i + 1) * 4));
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, buf);

  console.log('\n=== build-streets: done ===');
  console.log(`Streets in      : ${ways.length}`);
  console.log(`Polylines out   : ${polylines}`);
  console.log(`Points          : ${points} (from ${rawPoints}, simplified at ${SIMPLIFY_M} m)`);
  console.log(`Street length   : ${(totalM / 1000).toFixed(0)} km`);
  console.log(`File size       : ${(buf.length / 1e6).toFixed(2)} MB -> ${path.relative(ROOT, OUT_FILE)}`);
}

main();
