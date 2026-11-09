/**
 * scripts/build-graph.ts
 * Run: npx tsx scripts/build-graph.ts      (after scripts/build-roads.ts)
 *
 * Builds the DIRECTED routing graph from the raw OpenStreetMap export:
 *   Input:  scripts/data/karachi_raw.geojson   (overpass-turbo GeoJSON, lon/lat, with OSM tags)
 *           public/data/roads.geojson          (display roads, used to link edges to road ids)
 *           scripts/data/karachi_streets.json (optional: every street / gali, from scripts/fetch-osm.ts)
 *   Output: public/data/road_graph.bin          (binary, see writeBinary below)
 *
 * Why: dual carriageways in OSM are two separate one-way ways. Routing must
 *   - only drive each carriageway in its own direction        (oneway=yes / -1 / roundabout)
 *   - only turn where ways really meet (shared OSM vertex), never where they merely cross
 *     (flyovers / underpasses) or run close together (the two sides of a dual road)
 *   - U-turn only where a median cut / connector way exists in the data
 * Any highway class in the export is used for routing (links, tertiary, short unclassified
 * connectors = U-turn cuts), even if it is not drawn as a "road" in the app.
 * Uses only Node built-ins.
 */
import * as fs from 'fs';
import * as path from 'path';

type Pt = [number, number];
type Cls = 0 | 1 | 2 | 3; // 0 highway, 1 arterial, 2 local, 3 street / gali (slow, local rush profile)

const ROOT = process.cwd();
const IN_RAW = path.join(ROOT, 'scripts', 'data', 'karachi_raw.geojson');
const IN_ROADS = path.join(ROOT, 'public', 'data', 'roads.geojson');
const IN_STREETS = path.join(ROOT, 'scripts', 'data', 'karachi_streets.json');
const IN_RESTRICTIONS = path.join(ROOT, 'scripts', 'data', 'karachi_restrictions.json');
const IN_SIGNALS = path.join(ROOT, 'scripts', 'data', 'karachi_signals.json');
/** A junction counts as signalised if a traffic light is mapped this close to it. */
const SIGNAL_NEAR_M = 35;
const OUT = path.join(ROOT, 'public', 'data', 'road_graph.bin');
const OLD_JSON = path.join(ROOT, 'public', 'data', 'road_graph.json');
/** Vertex key: lon/lat to 6 decimals (~10 cm). Shared OSM vertices give the same key in both files. */
const vkey = (lon: number, lat: number) => `${Math.round(lon * 1e6)},${Math.round(lat * 1e6)}`;

const LAT0 = 24.8607;
const LON0 = 67.0011;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_DEG_LAT = 110540;
const project = (lon: number, lat: number): Pt => [(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT];

/** Routable classes -> rush profile class. Anything else is ignored. */
const CLASS: Record<string, Cls> = {
  motorway: 0, motorway_link: 0, trunk: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
  unclassified: 2,
};
/** Unclassified ways are only kept when short: in a city they are mostly median cuts / connectors. */
const MAX_UNCLASSIFIED_M = 150;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const canonKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Same spelling merges as build-roads.ts (keep in sync if you add aliases there)
const ALIASES: Record<string, string> = {
  shahrahefaisal: 'Shahrah-e-Faisal', sharahefaisal: 'Shahrah-e-Faisal', shahraefaisal: 'Shahrah-e-Faisal',
  sharaefaisal: 'Shahrah-e-Faisal', shahrahifaisal: 'Shahrah-e-Faisal', shahraheefaisal: 'Shahrah-e-Faisal',
  faisalroad: 'Shahrah-e-Faisal', shahrahefaisaldrighroad: 'Shahrah-e-Faisal', shahrahefaisalscandalpointroad: 'Shahrah-e-Faisal',
  shahrahefaisalshahrahefaisaldrighroad: 'Shahrah-e-Faisal', sharaefaisaldrighroad: 'Shahrah-e-Faisal', universityroad: 'University Road', universityrd: 'University Road',
  majinnahroad: 'M.A. Jinnah Road', majinnahrd: 'M.A. Jinnah Road', mohammadalijinnahroad: 'M.A. Jinnah Road',
  muhammadalijinnahroad: 'M.A. Jinnah Road', mohammedalijinnahroad: 'M.A. Jinnah Road',
  rashidminhasroad: 'Rashid Minhas Road', rashidminhasrd: 'Rashid Minhas Road', shaheedrashidminhasroad: 'Rashid Minhas Road',
  shahrahepakistan: 'Shahrah-e-Pakistan', sharahepakistan: 'Shahrah-e-Pakistan', shahraepakistan: 'Shahrah-e-Pakistan',
  sharaepakistan: 'Shahrah-e-Pakistan', korangiroad: 'Korangi Road', korangird: 'Korangi Road',
  lyariexpressway: 'Lyari Expressway', lyariexpresswaynorthbound: 'Lyari Expressway', lyariexpresswaysouthbound: 'Lyari Expressway',
  iichundrigarroad: 'I.I. Chundrigar Road', iichundrigarrd: 'I.I. Chundrigar Road', ibrahimismailchundrigarroad: 'I.I. Chundrigar Road',
};

function lineLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Douglas-Peucker for the drawn geometry of an edge (routing uses the exact length). */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const r = stack.pop();
    if (!r) break;
    const [a, b] = r;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / L2));
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

