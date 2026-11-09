// src/lib/roadGraph.ts
// The DIRECTED routing graph (public/data/road_graph.bin, made by scripts/build-graph.ts).
// One-way carriageways, real junctions only (shared OSM vertices), U-turns only at mapped cuts.
// Loaded once in the background; routing falls back to the old geometric graph until it is ready.
import type { Pt, RoadType } from './types';

export interface DEdge {
  /** unique id of this directed edge (index into DirectedGraph.dedges) */
  id: number;
  from: number;
  to: number;
  len: number; // metres
  roadId: string | null; // display road this piece belongs to (for its prediction), if any
  type: RoadType; // rush profile class when roadId is null
  street: boolean; // a gali / residential street: slow, used for the first and last bit or short cuts
  /** 0 motorway/trunk, 1 primary, 2 secondary/tertiary/link, 3 street */
  cls: number;
  /** the OSM way is two-way (one way mapped for both directions): on a big road the two sides are split by a median */
  twoWay: boolean;
  /** a main road itself (motorway/trunk/primary/secondary/tertiary carriageway), not a slip road or a gali */
  main: boolean;
  edge: number; // index into geometry (stored edge)
  reversed: boolean; // traversing the stored geometry backwards
}

/** Turn rules at one junction for one arriving stored edge (from OpenStreetMap turn restrictions). */
export interface TurnRule {
  no: Set<number>; // stored edges you may not turn into
  only: Set<number>; // if not empty: the only stored edges you may turn into
}

export interface DirectedGraph {
  nodes: Pt[];
  out: DEdge[][];
  /** every directed edge, by id */
  dedges: DEdge[];
  /** true for nodes in the main strongly connected part (reachable to and from everywhere) */
  main: Uint8Array;
  /** intermediate points of each stored edge (local metres) */
  edgeGeom: Pt[][];
  /** stored edge endpoints, for drawing */
  edgeEnds: Array<[number, number]>;
  /** heading (radians, 0 = east, counter-clockwise) at the start and at the end of each stored edge */
  headStart: Float32Array;
  headEnd: Float32Array;
  /** turn restrictions, key = turnRuleKey(arriving edge) */
  turnRules: Map<number, TurnRule>;
  /** 1 where a junction has traffic lights */
  signal: Uint8Array;
  /** per node: lowest class (0 biggest) of a main road through it, 9 if none */
  mainCls: Uint8Array;
}

const CLS_TYPE: RoadType[] = ['highway', 'arterial', 'local', 'local']; // 3 = street / gali
const STREET_CLS = 3;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');

interface RawEdge {
  a: number;
  b: number;
  len: number;
  roadIdx: number;
  cls: number;
  dir: number;
  link: boolean;
}

/** Shared by both file formats: builds adjacency, headings and turn rules. */
function assemble(
  nodes: Pt[],
  raw: RawEdge[],
  edgeGeom: Pt[][],
  roadIds: unknown[],
  restrictions: ArrayLike<number> = [],
  signalNodes: ArrayLike<number> = [],
): DirectedGraph {
  const out: DEdge[][] = Array.from({ length: nodes.length }, () => []);
  const mainCls = new Uint8Array(nodes.length).fill(9);
  const signal = new Uint8Array(nodes.length);
  for (let i = 0; i < signalNodes.length; i++) if (signalNodes[i] < nodes.length) signal[signalNodes[i]] = 1;
  const dedges: DEdge[] = [];
  const edgeEnds: Array<[number, number]> = new Array(raw.length);
  const headStart = new Float32Array(raw.length);
  const headEnd = new Float32Array(raw.length);
  raw.forEach((r, k) => {
    edgeEnds[k] = [r.a, r.b];
    const pts = [nodes[r.a], ...edgeGeom[k], nodes[r.b]];
    const p0 = pts[0];
    const p1 = pts[1];
    const q0 = pts[pts.length - 2];
    const q1 = pts[pts.length - 1];
    headStart[k] = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    headEnd[k] = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]);
    const roadId = r.roadIdx >= 0 && typeof roadIds[r.roadIdx] === 'string' ? (roadIds[r.roadIdx] as string) || null : null;
    const base = {
      len: r.len,
      roadId,
      type: CLS_TYPE[r.cls] ?? ('local' as RoadType),
      street: r.cls === STREET_CLS,
      cls: r.cls,
      twoWay: r.dir === 0,
      main: r.cls <= 2 && !r.link,
      edge: k,
    };
    if (base.main) {
      mainCls[r.a] = Math.min(mainCls[r.a], r.cls);
      mainCls[r.b] = Math.min(mainCls[r.b], r.cls);
    }
    if (r.dir >= 0) {
      const e: DEdge = { ...base, id: dedges.length, from: r.a, to: r.b, reversed: false };
      dedges.push(e);
      out[r.a].push(e);
    }
    if (r.dir <= 0) {
      const e: DEdge = { ...base, id: dedges.length, from: r.b, to: r.a, reversed: true };
      dedges.push(e);
      out[r.b].push(e);
    }
  });

  // restrictions: [via node, from stored edge, to stored edge, kind (0 = no_*, 1 = only_*)] * n
  const turnRules = new Map<number, TurnRule>();
  for (let i = 0; i + 3 < restrictions.length; i += 4) {
    const via = restrictions[i];
    const from = restrictions[i + 1];
    const ends = edgeEnds[from];
    if (!ends) continue;
    // arriving at `via` along stored edge `from`: forwards if via is its end node, else backwards
    const key = from * 2 + (ends[1] === via ? 0 : 1);
    let rule = turnRules.get(key);
    if (!rule) {
      rule = { no: new Set(), only: new Set() };
      turnRules.set(key, rule);
    }
    (restrictions[i + 3] === 1 ? rule.only : rule.no).add(restrictions[i + 2]);
  }

  return {
    nodes,
    out,
    dedges,
    main: mainScc(nodes.length, out),
    edgeGeom,
    edgeEnds,
    headStart,
    headEnd,
    turnRules,
    signal,
    mainCls,
  };
}

