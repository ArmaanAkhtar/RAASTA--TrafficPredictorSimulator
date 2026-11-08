// src/lib/prediction.ts
// The prediction "brain". Pure and synchronous: no fetch, no React.
//
// score(time) = base(time) x dayFactor x capacityFactor + rainBoost + jitter, clamped 0-100
// jamChanceNextHour = logistic(score one hour later)
import type { HourPoint, Prediction, Road, RoadType, RushLevel, SelectedTime } from './types';
import { RUSH_PROFILES, type HourlyProfile } from './rushProfiles';

// ============================================================================
// CONFIG: every tunable number lives here. Tweak, then run:
//   npx tsx scripts/test-prediction.ts
// ============================================================================
export const CONFIG = {
  // Level thresholds (from the contract): light < 40, medium 40-70, heavy > 70
  mediumFrom: 40,
  heavyAbove: 70,

  // Whole-day multiplier per weekday, index 0 = Sunday ... 6 = Saturday
  //            Sun   Mon   Tue  Wed  Thu  Fri   Sat
  dayFactor: [0.62, 1.04, 1.0, 1.0, 1.0, 0.98, 0.82],

  // Friday: dip during Jummah prayer, then a surge as everyone leaves together
  fridayPrayer: { start: 12.5, end: 14.5, factor: 0.6 }, // 12:30 - 14:30
  fridaySurge: { end: 16.5, factor: 1.12 }, // 14:30 - 16:30

  // Narrower roads choke faster
  capacityFactor: { highway: 1.0, arterial: 1.04, local: 0.96 } satisfies Record<RoadType, number>,

  // Points added when it rains (Karachi roads flood, local roads worst)
  rainBoost: { highway: 14, arterial: 18, local: 22 } satisfies Record<RoadType, number>,

  // Stable per-road random offset (+/- this many points) so same-type roads differ
  jitter: 6,
  // Roads with their own profile get less jitter (their pattern is already specific)
  jitterScaleForNamedRoads: 0.5,

  // Jam chance = 100 / (1 + exp(-(score - jamCenter) / jamWidth))
  jamCenter: 75,
  jamWidth: 10,
};

export const LEVEL_COLOR: Record<RushLevel, string> = {
  light: '#30a46c',
  medium: '#f5a524',
  heavy: '#e5484d',
};

export function levelOf(score: number): RushLevel {
  if (score > CONFIG.heavyAbove) return 'heavy';
  if (score >= CONFIG.mediumFrom) return 'medium';
  return 'light';
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const normDay = (d: number): number => ((Math.floor(d) % 7) + 7) % 7;

/** FNV-1a hash -> number in [0, 1). Same id always gives the same value. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function profileFor(road: Road): { profile: HourlyProfile; named: boolean } {
  const named = Object.prototype.hasOwnProperty.call(RUSH_PROFILES.byRoad, road.name);
  return named
    ? { profile: RUSH_PROFILES.byRoad[road.name], named: true }
    : { profile: RUSH_PROFILES.byType[road.type], named: false };
}

/** Base score at fractional hour t (0 <= t < 24), linear between whole hours. */
function baseAt(profile: HourlyProfile, t: number): number {
  const h0 = Math.floor(t) % 24;
  const h1 = (h0 + 1) % 24;
  const f = t - Math.floor(t);
  return (profile[h0] ?? 0) * (1 - f) + (profile[h1] ?? 0) * f;
}

function dayFactorAt(day: number, t: number): number {
  let f = CONFIG.dayFactor[day] ?? 1;
  if (day === 5) {
    const { start, end, factor } = CONFIG.fridayPrayer;
    if (t >= start && t < end) f *= factor;
    else if (t >= end && t < CONFIG.fridaySurge.end) f *= CONFIG.fridaySurge.factor;
  }
  return f;
}

/** Raw (unrounded) score for a road at a given day and fractional hour. */
function scoreAt(road: Road, day: number, t: number, rain: boolean): number {
  const { profile, named } = profileFor(road);
  const base = baseAt(profile, t);
  const jitterRange = CONFIG.jitter * (named ? CONFIG.jitterScaleForNamedRoads : 1);
  const jitter = (hash01(road.id) * 2 - 1) * jitterRange;
  const rainBoost = rain ? CONFIG.rainBoost[road.type] : 0;
  const s = base * dayFactorAt(day, t) * CONFIG.capacityFactor[road.type] + rainBoost + jitter;
  return clamp(s, 0, 100);
}

function jamChance(score: number): number {
  return Math.round(100 / (1 + Math.exp(-(score - CONFIG.jamCenter) / CONFIG.jamWidth)));
}

// ---------------------------------------------------------------------------
// Public API (matches the shared contract)
// ---------------------------------------------------------------------------
export function predict(road: Road, t: SelectedTime, rain: boolean): Prediction {
  const day = normDay(t.day);
  const now = clamp(t.hour + t.minute / 60, 0, 23.999);

  const nowScore = Math.round(scoreAt(road, day, now, rain));

  // One hour later (may roll over into the next day)
  let nextT = now + 1;
  let nextDay = day;
  if (nextT >= 24) {
    nextT -= 24;
    nextDay = (day + 1) % 7;
  }
  const nextScore = scoreAt(road, nextDay, nextT, rain);

  const hourly: HourPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const score = Math.round(scoreAt(road, day, h, rain));
    hourly.push({ hour: h, score, level: levelOf(score) });
  }

  return {
    roadId: road.id,
    nowScore,
    nowLevel: levelOf(nowScore),
    jamChanceNextHour: jamChance(nextScore),
    hourly,
  };
}
