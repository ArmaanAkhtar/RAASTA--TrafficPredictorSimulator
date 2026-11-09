// src/lib/trip.ts
// Shared state of "Plan a trip", so the planner (left) and the trip panel (right) stay in sync.
import { create } from 'zustand';
import { useAppStore } from '../store/useAppStore';
import { useAreaStore } from './area';
import type { Place } from './places';
import type { TripMode, TripResult, Vehicle } from './routing';

export const MY_LOCATION_ID = 'my-location';

interface TripState {
  from: Place | null;
  to: Place | null;
  mode: TripMode;
  /** How the user travels: car, motorbike or on foot (paidal) */
  vehicle: Vehicle;
  /** Trip is shown (map + panel) until the user picks a road or clears it. */
  active: boolean;
  /** Both goals for the current From/To/time; written by the planner. */
  results: { time: TripResult | null; petrol: TripResult | null } | null;
  setFrom: (p: Place | null) => void;
  setTo: (p: Place | null) => void;
  setMode: (m: TripMode) => void;
  setVehicle: (v: Vehicle) => void;
  swap: () => void;
  setActive: (a: boolean) => void;
  setResults: (r: TripState['results']) => void;
  clear: () => void;
}

export const useTripStore = create<TripState>((set) => ({
  from: null,
  to: null,
  mode: 'time',
  vehicle: 'car',
  active: true,
  results: null,
  setFrom: (from) => set({ from, active: true }),
  setTo: (to) => set({ to, active: true }),
  setMode: (mode) => set({ mode, active: true }),
  setVehicle: (vehicle) => set({ vehicle, active: true }),
  swap: () => set((s) => ({ from: s.to, to: s.from, active: true })),
  setActive: (active) => set({ active }),
  setResults: (results) => set({ results }),
  clear: () => set({ from: null, to: null, results: null, active: true }),
}));

/** Which result is the trip on screen: walking has one route only (stored under 'time'). */
export const tripKey = (s: { mode: TripMode; vehicle: Vehicle }): TripMode => (s.vehicle === 'walk' ? 'time' : s.mode);

/** True while the right-hand trip panel is on screen (layouts use it to keep clear of it). */
export function useTripPanelVisible(): boolean {
  const noRoad = useAppStore((s) => s.selectedRoadId === null);
  const noPlace = useAreaStore((s) => s.place === null);
  const hasTrip = useTripStore((s) => s.active && s.results !== null && s.results[tripKey(s)] !== null);
  return noRoad && noPlace && hasTrip;
}