export function parseRoadGraph(data: unknown): DirectedGraph | null {
  if (!isRecord(data) || data.v !== 2) return null;
  const { roads, nodes: flatNodes, edges, geom } = data;
  if (!Array.isArray(roads) || !isNumArray(flatNodes) || !Array.isArray(edges) || !isNumArray(geom)) return null;

  const nodes: Pt[] = [];
  for (let i = 0; i < flatNodes.length; i += 2) nodes.push([flatNodes[i] / 10, flatNodes[i + 1] / 10]);
  const raw: RawEdge[] = [];
  const edgeGeom: Pt[][] = [];
  for (const e of edges as unknown[]) {
    if (!isNumArray(e) || e.length < 8) continue;
    const [a, b, lenDm, roadIdx, cls, dir, gStart, gCount] = e;
    if (!nodes[a] || !nodes[b]) continue;
    const pts: Pt[] = [];
    for (let k = 0; k < gCount; k++) pts.push([geom[(gStart + k) * 2] / 10, geom[(gStart + k) * 2 + 1] / 10]);
    edgeGeom.push(pts);
    raw.push({ a, b, len: lenDm / 10, roadIdx, cls, dir, link: false });
  }
  return assemble(nodes, raw, edgeGeom, roads);
}

const MAGIC = 0x33524752; // "RGR3"

/** public/data/road_graph.bin (scripts/build-graph.ts writeBinary). Returns null if the file is not a v3 graph. */
export function parseRoadGraphBinary(buffer: ArrayBuffer): DirectedGraph | null {
  if (buffer.byteLength < 32) return null;
  const head = new Int32Array(buffer, 0, 8);
  if (head[0] !== MAGIC || head[1] !== 3) return null;
  const [, , nodeCount, edgeCount, geomCount, roadsBytes, restrictionCount, signalCount] = head;
  let o = 32;
  const roadIds = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, o, roadsBytes))) as unknown;
  if (!Array.isArray(roadIds)) return null;
  o += roadsBytes + ((4 - (roadsBytes % 4)) % 4);
  const nodeInts = new Int32Array(buffer, o, nodeCount * 2);
  o += nodeCount * 8;
  const edgeInts = new Int32Array(buffer, o, edgeCount * 6);
  o += edgeCount * 24;
  const geomInts = new Int32Array(buffer, o, geomCount * 2);
  o += geomCount * 8;
  const restrictions = restrictionCount > 0 ? new Int32Array(buffer, o, restrictionCount * 4) : new Int32Array(0);
  o += restrictionCount * 16;
  const signals = signalCount > 0 ? new Int32Array(buffer, o, signalCount) : new Int32Array(0);

  const nodes: Pt[] = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) nodes[i] = [nodeInts[i * 2] / 10, nodeInts[i * 2 + 1] / 10];
  const raw: RawEdge[] = new Array(edgeCount);
  const edgeGeom: Pt[][] = new Array(edgeCount);
  for (let k = 0; k < edgeCount; k++) {
    const base = k * 6;
    const gStart = edgeInts[base + 4];
    const packed = edgeInts[base + 5];
    const gCount = packed >>> 8;
    const pts: Pt[] = new Array(gCount);
    for (let j = 0; j < gCount; j++) pts[j] = [geomInts[(gStart + j) * 2] / 10, geomInts[(gStart + j) * 2 + 1] / 10];
    edgeGeom[k] = pts;
    raw[k] = {
      a: edgeInts[base],
      b: edgeInts[base + 1],
      len: edgeInts[base + 2] / 10,
      roadIdx: edgeInts[base + 3],
      cls: packed & 7,
      dir: ((packed >> 4) & 15) - 1,
      link: (packed & 8) !== 0,
    };
  }
  return assemble(nodes, raw, edgeGeom, roadIds, restrictions, signals);
}