interface Way {
  coords: Pt[]; // local metres
  keys: string[]; // exact vertex keys (from lon/lat), so shared OSM vertices match exactly
  cls: Cls;
  dir: 0 | 1 | -1; // 0 both ways, 1 forward only, -1 backward only
  roadIdx: number; // index into roadIds, or -1 if not a display road
  osmId: number; // OpenStreetMap way id (for turn restrictions), 0 if unknown
  link: boolean; // slip road / ramp (*_link)
}

function main(): void {
  for (const f of [IN_RAW, IN_ROADS]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing ${path.relative(ROOT, f)}. Run scripts/build-roads.ts first.`);
      process.exit(1);
    }
  }

  // Display roads: canonical name -> road id
  const roadsData: unknown = JSON.parse(fs.readFileSync(IN_ROADS, 'utf8'));
  const roadIds: string[] = [];
  const idxByCanon = new Map<string, number>();
  if (isRecord(roadsData) && Array.isArray(roadsData.features)) {
    for (const f of roadsData.features as unknown[]) {
      if (!isRecord(f) || !isRecord(f.properties)) continue;
      const { id, name } = f.properties;
      if (typeof id !== 'string' || typeof name !== 'string') continue;
      idxByCanon.set(canonKey(name), roadIds.length);
      roadIds.push(id);
    }
  }

  const raw: unknown = JSON.parse(fs.readFileSync(IN_RAW, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.features)) {
    console.error('karachi_raw.geojson is not a FeatureCollection');
    process.exit(1);
  }

  // 1. Read ways
  const ways: Way[] = [];
  const classCount: Record<string, number> = {};
  let skipped = 0;
  for (const f of raw.features as unknown[]) {
    if (!isRecord(f) || !isRecord(f.geometry) || f.geometry.type !== 'LineString') {
      skipped++;
      continue;
    }
    const props = isRecord(f.properties) ? f.properties : {};
    const tags = isRecord(props.tags) ? props.tags : props;
    const hw = str(tags.highway) ?? '';
    const cls = CLASS[hw];
    if (cls === undefined) {
      skipped++;
      continue;
    }
    const coordsRaw = f.geometry.coordinates;
    if (!Array.isArray(coordsRaw)) continue;
    const coords: Pt[] = [];
    const keys: string[] = [];
    for (const c of coordsRaw as unknown[]) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      coords.push(project(c[0], c[1]));
      keys.push(vkey(c[0], c[1]));
    }
    if (coords.length < 2) continue;
    if (hw === 'unclassified' && lineLength(coords) > MAX_UNCLASSIFIED_M) {
      skipped++;
      continue;
    }

    const oneway = str(tags.oneway);
    const junction = str(tags.junction);
    let dir: 0 | 1 | -1 = 0;
    if (oneway === 'yes' || oneway === 'true' || oneway === '1') dir = 1;
    else if (oneway === '-1' || oneway === 'reverse') dir = -1;
    else if (oneway === 'no') dir = 0;
    else if (junction === 'roundabout' || junction === 'circular' || hw === 'motorway' || hw === 'motorway_link') dir = 1;

    const name = str(tags['name:en']) ?? str(tags.name) ?? str(tags.ref);
    let roadIdx = -1;
    if (name) {
      const canon = canonKey(name.replace(/\s+/g, ' '));
      const aliased = ALIASES[canon];
      roadIdx = idxByCanon.get(aliased ? canonKey(aliased) : canon) ?? -1;
    }
    const idText = String(props['@id'] ?? f.id ?? '');
    const osmId = Number(idText.replace(/^way\//, '')) || 0;
    ways.push({ coords, keys, cls, dir, roadIdx, osmId, link: hw.endsWith('_link') });
    classCount[hw] = (classCount[hw] ?? 0) + 1;
  }

  // 1b. Streets / galiyan (two-way, slow). Skip copies of ways already read from the main export.
  let streetWays = 0;
  if (fs.existsSync(IN_STREETS)) {
    const mainEnds = new Set<string>();
    for (const w of ways) {
      const a = w.keys[0];
      const b = w.keys[w.keys.length - 1];
      mainEnds.add(`${a}|${b}`);
      mainEnds.add(`${b}|${a}`);
    }
    const sdata = JSON.parse(fs.readFileSync(IN_STREETS, 'utf8')) as { ways?: unknown };
    for (const flat of Array.isArray(sdata.ways) ? (sdata.ways as unknown[]) : []) {
      if (!Array.isArray(flat) || flat.length < 4) continue;
      const coords: Pt[] = [];
      const keys: string[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const lon = Number(flat[i]);
        const lat = Number(flat[i + 1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        coords.push(project(lon, lat));
        keys.push(vkey(lon, lat));
      }
      if (coords.length < 2 || mainEnds.has(`${keys[0]}|${keys[keys.length - 1]}`)) continue;
      ways.push({ coords, keys, cls: 3, dir: 0, roadIdx: -1, osmId: 0, link: false });
      streetWays++;
    }
    classCount.street = streetWays;
  } else {
    console.log('(no scripts/data/karachi_streets.json: routing uses main roads only. Run fetch-osm.ts for galiyan.)');
  }

  // 2. Junction vertices: used by 2+ ways, or a way's start/end
  const useCount = new Map<string, number>();
  for (const w of ways) {
    const seen = new Set<string>();
    for (const k of w.keys) {
      if (seen.has(k)) continue; // a closed way touches its first vertex twice
      seen.add(k);
      useCount.set(k, (useCount.get(k) ?? 0) + 1);
    }
  }
  const nodeIndex = new Map<string, number>();
  const nodes: number[] = []; // flat x,y in decimetres
  const nodeOf = (key: string, p: Pt): number => {
    let i = nodeIndex.get(key);
    if (i === undefined) {
      i = nodes.length / 2;
      nodeIndex.set(key, i);
      nodes.push(Math.round(p[0] * 10), Math.round(p[1] * 10));
    }
    return i;
  };

  // 3. Edges between consecutive junctions along each way
  // edge = [from, to, lengthDm, roadIdx, cls, dir, geomStart, geomCount]
  const edges: number[][] = [];
  const edgeWay: number[] = []; // OSM way id of each stored edge
  const geom: number[] = []; // flat x,y in decimetres (intermediate points only)
  let totalLen = 0;
  for (const w of ways) {
    let startI = 0;
    for (let i = 1; i < w.coords.length; i++) {
      const isJunction = i === w.coords.length - 1 || (useCount.get(w.keys[i]) ?? 0) > 1;
      if (!isJunction) continue;
      const piece = w.coords.slice(startI, i + 1);
      const len = lineLength(piece);
      if (len > 0.05) {
        const a = nodeOf(w.keys[startI], w.coords[startI]);
        const b = nodeOf(w.keys[i], w.coords[i]);
        if (a !== b) {
          const inner = simplify(piece, 2.5).slice(1, -1);
          const gStart = geom.length / 2;
          for (const p of inner) geom.push(Math.round(p[0] * 10), Math.round(p[1] * 10));
          // class in bits 0-2, bit 3 = slip road
          edges.push([a, b, Math.round(len * 10), w.roadIdx, w.cls | (w.link ? 8 : 0), w.dir, gStart, inner.length]);
          edgeWay.push(w.osmId);
          totalLen += len;
        }
      }
      startI = i;
    }
  }

  // 4. Stats: largest strongly connected part (where every node can reach every other)
  const n = nodes.length / 2;
  const out: number[][] = Array.from({ length: n }, () => []);
  const inn: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b, , , , dir] of edges) {
    if (dir >= 0) { out[a].push(b); inn[b].push(a); }
    if (dir <= 0) { out[b].push(a); inn[a].push(b); }
  }
  const scc = largestScc(n, out, inn);

  // 3b. Turn restrictions -> [via node, from stored edge, to stored edge, 0 = no_* / 1 = only_*]
  const restrictions: number[] = [];
  let restrictionCount = 0;
  if (fs.existsSync(IN_RESTRICTIONS)) {
    const edgesOfWayAt = new Map<string, number[]>(); // `${wayId}|${node}` -> stored edges
    edges.forEach((e, k) => {
      if (!edgeWay[k]) return;
      for (const node of [e[0], e[1]]) {
        const key = `${edgeWay[k]}|${node}`;
        const list = edgesOfWayAt.get(key) ?? [];
        list.push(k);
        edgesOfWayAt.set(key, list);
      }
    });
    const rdata = JSON.parse(fs.readFileSync(IN_RESTRICTIONS, 'utf8')) as {
      items?: Array<{ r: string; from: number; to: number; via: [number, number] }>;
    };
    for (const it of rdata.items ?? []) {
      if (it.from === it.to) continue; // no_u_turn on one way: U-turns on the same edge are already not allowed
      const kind = it.r.startsWith('only_') ? 1 : it.r.startsWith('no_') ? 0 : -1;
      if (kind < 0) continue;
      const via = nodeIndex.get(vkey(it.via[0], it.via[1]));
      if (via === undefined) continue;
      const fromEdges = edgesOfWayAt.get(`${it.from}|${via}`) ?? [];
      const toEdges = edgesOfWayAt.get(`${it.to}|${via}`) ?? [];
      if (!fromEdges.length || !toEdges.length) continue;
      for (const fe of fromEdges) for (const te of toEdges) restrictions.push(via, fe, te, kind);
      restrictionCount++;
    }
  }

  // 3c. Junctions with traffic lights: crossing a main road (or turning right across it) is only easy there
  const signalNodes: number[] = [];
  if (fs.existsSync(IN_SIGNALS)) {
    const sdata = JSON.parse(fs.readFileSync(IN_SIGNALS, 'utf8')) as { signals?: Array<[number, number]> };
    const cell = 50;
    const grid = new Map<string, Pt[]>();
    for (const [lon, lat] of sdata.signals ?? []) {
      const p = project(lon, lat);
      const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
      const list = grid.get(key) ?? [];
      list.push(p);
      grid.set(key, list);
    }
    for (let i = 0; i < nodes.length / 2; i++) {
      const x = nodes[i * 2] / 10;
      const y = nodes[i * 2 + 1] / 10;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) {
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (const p of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (Math.hypot(p[0] - x, p[1] - y) <= SIGNAL_NEAR_M) {
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) signalNodes.push(i);
    }
  }

  const bytes = writeBinary(roadIds, nodes, edges, geom, restrictions, signalNodes);
  fs.writeFileSync(OUT, bytes);
  if (fs.existsSync(OLD_JSON)) fs.unlinkSync(OLD_JSON); // replaced by the .bin

  const oneway = edges.filter((e) => e[5] !== 0).length;
  console.log('\n=== build-graph: done ===');
  console.log(`Ways used        : ${ways.length}  (${Object.entries(classCount).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  console.log(`Skipped          : ${skipped} (other classes / long unclassified)`);
  console.log(`Nodes / edges    : ${n} / ${edges.length}  (${oneway} one-way, ${edges.length - oneway} two-way)`);
  console.log(`Road length      : ${(totalLen / 1000).toFixed(0)} km`);
  console.log(`Main network     : ${((scc / n) * 100).toFixed(1)}% of nodes reachable both ways`);
  console.log(`Turn restrictions: ${restrictionCount}${fs.existsSync(IN_RESTRICTIONS) ? '' : ' (run fetch-osm.ts --restrictions-only to add them)'}`);
  console.log(`Signal junctions : ${signalNodes.length}${fs.existsSync(IN_SIGNALS) ? '' : ' (run fetch-osm.ts --restrictions-only to add them)'}`);
  console.log(`File size        : ${(bytes.length / 1024).toFixed(0)} KB -> ${path.relative(ROOT, OUT)}\n`);
}

/**
 * road_graph.bin, little-endian Int32 throughout:
 *   header [magic 0x33524752 "RGR3", version 3, nodeCount, edgeCount, geomPointCount, roadsJsonBytes, restrictionCount, signalCount]
 *   roads JSON (UTF-8 array of road ids), padded to 4 bytes
 *   nodes  [x, y] * nodeCount               decimetres
 *   edges  [a, b, lenDm, roadIdx, geomStart, cls (+8 if slip road) | (dir + 1) << 4 | geomCount << 8] * edgeCount
 *   geom   [x, y] * geomPointCount          decimetres (inner points of edges)
 *   restrictions [viaNode, fromEdge, toEdge, kind 0 = no / 1 = only] * restrictionCount
 *   signals [node] * signalCount              junctions with traffic lights
 */
function writeBinary(
  roadIds: string[],
  nodes: number[],
  edges: number[][],
  geom: number[],
  restrictions: number[],
  signalNodes: number[],
): Buffer {
  const roadsBytes = Buffer.from(JSON.stringify(roadIds), 'utf8');
  const pad = (4 - (roadsBytes.length % 4)) % 4;
  const ints = 8 + nodes.length + edges.length * 6 + geom.length + restrictions.length + signalNodes.length;
  const buf = Buffer.alloc(ints * 4 + roadsBytes.length + pad);
  let o = 0;
  const w = (v: number) => {
    buf.writeInt32LE(v, o);
    o += 4;
  };
  [0x33524752, 3, nodes.length / 2, edges.length, geom.length / 2, roadsBytes.length, restrictions.length / 4, signalNodes.length].forEach(w);
  roadsBytes.copy(buf, o);
  o += roadsBytes.length + pad;
  nodes.forEach(w);
  for (const [a, b, lenDm, roadIdx, cls, dir, gStart, gCount] of edges) {
    w(a);
    w(b);
    w(lenDm);
    w(roadIdx);
    w(gStart);
    w(cls | ((dir + 1) << 4) | (gCount << 8));
  }
  geom.forEach(w);
  restrictions.forEach(w);
  signalNodes.forEach(w);
  return buf;
}

/** Kosaraju, iterative. Returns the size of the largest strongly connected component. */
function largestScc(n: number, out: number[][], inn: number[][]): number {
  const order: number[] = [];
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const stack: Array<[number, number]> = [[s, 0]];
    seen[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, i] = top;
      if (i < out[u].length) {
        top[1]++;
        const v = out[u][i];
        if (!seen[v]) {
          seen[v] = 1;
          stack.push([v, 0]);
        }
      } else {
        order.push(u);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(n).fill(-1);
  let best = 0;
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k];
    if (comp[s] !== -1) continue;
    let size = 0;
    const stack = [s];
    comp[s] = s;
    while (stack.length) {
      const u = stack.pop();
      if (u === undefined) break;
      size++;
      for (const v of inn[u]) if (comp[v] === -1) { comp[v] = s; stack.push(v); }
    }
    best = Math.max(best, size);
  }
  return best;
}

main();
