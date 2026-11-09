// src/lib/routing.ts
// findAltRoute: a better route around a busy road, using predicted rush.
//
// 1. Start/end = the two farthest-apart segment endpoints of the selected road.
// 2. Dijkstra (binary heap) over the road graph, EXCLUDING the selected road's edges.
//    Edge cost = length x (1 + score / 50), score = predict() for that edge's road.
// 3. Minutes use a speed model: 50 km/h when free (score 0) down to 12 km/h when jammed (score 100).
//
// Complexity: graph build O(P + E) once (memoised). Each call: O(R) predictions (cached per road)
// + Dijkstra O((V + E) log V). With ~20k nodes this runs in a few milliseconds.
import { dist, getGraph, type GraphEdge, type RoadGraph } from './graph';
import { predict } from './prediction';
import type { Prediction, Road, RouteResult, SelectedTime } from './types';

const FREE_KMH = 50;
const HEAVY_KMH = 12;
/** If a road endpoint only touches the selected road, look this far for another start node. */
const ENDPOINT_SEARCH_M = 1500;
/** Ignore detours between road ends that are closer than this. */
const MIN_ROUTE_M = 1000;

export function speedKmh(score: number): number {
  const s = Math.min(100, Math.max(0, score));
  return FREE_KMH - (FREE_KMH - HEAVY_KMH) * (s / 100);
}

const minutesFor = (lenM: number, score: number): number => (lenM / 1000 / speedKmh(score)) * 60;

// ---------------------------------------------------------------------------
// Binary min-heap of (key, node)
// ---------------------------------------------------------------------------
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { key: number; val: number } | null {
    const n = this.keys.length;
    if (n === 0) return null;
    const key = this.keys[0];
    const val = this.vals[0];
    const lastK = this.keys[n - 1];
    const lastV = this.vals[n - 1];
    this.keys.length = n - 1;
    this.vals.length = n - 1;
    if (n - 1 > 0) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      let i = 0;
      const size = n - 1;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < size && this.keys[l] < this.keys[m]) m = l;
        if (r < size && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return { key, val };
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i];
    this.keys[i] = this.keys[j];
    this.keys[j] = k;
    const v = this.vals[i];
    this.vals[i] = this.vals[j];
    this.vals[j] = v;
  }
}

interface PathResult {
  nodes: number[];
  edges: GraphEdge[];
}

function shortestPath(
  g: RoadGraph,
  start: number,
  end: number,
  allow: (roadId: string) => boolean,
  cost: (e: GraphEdge) => number,
): PathResult | null {
  const n = g.nodes.length;
  const best = new Float64Array(n).fill(Infinity);
  const prevNode = new Int32Array(n).fill(-1);
  const prevEdge: Array<GraphEdge | undefined> = new Array<GraphEdge | undefined>(n);
  const heap = new MinHeap();
  best[start] = 0;
  heap.push(0, start);

  while (heap.size > 0) {
    const top = heap.pop();
    if (!top) break;
    const { key: d, val: u } = top;
    if (d > best[u]) continue; // stale entry
    if (u === end) break;
    for (const e of g.adj[u]) {
      if (!allow(e.roadId)) continue;
      const nd = d + cost(e);
      if (nd < best[e.to]) {
        best[e.to] = nd;
        prevNode[e.to] = u;
        prevEdge[e.to] = e;
        heap.push(nd, e.to);
      }
    }
  }

  if (best[end] === Infinity) return null;
  const nodes: number[] = [end];
  const edges: GraphEdge[] = [];
  let cur = end;
  while (cur !== start) {
    const e = prevEdge[cur];
    const p = prevNode[cur];
    if (!e || p < 0) return null;
    edges.push(e);
    nodes.push(p);
    cur = p;
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges };
}

