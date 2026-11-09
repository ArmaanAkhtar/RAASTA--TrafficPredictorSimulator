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
import { edgePoints, getDirectedGraph, headingIn, headingOut, turnRuleKey, walkingGraph, type DEdge, type DirectedGraph } from './roadGraph';
import type { Prediction, Pt, Road, RouteResult, SelectedTime } from './types';

const FREE_KMH = 50;
const HEAVY_KMH = 12;
/** If a road endpoint only touches the selected road, look this far for another start node. */
const ENDPOINT_SEARCH_M = 1500;
/** Ignore detours between road ends that are closer than this. */
const MIN_ROUTE_M = 1000;

// ---------------------------------------------------------------------------
// How the user travels: Car, Bike (motorbike) or Paidal (on foot)
// ---------------------------------------------------------------------------
export type Vehicle = 'car' | 'bike' | 'walk';

interface VehicleModel {
  freeKmh: number; // speed on a free road
  jamKmh: number; // speed in a full jam
  /** litres per 100 km at a rush score 0..1 */
  fuel: (s: number) => number;
}

const VEHICLES: Record<Vehicle, VehicleModel> = {
  // average Karachi car: ~6.5 L/100 km flowing, ~10 in stop-and-go
  car: { freeKmh: FREE_KMH, jamKmh: HEAVY_KMH, fuel: (s) => 6.5 + 3.5 * s * s },
  // 70-125cc motorbike: filters between cars, so a jam slows it far less; ~2.2-3 L/100 km
  bike: { freeKmh: 55, jamKmh: 28, fuel: (s) => 2.2 + 0.8 * s * s },
  // on foot: traffic does not slow you down, and no petrol
  walk: { freeKmh: 4.8, jamKmh: 4.8, fuel: () => 0 },
};

const clamp01 = (score: number): number => Math.min(100, Math.max(0, score)) / 100;

export function speedKmh(score: number, vehicle: Vehicle = 'car'): number {
  const v = VEHICLES[vehicle];
  return v.freeKmh - (v.freeKmh - v.jamKmh) * clamp01(score);
}

