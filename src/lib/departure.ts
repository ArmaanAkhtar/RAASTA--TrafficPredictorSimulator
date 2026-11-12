// src/lib/departure.ts
// Best time to leave: try departing every 15 minutes for the next 2 hours on the same From -> To.
// Pure functions (no React, no store), so they can be tested with: npx tsx scripts/test-trip.ts
import { findTrip, type TripMode, type TripResult, type Vehicle } from './routing';
import type { Pt, Road, SelectedTime } from './types';

// ===========================================================================
export const LOOKAHEAD_MIN = 120;
export const STEP_MIN = 15;

export interface DepartureSlot {
  offsetMin: number; // 0 = the selected time
  time: SelectedTime;
  trip: TripResult | null;
  trafficFree: boolean;
}

export type LeaveAdvice =
  | { kind: 'clear-now' }
  | { kind: 'wait'; slot: DepartureSlot; savesMin: number }
  | { kind: 'better-later'; slot: DepartureSlot; savesMin: number }
  | { kind: 'walk' } // on foot: traffic does not change the time
  | { kind: 'steady'; worsens: boolean } // busy but moving; waiting will not help (worsens: it gets slower later)
  | { kind: 'jammed' }
  | { kind: 'none' };

/** Add minutes to a day/hour/minute, rolling over midnight into the next day. */
export function addMinutes(t: SelectedTime, minutes: number): SelectedTime {
  const total = t.hour * 60 + t.minute + minutes;
  const dayShift = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;
  return { day: (((t.day + dayShift) % 7) + 7) % 7, hour: Math.floor(inDay / 60), minute: inDay % 60 };
}

/** A route counts as traffic-free when its average rush is light and a jam is unlikely. */
/** A route counts as jammed when its average rush is heavy or a jam is likely. */
export const isJammed = (trip: TripResult | null): boolean => trip !== null && (trip.avgScore > 70 || trip.jamChance >= 50);

export const isTrafficFree = (trip: TripResult | null): boolean =>
  trip !== null && trip.avgScore < 40 && trip.jamChance < 35;

export function planDeparture(
  roads: Road[],
  from: Pt,
  to: Pt,
  start: SelectedTime,
  mode: TripMode,
  vehicle: Vehicle = 'car',
): { slots: DepartureSlot[]; advice: LeaveAdvice } {
  if (vehicle === 'walk') {
    const trip = findTrip(roads, from, to, start, mode, 'walk');
    const slots = [{ offsetMin: 0, time: start, trip, trafficFree: true }];
    return { slots, advice: trip ? { kind: 'walk' } : { kind: 'none' } };
  }
  const slots: DepartureSlot[] = [];
  for (let offset = 0; offset <= LOOKAHEAD_MIN; offset += STEP_MIN) {
    const time = addMinutes(start, offset);
    const trip = findTrip(roads, from, to, time, mode, vehicle);
    slots.push({ offsetMin: offset, time, trip, trafficFree: isTrafficFree(trip) });
  }

  const now = slots[0];
  if (!now.trip) return { slots, advice: { kind: 'none' } };
  if (now.trafficFree) return { slots, advice: { kind: 'clear-now' } };

  const firstFree = slots.find((s) => s.offsetMin > 0 && s.trafficFree && s.trip);
  if (firstFree?.trip) {
    return { slots, advice: { kind: 'wait', slot: firstFree, savesMin: now.trip.minutes - firstFree.trip.minutes } };
  }

  // No traffic-free window: is any later start at least 15% quicker?
  let best: DepartureSlot | null = null;
  for (const s of slots) {
    if (s.offsetMin > 0 && s.trip && (!best?.trip || s.trip.minutes < best.trip.minutes)) best = s;
  }
  if (best?.trip && best.trip.minutes <= now.trip.minutes * 0.85) {
    return { slots, advice: { kind: 'better-later', slot: best, savesMin: now.trip.minutes - best.trip.minutes } };
  }
  // Nothing better in the next 2 hours: "jammed" only if it really is jammed, otherwise busy but steady
  if (isJammed(now.trip)) return { slots, advice: { kind: 'jammed' } };
  const later = slots.filter((s) => s.offsetMin > 0 && s.trip).map((s) => s.trip?.minutes ?? 0);
  const worsens = later.length > 0 && Math.max(...later) >= now.trip.minutes * 1.15;
  return { slots, advice: { kind: 'steady', worsens } };
}