/** `from` if it has an allowed edge, otherwise the nearest node (within ENDPOINT_SEARCH_M) that does. */
function nearestUsableNode(g: RoadGraph, from: number, allow: (roadId: string) => boolean): number {
  const usable = (n: number) => g.adj[n].some((e) => allow(e.roadId));
  if (usable(from)) return from;
  const p = g.nodes[from];
  let best = -1;
  let bestD = ENDPOINT_SEARCH_M;
  for (let n = 0; n < g.nodes.length; n++) {
    const d = dist(p, g.nodes[n]);
    if (d < bestD && usable(n)) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API (matches the shared contract)
// ---------------------------------------------------------------------------
/**
 * roadIds are ordered by how much of the route each road covers (longest first),
 * so roadIds[0..2] are the "main roads" of the route.
 */
export function findAltRoute(
  roads: Road[],
  roadId: string,
  t: SelectedTime,
  rain: boolean,
): RouteResult | null {
  const road = roads.find((r) => r.id === roadId);
  if (!road) return null;
  const g = getGraph(roads);

  // Endpoints of the selected road that sit on the main city network
  // (a road can have a far-out piece on a small island that nothing connects to)
  const ends = Array.from(new Set(g.roadEndpoints.get(roadId) ?? [])).filter(
    (n) => g.component[n] === g.mainComponent,
  );
  if (ends.length < 2) return null;
  const notSelected = (rid: string) => rid !== roadId;

  // Which endpoints can still reach each other once the selected road is removed?
  // Label the connected parts of (graph minus selected road), starting from each endpoint.
  const usableOf = ends.map((n) => nearestUsableNode(g, n, notSelected));
  const part = new Int32Array(g.nodes.length).fill(-1);
  let nextPart = 0;
  for (const u of usableOf) {
    if (u < 0 || part[u] !== -1) continue;
    const id = nextPart++;
    const stack = [u];
    part[u] = id;
    while (stack.length > 0) {
      const x = stack.pop();
      if (x === undefined) break;
      for (const edge of g.adj[x]) {
        if (notSelected(edge.roadId) && part[edge.to] === -1) {
          part[edge.to] = id;
          stack.push(edge.to);
        }
      }
    }
  }

  // Farthest-apart pair of endpoints that are in the same part (so a detour exists)
  let s = -1;
  let e = -1;
  let start = -1;
  let end = -1;
  let far = -1;
  for (let i = 0; i < ends.length; i++) {
    const ui = usableOf[i];
    if (ui < 0) continue;
    for (let j = i + 1; j < ends.length; j++) {
      const uj = usableOf[j];
      if (uj < 0 || uj === ui || part[ui] !== part[uj]) continue;
      const d = dist(g.nodes[ends[i]], g.nodes[ends[j]]);
      if (d > far) {
        far = d;
        s = ends[i];
        e = ends[j];
        start = ui;
        end = uj;
      }
    }
  }
  if (s < 0 || e < 0 || far < MIN_ROUTE_M) return null;

  // Predictions, computed once per road for this call
  const roadById = new Map<string, Road>(roads.map((r) => [r.id, r]));
  const preds = new Map<string, Prediction>();
  const predOf = (rid: string): Prediction | null => {
    const hit = preds.get(rid);
    if (hit) return hit;
    const r = roadById.get(rid);
    if (!r) return null;
    const p = predict(r, t, rain);
    preds.set(rid, p);
    return p;
  };
  const scoreOf = (rid: string): number => predOf(rid)?.nowScore ?? 50;

  // Alternative: everything except the selected road
  const alt = shortestPath(g, start, end, notSelected, (edge) => edge.len * (1 + scoreOf(edge.roadId) / 50));
  if (!alt || alt.edges.length === 0) return null;

  let lenM = 0;
  let minutes = 0;
  let jamWeighted = 0;
  const byRoad = new Map<string, number>();
  for (const edge of alt.edges) {
    lenM += edge.len;
    minutes += minutesFor(edge.len, scoreOf(edge.roadId));
    jamWeighted += edge.len * (predOf(edge.roadId)?.jamChanceNextHour ?? 0);
    byRoad.set(edge.roadId, (byRoad.get(edge.roadId) ?? 0) + edge.len);
  }
  if (lenM <= 0) return null;

  // Same trip on the selected road itself (same speed model)
  const own = shortestPath(g, s, e, (rid) => rid === roadId, (edge) => edge.len);
  const ownLen = own ? own.edges.reduce((sum, edge) => sum + edge.len, 0) : dist(g.nodes[s], g.nodes[e]) * 1.3;
  const ownMinutes = minutesFor(ownLen, scoreOf(roadId));

  return {
    roadIds: [...byRoad.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    path: alt.nodes.map((n) => g.nodes[n]),
    distanceKm: Math.round(lenM / 100) / 10,
    minutes: Math.round(minutes),
    jamChance: Math.round(jamWeighted / lenM),
    minutesSaved: Math.round(ownMinutes - minutes),
  };
}