const minutesFor = (lenM: number, score: number, vehicle: Vehicle = 'car'): number =>
  (lenM / 1000 / speedKmh(score, vehicle)) * 60;

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
function findAltRouteGeometric(
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

// ===========================================================================
// Trip planner: From -> To with two goals
//   'time'   = Time save:   fastest trip using predicted speeds (may take a longer but clearer road)
//   'petrol' = Petrol save: least fuel, which is mostly the SHORTEST road distance, with only a small
//                           penalty for stop-and-go traffic. It will not pick a long detour just to
//                           avoid a jam, even if that costs more time.
// ===========================================================================
export type TripMode = 'time' | 'petrol';

export interface TripResult extends RouteResult {
  mode: TripMode;
  vehicle: Vehicle;
  fuelLitres: number;
  /** Length-weighted rush score of the route (0-100); below 40 = light = traffic-free. */
  avgScore: number;
}

/** Litres per 100 km (car: ~6.5 when flowing, ~10 in stop-and-go traffic; bike ~2.2-3; walking 0). */
export function fuelPer100Km(score: number, vehicle: Vehicle = 'car'): number {
  return VEHICLES[vehicle].fuel(clamp01(score));
}

const litresFor = (lenM: number, score: number, vehicle: Vehicle = 'car'): number =>
  (lenM / 1000) * (fuelPer100Km(score, vehicle) / 100);

/** Top speed inside a gali / residential street (speed breakers, parked cars, kids playing). */
const STREET_KMH: Record<Vehicle, number> = { car: 20, bike: 22, walk: 4.8 };
/** Galiyan are used within this distance of the start and the end of a trip. */
const STREET_NEAR_END_M = 2500;
/** Stop-and-go in galiyan: count them as at least this busy for petrol. */
const STREET_FUEL_SCORE = 45;

/** Minutes for one directed edge: like minutesFor, but slower on galiyan. */
function edgeMinutes(e: DEdge, score: number, vehicle: Vehicle): number {
  const kmh = e.street ? Math.min(speedKmh(score, vehicle), STREET_KMH[vehicle]) : speedKmh(score, vehicle);
  return (e.len / 1000 / kmh) * 60;
}

function edgeLitres(e: DEdge, score: number, vehicle: Vehicle): number {
  return litresFor(e.len, e.street ? Math.max(score, STREET_FUEL_SCORE) : score, vehicle);
}

/** Walkers stay off expressways, motorways and the bypass. */
const NO_WALK = /expressway|motorway|bypass/;

/** Nearest graph node on the main (connected) city network to a point. O(V). */
function nearestMainNode(g: RoadGraph, p: Pt): number {
  let best = -1;
  let bestD = Infinity;
  for (let n = 0; n < g.nodes.length; n++) {
    if (g.component[n] !== g.mainComponent || g.adj[n].length === 0) continue;
    const d = dist(p, g.nodes[n]);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/**
 * Route between two points (local metres). Returns null if they snap to the same spot or no path exists.
 * roadIds are ordered by how much of the trip each road covers (longest first).
 */
function findTripGeometric(
  roads: Road[],
  from: Pt,
  to: Pt,
  t: SelectedTime,
  rain: boolean,
  mode: TripMode,
  vehicle: Vehicle = 'car',
): TripResult | null {
  if (roads.length === 0) return null;
  const g = getGraph(roads);
  const start = nearestMainNode(g, from);
  const end = nearestMainNode(g, to);
  if (start < 0 || end < 0 || start === end) return null;

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

  const cost =
    mode === 'time' || vehicle === 'walk'
      ? (e: GraphEdge) => minutesFor(e.len, scoreOf(e.roadId), vehicle)
      : (e: GraphEdge) => litresFor(e.len, scoreOf(e.roadId), vehicle);
  const allowRoad = vehicle === 'walk' ? (rid: string) => !NO_WALK.test(rid) : () => true;

  const found = shortestPath(g, start, end, allowRoad, cost);
  if (!found || found.edges.length === 0) return null;

  let lenM = 0;
  let minutes = 0;
  let litres = 0;
  let jamWeighted = 0;
  let scoreWeighted = 0;
  const byRoad = new Map<string, number>();
  for (const e of found.edges) {
    const score = scoreOf(e.roadId);
    scoreWeighted += e.len * score;
    lenM += e.len;
    minutes += minutesFor(e.len, score, vehicle);
    litres += litresFor(e.len, score, vehicle);
    jamWeighted += e.len * (predOf(e.roadId)?.jamChanceNextHour ?? 0);
    byRoad.set(e.roadId, (byRoad.get(e.roadId) ?? 0) + e.len);
  }
  if (lenM <= 0) return null;

  return {
    mode,
    vehicle,
    roadIds: [...byRoad.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    path: [from, ...found.nodes.map((n) => g.nodes[n]), to],
    distanceKm: Math.round(lenM / 100) / 10,
    minutes: Math.max(1, Math.round(minutes)),
    jamChance: Math.round(jamWeighted / lenM),
    minutesSaved: 0,
    fuelLitres: Math.round(litres * 100) / 100,
    avgScore: Math.round(scoreWeighted / lenM),
  };
}


// ===========================================================================
// Directed routing (public/data/road_graph.bin): one-way carriageways, real junctions and
// mapped U-turn cuts only. Used whenever the graph has loaded; otherwise the geometric version.
// ===========================================================================

/** Better route around a busy road. Same contract as before. */
export function findAltRoute(roads: Road[], roadId: string, t: SelectedTime, rain: boolean): RouteResult | null {
  const dg = getDirectedGraph();
  return dg ? findAltRouteDirected(dg, roads, roadId, t, rain) : findAltRouteGeometric(roads, roadId, t, rain);
}

/** From -> To with a goal (Time save / Petrol save) and a way of travelling (car, bike, on foot). */
export function findTrip(
  roads: Road[],
  from: Pt,
  to: Pt,
  t: SelectedTime,
  rain: boolean,
  mode: TripMode,
  vehicle: Vehicle = 'car',
): TripResult | null {
  const dg = getDirectedGraph();
  if (!dg) return findTripGeometric(roads, from, to, t, rain, mode, vehicle);
  // On foot one-way rules do not apply: walk either way along any carriageway
  return findTripDirected(vehicle === 'walk' ? walkingGraph(dg) : dg, roads, from, to, t, rain, mode, vehicle);
}

/** Predictions per display road (and per road class for unnamed links / connectors), cached per call. */
function makeScorer(roads: Road[], t: SelectedTime, rain: boolean) {
  const roadById = new Map<string, Road>(roads.map((r) => [r.id, r]));
  const cache = new Map<string, Prediction>();
  const pseudo = (type: Road['type']): Road => ({ id: `__${type}`, name: '', type, segments: [], lengthM: 0, center: [0, 0] });
  const pred = (e: DEdge): Prediction => {
    const key = e.roadId && roadById.has(e.roadId) ? e.roadId : `__${e.type}`;
    let p = cache.get(key);
    if (!p) {
      const road = e.roadId ? roadById.get(e.roadId) : undefined;
      p = predict(road ?? pseudo(e.type), t, rain);
      cache.set(key, p);
    }
    return p;
  };
  // Per stored edge, so the search (hundreds of thousands of lookups) does no string work
  const scoreOf = new Map<number, number>();
  const score = (e: DEdge): number => {
    let v = scoreOf.get(e.edge);
    if (v === undefined) {
      v = pred(e).nowScore;
      scoreOf.set(e.edge, v);
    }
    return v;
  };
  // The lowest rush anywhere right now: lets A* assume a realistic top speed
  let minScore = Infinity;
  for (const r of roads) minScore = Math.min(minScore, pred({ roadId: r.id, type: r.type } as DEdge).nowScore);
  for (const type of ['highway', 'arterial', 'local'] as const) minScore = Math.min(minScore, pred({ roadId: null, type } as DEdge).nowScore);
  return { score, jam: (e: DEdge) => pred(e).jamChanceNextHour, minScore: Number.isFinite(minScore) ? minScore : 0 };
}

interface DPath {
  nodes: number[];
  edges: DEdge[];
}

/**
 * Dijkstra from `start`. With `end` >= 0 it stops there; with a `targets` set it stops at the first
 * (cheapest) target reached and returns the path to it.
 * `heuristic` (optional, A*): a lower bound of the remaining cost from a node to `end`. Makes single-target
 * searches on the big street graph many times faster and still finds the best path.
 */
function dijkstraDirected(
  g: DirectedGraph,
  start: number,
  end: number,
  allow: (e: DEdge) => boolean,
  cost: (e: DEdge) => number,
  targets?: Set<number>,
  heuristic?: (node: number) => number,
): DPath | null {
  const n = g.nodes.length;
  const best = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const prevNode = new Int32Array(n).fill(-1);
  const prevEdge: Array<DEdge | undefined> = new Array<DEdge | undefined>(n);
  const h = heuristic ?? (() => 0);
  const heap = new MinHeap();
  best[start] = 0;
  heap.push(h(start), start);
  while (heap.size > 0) {
    const top = heap.pop();
    if (!top) break;
    const u = top.val;
    if (done[u]) continue;
    done[u] = 1;
    if (u === end || (targets && u !== start && targets.has(u))) {
      end = u;
      break;
    }
    const d = best[u];
    for (const e of g.out[u]) {
      if (done[e.to] || !allow(e)) continue;
      const nd = d + cost(e);
      if (nd < best[e.to]) {
        best[e.to] = nd;
        prevNode[e.to] = u;
        prevEdge[e.to] = e;
        heap.push(nd + h(e.to), e.to);
      }
    }
  }
  if (end < 0 || best[end] === Infinity) return null;
  const nodes = [end];
  const edges: DEdge[] = [];
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

// ---------------------------------------------------------------------------
// Turns. Pakistan drives on the LEFT, so a RIGHT turn crosses the oncoming traffic. On Karachi's big
// roads the two sides are split by a median, so you cannot simply turn right: you turn left, go to the
// next U-turn cut and come back. OpenStreetMap often draws such a road as ONE two-way line, so the
// router adds a big penalty to a right turn across (or onto) a two-way main road, and it obeys the
// turn restrictions mapped in OpenStreetMap (no right turn, only straight on ...).
// ---------------------------------------------------------------------------
const TURN_ANGLE = 0.6; // radians (~35 deg): sharper than this counts as a turn
const TURN_MIN = { straight: 0, left: 0.1, right: 0.4 }; // normal turn delay (minutes)
/** Extra minutes for a right turn across a two-way road of this class (0 motorway/trunk, 1 primary, 2 secondary) */
const CROSS_MEDIAN_MIN = [6, 4, 0.7];
/** Converting penalty minutes to the Petrol save cost (litres): about 0.8 km of driving per minute of penalty. */
const LITRES_PER_PENALTY_MIN = 0.05;

/** Signed turn angle from arriving edge e to leaving edge f, in (-PI, PI]; positive = left. */
function turnAngle(g: DirectedGraph, e: DEdge, f: DEdge): number {
  let a = headingOut(g, f) - headingIn(g, e);
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Waiting at traffic lights when crossing / turning right at a signalised junction (minutes). */
const SIGNAL_WAIT_MIN = 0.8;

/** Penalty in minutes for going from e into f at their shared node, or Infinity if the turn is not allowed. */
function turnMinutes(g: DirectedGraph, e: DEdge, f: DEdge): number {
  const v = e.to;
  // straight back the way you came (same stored edge): only at a dead end
  if (f.edge === e.edge) return g.out[v].length === 1 ? 2 : Infinity;
  const rule = g.turnRules.size > 0 ? g.turnRules.get(turnRuleKey(e)) : undefined;
  if (rule && (rule.no.has(f.edge) || (rule.only.size > 0 && !rule.only.has(f.edge)))) return Infinity;
  const angle = turnAngle(g, e, f);
  let pen = angle > TURN_ANGLE ? TURN_MIN.left : angle < -TURN_ANGLE ? TURN_MIN.right : TURN_MIN.straight;

  // 1. Going straight over a main road at a junction (from a side road / slip road to another one):
  //    the median is in the way unless there are traffic lights.
  const crossCls = g.mainCls[v];
  if (!e.main && !f.main && crossCls < CROSS_MEDIAN_MIN.length) {
    return pen + (g.signal[v] ? SIGNAL_WAIT_MIN : CROSS_MEDIAN_MIN[crossCls]);
  }
  // 2. A right turn onto or off a two-way main road crosses its other side.
  if (angle < -TURN_ANGLE) {
    let cross = 0;
    for (const x of [e, f]) {
      if (x.twoWay && x.main && x.cls < CROSS_MEDIAN_MIN.length) cross = Math.max(cross, CROSS_MEDIAN_MIN[x.cls]);
    }
    if (cross > 0) pen += g.signal[v] ? SIGNAL_WAIT_MIN : cross;
  }
  return pen;
}

interface TurnPath extends DPath {
  edges: DEdge[];
}

/**
 * Route that knows about turns: the search walks from edge to edge (not node to node), so it can charge
 * a turn and forbid a banned one. Same options as dijkstraDirected. `penaltyUnits` converts penalty
 * minutes into the cost unit (1 for minutes, litres per minute for Petrol save ...).
 */
function routeWithTurns(
  g: DirectedGraph,
  start: number,
  end: number,
  allow: (e: DEdge) => boolean,
  cost: (e: DEdge) => number,
  penaltyUnits: number,
  targets?: Set<number>,
  heuristic?: (node: number) => number,
): TurnPath | null {
  const m = g.dedges.length;
  const best = new Float64Array(m).fill(Infinity);
  const done = new Uint8Array(m);
  const prev = new Int32Array(m).fill(-1);
  const h = heuristic ?? (() => 0);
  const heap = new MinHeap();
  for (const f of g.out[start]) {
    if (!allow(f)) continue;
    const c = cost(f);
    if (c < best[f.id]) {
      best[f.id] = c;
      heap.push(c + h(f.to), f.id);
    }
  }
  let last = -1;
  while (heap.size > 0) {
    const top = heap.pop();
    if (!top) break;
    const s = top.val;
    if (done[s]) continue;
    done[s] = 1;
    const e = g.dedges[s];
    const v = e.to;
    if (v === end || (targets && targets.has(v))) {
      last = s;
      break;
    }
    for (const f of g.out[v]) {
      if (done[f.id] || !allow(f)) continue;
      const pen = turnMinutes(g, e, f);
      if (pen === Infinity) continue;
      const nd = best[s] + pen * penaltyUnits + cost(f);
      if (nd < best[f.id]) {
        best[f.id] = nd;
        prev[f.id] = s;
        heap.push(nd + h(f.to), f.id);
      }
    }
  }
  if (last < 0) return null;
  const edges: DEdge[] = [];
  for (let s = last; s >= 0; s = prev[s]) edges.push(g.dedges[s]);
  edges.reverse();
  return { nodes: [start, ...edges.map((e) => e.to)], edges };
}

/**
 * Real waiting time at the turns of a path (minutes), added to the shown trip time. The big median
 * penalty only steers the search; a crossing that cannot be avoided costs about a signal wait (1 min).
 */
function pathTurnMinutes(g: DirectedGraph, edges: DEdge[]): number {
  let total = 0;
  for (let i = 1; i < edges.length; i++) {
    const p = turnMinutes(g, edges[i - 1], edges[i]);
    if (p !== Infinity) total += Math.min(p, 1);
  }
  return total;
}

/** Nearest node on the main network that has at least one allowed outgoing edge. */
function nearestMainNode2(g: DirectedGraph, p: Pt, allow: (e: DEdge) => boolean = () => true, maxM = Infinity): number {
  let best = -1;
  let bestD = maxM;
  for (let i = 0; i < g.nodes.length; i++) {
    if (!g.main[i] || !g.out[i].some(allow)) continue;
    const d = dist(p, g.nodes[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Drawn route: the real carriageway geometry of every edge, joined. */
function pathPoints(g: DirectedGraph, edges: DEdge[]): Pt[] {
  const pts: Pt[] = [];
  edges.forEach((e, i) => {
    const seg = edgePoints(g, e);
    pts.push(...(i === 0 ? seg : seg.slice(1)));
  });
  return pts;
}

function summarise(edges: DEdge[], scorer: ReturnType<typeof makeScorer>, vehicle: Vehicle = 'car') {
  let lenM = 0;
  let minutes = 0;
  let litres = 0;
  let jamW = 0;
  let scoreW = 0;
  const byRoad = new Map<string, number>();
  for (const e of edges) {
    const sc = scorer.score(e);
    lenM += e.len;
    minutes += edgeMinutes(e, sc, vehicle);
    litres += edgeLitres(e, sc, vehicle);
    jamW += e.len * scorer.jam(e);
    scoreW += e.len * sc;
    if (e.roadId) byRoad.set(e.roadId, (byRoad.get(e.roadId) ?? 0) + e.len);
  }
  return {
    lenM,
    minutes,
    litres,
    jamChance: lenM > 0 ? Math.round(jamW / lenM) : 0,
    avgScore: lenM > 0 ? Math.round(scoreW / lenM) : 0,
    roadIds: [...byRoad.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
  };
}

function findTripDirected(
  g: DirectedGraph,
  roads: Road[],
  from: Pt,
  to: Pt,
  t: SelectedTime,
  rain: boolean,
  mode: TripMode,
  vehicle: Vehicle = 'car',
): TripResult | null {
  const baseAllow = vehicle === 'walk' ? (e: DEdge) => !(e.roadId && NO_WALK.test(e.roadId)) : () => true;
  const start = nearestMainNode2(g, from, baseAllow);
  const end = nearestMainNode2(g, to, baseAllow);
  if (start < 0 || end < 0 || start === end) return null;
  // Galiyan only for the first and last stretch (and short trips): in the middle the main roads,
  // links and cuts are always the way, and skipping the thousands of galiyan keeps the search fast
  const near = new Int8Array(g.nodes.length); // 0 unknown, 1 near an end, 2 far
  const nearEnd = (n: number): boolean => {
    if (near[n] === 0) {
      const p = g.nodes[n];
      near[n] = dist(p, from) <= STREET_NEAR_END_M || dist(p, to) <= STREET_NEAR_END_M ? 1 : 2;
    }
    return near[n] === 1;
  };
  const allow = (e: DEdge) => baseAllow(e) && (!e.street || nearEnd(e.from) || nearEnd(e.to));
  const scorer = makeScorer(roads, t, rain);
  // Walking: same speed everywhere, so the quickest walk is simply the shortest one
  const cost =
    mode === 'time' || vehicle === 'walk'
      ? (e: DEdge) => edgeMinutes(e, scorer.score(e), vehicle)
      : (e: DEdge) => edgeLitres(e, scorer.score(e), vehicle);
  // A* lower bound per metre of straight-line distance: top speed, or the lowest petrol use
  const perMetre =
    mode === 'time' || vehicle === 'walk'
      ? 60 / 1000 / speedKmh(scorer.minScore, vehicle)
      : fuelPer100Km(scorer.minScore, vehicle) / 100 / 1000;
  const goal = g.nodes[end];
  const heuristic = (n: number) => dist(g.nodes[n], goal) * perMetre;
  // On foot there are no turn rules; vehicles follow medians, U-turn cuts and turn restrictions
  const walking = vehicle === 'walk';
  const units = mode === 'time' ? 1 : LITRES_PER_PENALTY_MIN * (vehicle === 'bike' ? 0.35 : 1);
  const found = walking
    ? dijkstraDirected(g, start, end, allow, cost, undefined, heuristic)
    : routeWithTurns(g, start, end, allow, cost, units, undefined, heuristic);
  if (!found || found.edges.length === 0) return null;
  const sum = summarise(found.edges, scorer, vehicle);
  if (sum.lenM <= 0) return null;
  if (!walking) sum.minutes += pathTurnMinutes(g, found.edges);
  return {
    mode,
    vehicle,
    roadIds: sum.roadIds,
    path: [from, ...pathPoints(g, found.edges), to],
    distanceKm: Math.round(sum.lenM / 100) / 10,
    minutes: Math.max(1, Math.round(sum.minutes)),
    jamChance: sum.jamChance,
    minutesSaved: 0,
    fuelLitres: Math.round(sum.litres * 100) / 100,
    avgScore: sum.avgScore,
  };
}

function findAltRouteDirected(
  g: DirectedGraph,
  roads: Road[],
  roadId: string,
  t: SelectedTime,
  rain: boolean,
): RouteResult | null {
  // Nodes on the selected road (main network only)
  const onRoad = new Set<number>();
  g.out.forEach((list, u) => {
    for (const e of list) {
      if (e.roadId !== roadId) continue;
      if (g.main[u]) onRoad.add(u);
      if (g.main[e.to]) onRoad.add(e.to);
    }
  });
  const ends = [...onRoad];
  if (ends.length < 2) return null;

  // Farthest-apart pair of points along the road
  let a = -1;
  let b = -1;
  let far = -1;
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const d = dist(g.nodes[ends[i]], g.nodes[ends[j]]);
      if (d > far) {
        far = d;
        a = ends[i];
        b = ends[j];
      }
    }
  }
  if (a < 0 || far < MIN_ROUTE_M) return null;

  const scorer = makeScorer(roads, t, rain);
  // Better routes stay on real roads (no galiyan), and off the busy road itself
  const notRoad = (e: DEdge) => e.roadId !== roadId && !e.street;
  const timeCost = (e: DEdge) => e.len * (1 + scorer.score(e) / 50);

  // Try a -> b, then b -> a (the road's carriageways may only run one way between them)
  let alt: DPath | null = null;
  let s = a;
  let e2 = b;
  for (const [x, y] of [[a, b], [b, a]] as Array<[number, number]>) {
    const sx = nearestMainNode2(g, g.nodes[x], notRoad, ENDPOINT_SEARCH_M);
    if (sx < 0) continue;
    // Arrive anywhere near the far end (the road's own end point may only be reachable via the road)
    const near = new Set<number>();
    for (let i = 0; i < g.nodes.length; i++) {
      if (g.main[i] && dist(g.nodes[i], g.nodes[y]) <= ENDPOINT_SEARCH_M) near.add(i);
    }
    near.delete(sx);
    if (near.size === 0) continue;
    // timeCost is in weighted metres: ~600 per penalty minute
    const found = routeWithTurns(g, sx, -1, notRoad, timeCost, 600, near);
    if (found && found.edges.length > 0) {
      alt = found;
      s = x;
      e2 = y;
      break;
    }
  }
  if (!alt) return null;

  const sum = summarise(alt.edges, scorer);
  if (sum.lenM <= 0) return null;
  sum.minutes += pathTurnMinutes(g, alt.edges);

  // The same trip on the selected road itself (its own carriageway, same speed model)
  const onlyRoad = dijkstraDirected(g, s, e2, (e) => e.roadId === roadId, (e) => e.len);
  const ownLen = onlyRoad ? onlyRoad.edges.reduce((acc, e) => acc + e.len, 0) : far * 1.3;
  const road = roads.find((r) => r.id === roadId);
  const ownScore = road ? predict(road, t, rain).nowScore : 60;
  const ownMinutes = minutesFor(ownLen, ownScore);

  return {
    roadIds: sum.roadIds.filter((id) => id !== roadId),
    path: pathPoints(g, alt.edges),
    distanceKm: Math.round(sum.lenM / 100) / 10,
    minutes: Math.round(sum.minutes),
    jamChance: sum.jamChance,
    minutesSaved: Math.round(ownMinutes - sum.minutes),
  };
}