/** Key of the turn rules for a directed edge arriving at its end node. */
export const turnRuleKey = (e: DEdge): number => e.edge * 2 + (e.reversed ? 1 : 0);

/** Points of a traversed edge, from its start node to its end node (inclusive). */
export function edgePoints(g: DirectedGraph, e: DEdge): Pt[] {
  const [a, b] = g.edgeEnds[e.edge];
  const inner = g.edgeGeom[e.edge];
  const pts = [g.nodes[a], ...inner, g.nodes[b]];
  return e.reversed ? pts.reverse() : pts;
}

/** Heading of a directed edge where it leaves its start node / arrives at its end node. */
export const headingOut = (g: DirectedGraph, e: DEdge): number =>
  e.reversed ? g.headEnd[e.edge] + Math.PI : g.headStart[e.edge];
export const headingIn = (g: DirectedGraph, e: DEdge): number =>
  e.reversed ? g.headStart[e.edge] + Math.PI : g.headEnd[e.edge];

const walkCache = new WeakMap<DirectedGraph, DirectedGraph>();

/**
 * The same network for walking: every carriageway can be walked both ways (one-way rules are for vehicles).
 * Built once per graph and cached.
 */
export function walkingGraph(g: DirectedGraph): DirectedGraph {
  const hit = walkCache.get(g);
  if (hit) return hit;
  const out: DEdge[][] = g.out.map((list) => [...list]);
  const dedges = [...g.dedges];
  g.out.forEach((list, u) => {
    for (const e of list) {
      // add the opposite direction unless the edge is already two-way
      if (!out[e.to].some((r) => r.edge === e.edge && r.to === u)) {
        const back: DEdge = { ...e, id: dedges.length, from: e.to, to: u, reversed: !e.reversed };
        dedges.push(back);
        out[e.to].push(back);
      }
    }
  });
  const walk: DirectedGraph = { ...g, out, dedges, main: mainScc(g.nodes.length, out) };
  walkCache.set(g, walk);
  return walk;
}

/** Kosaraju: mark the largest strongly connected component. */
function mainScc(n: number, out: DEdge[][]): Uint8Array {
  const inn: number[][] = Array.from({ length: n }, () => []);
  out.forEach((list, u) => list.forEach((e) => inn[e.to].push(u)));
  const order: number[] = [];
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const stack: Array<[number, number]> = [[s, 0]];
    seen[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const u = top[0];
      if (top[1] < out[u].length) {
        const v = out[u][top[1]++].to;
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
  const size = new Map<number, number>();
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k];
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = s;
    let count = 0;
    while (stack.length) {
      const u = stack.pop();
      if (u === undefined) break;
      count++;
      for (const v of inn[u]) if (comp[v] === -1) { comp[v] = s; stack.push(v); }
    }
    size.set(s, count);
  }
  let bestId = -1;
  let best = 0;
  size.forEach((c, id) => {
    if (c > best) { best = c; bestId = id; }
  });
  const main = new Uint8Array(n);
  for (let i = 0; i < n; i++) main[i] = comp[i] === bestId ? 1 : 0;
  return main;
}

// ---------------------------------------------------------------------------
// Module cache (the store in roadGraphStore.ts fills it)
// ---------------------------------------------------------------------------
let loaded: DirectedGraph | null = null;

/** The directed graph if it has loaded, else null (routing then uses the old geometric graph). */
export function getDirectedGraph(): DirectedGraph | null {
  return loaded;
}

/** For scripts/tests: use an already-parsed graph. */
export function setDirectedGraph(g: DirectedGraph | null): void {
  loaded = g;
}
