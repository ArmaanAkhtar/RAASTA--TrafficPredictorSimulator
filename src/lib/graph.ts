// src/lib/graph.ts
// Undirected road graph built once from Road[] (memoised per roads array).
//
// Nodes: every road point, snapped together when within SNAP_M (grid hash), so roads
//        that share a junction point join automatically.
// Extra joins (because simplification can remove a junction point from one road):
//   - T-junctions: a node lying within SNAP_M of another edge is connected to both ends of that edge.
//   - Crossings:   two edges that cross get a new node at the crossing, connected to all four ends.
// Edges: consecutive points of a segment, with length (m) and roadId.
import type { Pt, Road } from './types';

export const SNAP_M = 15;
const EDGE_CELL_M = 60;

export interface GraphEdge {
  to: number;
  len: number; // metres
  roadId: string;
}

export interface RoadGraph {
  nodes: Pt[];
  adj: GraphEdge[][];
  edgeCount: number;
  /** Node ids of every segment start and end, per road id. */
  roadEndpoints: Map<string, number[]>;
  /** Connected-part id of every node, and the id of the biggest part (the main city network). */
  component: Int32Array;
  mainComponent: number;
}

interface RawEdge {
  a: number;
  b: number;
  roadId: string;
}

interface LenEdge extends RawEdge {
  len: number;
}

const cache = new WeakMap<Road[], RoadGraph>();

/** Builds the graph on first call for this roads array, then returns the cached one. */
export function getGraph(roads: Road[]): RoadGraph {
  const hit = cache.get(roads);
  if (hit) return hit;
  const g = buildGraph(roads);
  cache.set(roads, g);
  return g;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Distance from p to segment a-b, and the position t (0..1) of the closest point. */
function pointSeg(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, a), t: 0 };
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

/** Proper crossing point of segments a-b and c-d (not at their ends), or null. */
function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null; // parallel
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

export function buildGraph(roads: Road[]): RoadGraph {
  const nodes: Pt[] = [];
  const nodeGrid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx}|${cy}`;

  const addNode = (p: Pt): number => {
    const id = nodes.length;
    nodes.push([p[0], p[1]]);
    const k = key(Math.floor(p[0] / SNAP_M), Math.floor(p[1] / SNAP_M));
    const list = nodeGrid.get(k);
    if (list) list.push(id);
    else nodeGrid.set(k, [id]);
    return id;
  };

  /** Existing node within SNAP_M, or a new one. */
  const getNode = (p: Pt): number => {
    const cx = Math.floor(p[0] / SNAP_M);
    const cy = Math.floor(p[1] / SNAP_M);
    let best = -1;
    let bestD = SNAP_M;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = nodeGrid.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (const id of list) {
          const d = dist(nodes[id], p);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    return best >= 0 ? best : addNode(p);
  };

  // 1. Nodes + raw edges from every segment
  const raw: RawEdge[] = [];
  const roadEndpoints = new Map<string, number[]>();
  for (const road of roads) {
    const ends: number[] = [];
    for (const seg of road.segments) {
      if (seg.length < 2) continue;
      let prev = getNode(seg[0]);
      ends.push(prev);
      for (let i = 1; i < seg.length; i++) {
        const cur = getNode(seg[i]);
        if (cur !== prev) raw.push({ a: prev, b: cur, roadId: road.id });
        prev = cur;
      }
      ends.push(prev);
    }
    roadEndpoints.set(road.id, ends);
  }

  const final: LenEdge[] = raw.map((e) => ({ ...e, len: dist(nodes[e.a], nodes[e.b]) }));

  // 2. Spatial index of edges (bbox grown by SNAP_M)
  const edgeGrid = new Map<string, number[]>();
  raw.forEach((e, i) => {
    const A = nodes[e.a];
    const B = nodes[e.b];
    const x0 = Math.floor((Math.min(A[0], B[0]) - SNAP_M) / EDGE_CELL_M);
    const x1 = Math.floor((Math.max(A[0], B[0]) + SNAP_M) / EDGE_CELL_M);
    const y0 = Math.floor((Math.min(A[1], B[1]) - SNAP_M) / EDGE_CELL_M);
    const y1 = Math.floor((Math.max(A[1], B[1]) + SNAP_M) / EDGE_CELL_M);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const list = edgeGrid.get(k);
        if (list) list.push(i);
        else edgeGrid.set(k, [i]);
      }
    }
  });

  // 3. T-junctions: node close to the middle of another edge
  const baseNodeCount = nodes.length;
  for (let n = 0; n < baseNodeCount; n++) {
    const p = nodes[n];
    const list = edgeGrid.get(key(Math.floor(p[0] / EDGE_CELL_M), Math.floor(p[1] / EDGE_CELL_M)));
    if (!list) continue;
    for (const ei of list) {
      const e = raw[ei];
      if (e.a === n || e.b === n) continue;
      const A = nodes[e.a];
      const B = nodes[e.b];
      const { d, t } = pointSeg(p, A, B);
      if (d > SNAP_M || t <= 0 || t >= 1) continue;
      const P: Pt = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
      final.push({ a: n, b: e.a, len: d + dist(P, A), roadId: e.roadId });
      final.push({ a: n, b: e.b, len: d + dist(P, B), roadId: e.roadId });
    }
  }

  // 4. Crossings: two edges crossing with no shared point
  const crossed = new Set<string>();
  for (const list of edgeGrid.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x];
        const j = list[y];
        const e1 = raw[i];
        const e2 = raw[j];
        if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue;
        const P = segIntersect(nodes[e1.a], nodes[e1.b], nodes[e2.a], nodes[e2.b]);
        if (!P) continue;
        const pk = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (crossed.has(pk)) continue; // same pair seen in another cell
        crossed.add(pk);
        const pid = getNode(P);
        const links: Array<[number, string]> = [
          [e1.a, e1.roadId],
          [e1.b, e1.roadId],
          [e2.a, e2.roadId],
          [e2.b, e2.roadId],
        ];
        for (const [end, roadId] of links) {
          if (end !== pid) final.push({ a: pid, b: end, len: dist(nodes[pid], nodes[end]), roadId });
        }
      }
    }
  }

  // 5. Adjacency list (undirected)
  const adj: GraphEdge[][] = nodes.map(() => []);
  let edgeCount = 0;
  for (const e of final) {
    if (e.a === e.b) continue;
    adj[e.a].push({ to: e.b, len: e.len, roadId: e.roadId });
    adj[e.b].push({ to: e.a, len: e.len, roadId: e.roadId });
    edgeCount++;
  }

  // 6. Connected parts (small islands far from the city cannot be routed through)
  const component = new Int32Array(nodes.length).fill(-1);
  let mainComponent = 0;
  let mainSize = 0;
  let nextId = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (component[s] !== -1) continue;
    const id = nextId++;
    let size = 0;
    const stack = [s];
    component[s] = id;
    while (stack.length > 0) {
      const u = stack.pop();
      if (u === undefined) break;
      size++;
      for (const e of adj[u]) {
        if (component[e.to] === -1) {
          component[e.to] = id;
          stack.push(e.to);
        }
      }
    }
    if (size > mainSize) {
      mainSize = size;
      mainComponent = id;
    }
  }

  return { nodes, adj, edgeCount, roadEndpoints, component, mainComponent };
}
