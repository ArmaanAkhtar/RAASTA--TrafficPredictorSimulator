// src/components/ui/TripPlanner.tsx
// "Plan a trip": From -> To with two goals, Time save (fastest) or Petrol save (least fuel ~ shortest).
// No props: reads/writes the store only. The chosen route is drawn as the blue route line.
'use client';

import Fuse from 'fuse.js';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { LOCATION_MESSAGE, useLocationStore } from '../../lib/location';
import { findTrip, type TripMode, type TripResult, type Vehicle } from '../../lib/routing';
import { MY_LOCATION_ID, useTripStore } from '../../lib/trip';
import { useAreaStore } from '../../lib/area';
import { useRoadGraph } from '../../lib/roadGraphStore';
import { PLACE_KIND_LABEL, tripOptions, type Place } from '../../lib/places';
import { useOsmPlaces } from '../../lib/osmPlaces';
import { useAppStore } from '../../store/useAppStore';
import { useSettledValue } from '../three/usePerformance';

const GLASS = 'rounded-2xl border border-white/10 bg-[#0b1220]/75 shadow-xl backdrop-blur-md';
const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** 75 -> "1 h 15 min" */
export function formatWalk(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const m = minutes % 60;
  return `${Math.floor(minutes / 60)} h${m ? ` ${m} min` : ''}`;
}
const KIND_LABEL = PLACE_KIND_LABEL;

const MODES: Array<{ mode: TripMode; label: string; icon: string; hint: string }> = [
  { mode: 'time', label: 'Time save', icon: '⏱', hint: 'Fastest route with predicted traffic' },
  { mode: 'petrol', label: 'Petrol save', icon: '⛽', hint: 'Shortest, least fuel, even if it takes longer' },
];

export const VEHICLES: Array<{ vehicle: Vehicle; label: string; icon: string; hint: string }> = [
  { vehicle: 'car', label: 'Car', icon: '🚗', hint: 'Car: follows one-way roads, stuck in jams' },
  { vehicle: 'bike', label: 'Bike', icon: '🏍️', hint: 'Motorbike: weaves through jams, uses little petrol' },
  { vehicle: 'walk', label: 'Paidal', icon: '🚶', hint: 'On foot: traffic does not slow you down' },
];

// ---------------------------------------------------------------------------
// One "From" or "To" box with fuzzy search over areas, landmarks and roads
// ---------------------------------------------------------------------------
function PlaceInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  options: Place[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(
        // "Block 13-D, Gulshan-e-Iqbal" is also found by "gulshan block 13"
        options.map((p) => ({ p, key: normalise(p.name), alt: normalise(p.name.split(',').reverse().join(' ')) })),
        { keys: ['key', 'alt'], threshold: 0.35, ignoreLocation: true },
      ),
    [options],
  );
  const results = useMemo(() => {
    const q = normalise(query);
    return q ? fuse.search(q, { limit: 6 }).map((r) => r.item.p) : [];
  }, [fuse, query]);

  const choose = (p: Place) => {
    onChange(p);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const shown = open && query.trim() !== '';

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 focus-within:border-[#ffb547]/60">
        <span className="w-8 shrink-0 text-[11px] font-semibold uppercase text-slate-400">{label}</span>
        <input
          ref={inputRef}
          value={value && !open ? value.name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={label === 'From' ? 'e.g. Gulshan-e-Iqbal' : 'e.g. Clifton'}
          className="w-full min-w-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          role="combobox"
          aria-label={`${label} place`}
          aria-expanded={shown}
          aria-autocomplete="list"
        />
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(null)}
            className="text-slate-400 hover:text-slate-100"
          >
            ×
          </button>
        )}
      </label>
      {shown && (
        <ul role="listbox" className={`${GLASS} absolute inset-x-0 top-full z-40 mt-1 overflow-hidden py-1`}>
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No match</li>}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${i === active ? 'bg-white/10' : ''}`}
              >
                <span className="truncate text-slate-100">{p.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{KIND_LABEL[p.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------
export default function TripPlanner() {
  const roads = useAppStore((s) => s.roads);
  // settled: re-route once the time slider stops, not on every step while dragging
  const selectedTime = useSettledValue(useAppStore((s) => s.selectedTime), 250);
  const rain = useAppStore((s) => s.rain);
  const altRoute = useAppStore((s) => s.altRoute);
  const showRoute = useAppStore((s) => s.showRoute);

  const from = useTripStore((s) => s.from);
  const to = useTripStore((s) => s.to);
  const mode = useTripStore((s) => s.mode);
  const vehicle = useTripStore((s) => s.vehicle);
  const active = useTripStore((s) => s.active);
  const trips = useTripStore((s) => s.results);
  const { setFrom, setTo, setMode, setVehicle, swap, setActive, setResults, clear } = useTripStore.getState();

  const userPoint = useLocationStore((s) => s.point);
  const locStatus = useLocationStore((s) => s.status);

  const graphVersion = useRoadGraph((s) => s.version); // re-route when the directed graph arrives
  const [open, setOpen] = useState(false);
  const shownRoute = useRef<TripResult | null>(null); // the route object this planner put on the map

  // Picking a road (search, 3D click, demo) hands the map over to the road's own better route
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.selectedRoadId !== null && state.selectedRoadId !== prev.selectedRoadId) {
          useTripStore.getState().setActive(false);
        }
      }),
    [],
  );

  // "My location" as a From/To option (only when we know where the user is)
  const myLocation: Place | null = useMemo(
    () => (userPoint ? { id: MY_LOCATION_ID, name: 'My location', kind: 'location', point: userPoint } : null),
    [userPoint],
  );
  const osmPlaces = useOsmPlaces((s) => s.places);
  const options = useMemo(
    () => (myLocation ? [myLocation, ...tripOptions(roads, osmPlaces)] : tripOptions(roads, osmPlaces)),
    [roads, myLocation, osmPlaces],
  );

  // A From/To of "My location" follows the latest GPS point
  const fromPoint = from?.id === MY_LOCATION_ID ? userPoint : from?.point ?? null;
  const toPoint = to?.id === MY_LOCATION_ID ? userPoint : to?.point ?? null;

  // Both goals, so the user can compare them (shared with the trip panel)
  useEffect(() => {
    if (!from || !to || !fromPoint || !toPoint || from.id === to.id || roads.length === 0) {
      setResults(null);
      return;
    }
    setResults({
      time: findTrip(roads, fromPoint, toPoint, selectedTime, rain, 'time', vehicle),
      // walking: one route only (same speed everywhere), so skip the second search
      petrol: vehicle === 'walk' ? null : findTrip(roads, fromPoint, toPoint, selectedTime, rain, 'petrol', vehicle),
    });
  }, [roads, from, to, fromPoint, toPoint, selectedTime, rain, vehicle, setResults, graphVersion]);

  // Once the location arrives after "Use my location", fill it in
  const wantsLocation = useRef(false);
  useEffect(() => {
    if (!myLocation) return;
    const st = useTripStore.getState();
    // after "Start from my location", or "Directions" from a place panel (To set, From still empty)
    if ((wantsLocation.current || st.to) && !st.from) setFrom(myLocation);
    wantsLocation.current = false;
  }, [myLocation, setFrom]);

  const useMyLocation = () => {
    if (myLocation) {
      setFrom(myLocation);
    } else {
      wantsLocation.current = true;
      useLocationStore.getState().locate(false);
    }
  };

  const walking = vehicle === 'walk';
  const current = trips ? trips[walking ? 'time' : mode] : null;

  // Put the chosen route on the map (and take it off again when cleared)
  useEffect(() => {
    const store = useAppStore.getState();
    if (current && active) {
      if (store.selectedRoadId !== null) store.selectRoad(null); // a trip replaces a road selection
      if (useAreaStore.getState().place) useAreaStore.getState().setPlace(null); // ...and a picked place
      shownRoute.current = current;
      useAppStore.getState().setAltRoute(current);
      useAppStore.getState().setShowRoute(true);
    } else if (shownRoute.current && store.altRoute === shownRoute.current) {
      store.setAltRoute(null);
      store.setShowRoute(false);
      shownRoute.current = null;
    }
  }, [current, active]);

  const onMap = current !== null && altRoute === current && showRoute;

  return (
    <div className={`${GLASS} p-3`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb547]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7cc4ff]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
        </svg>
        <span className="flex-1 text-sm font-semibold text-slate-100">Plan a trip</span>
        {!open && current && (
          <span className="text-xs text-slate-400">
            {current.minutes} min · {current.distanceKm} km
          </span>
        )}
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <PlaceInput label="From" value={from} onChange={setFrom} options={options} />
              <PlaceInput label="To" value={to} onChange={setTo} options={options} />
            </div>
            <button
              type="button"
              aria-label="Swap From and To"
              onClick={swap}
              className="grid w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              ⇅
            </button>
          </div>

          {from?.id !== MY_LOCATION_ID && (
            <button
              type="button"
              onClick={useMyLocation}
              className="flex items-center gap-1.5 text-xs font-medium text-[#9cc9ff] hover:text-white"
            >
              <span aria-hidden>📍</span>
              {locStatus === 'locating' ? 'Finding your location…' : 'Start from my location'}
            </button>
          )}
          {(locStatus === 'denied' || locStatus === 'unavailable' || locStatus === 'outside') && (
            <p className="text-[11px] leading-snug text-amber-300/90">{LOCATION_MESSAGE[locStatus]}</p>
          )}

          {/* How you travel */}
          <div role="radiogroup" aria-label="How you travel" className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1">
            {VEHICLES.map((v) => (
              <button
                key={v.vehicle}
                type="button"
                role="radio"
                aria-checked={vehicle === v.vehicle}
                title={v.hint}
                onClick={() => setVehicle(v.vehicle)}
                className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  vehicle === v.vehicle ? 'bg-[#ffb547] text-[#0b1220]' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <span aria-hidden>{v.icon}</span> {v.label}
              </button>
            ))}
          </div>

          {/* Goal (not for walking: a walk is just the shortest way) */}
          {!walking && (
          <div role="radiogroup" aria-label="Trip goal" className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                title={m.hint}
                onClick={() => setMode(m.mode)}
                className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  mode === m.mode ? 'bg-[#7cc4ff] text-[#0b1220]' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <span aria-hidden>{m.icon}</span> {m.label}
              </button>
            ))}
          </div>
          )}

          {/* Results */}
          {from && to && from.id === to.id && <p className="text-xs text-slate-400">From and To are the same place.</p>}
          {trips && !current && <p className="text-xs text-slate-400">No road route found between these two places.</p>}
          {trips && current && (
            <div className="space-y-2">
              {walking ? (
                <div className="rounded-lg border border-[#7cc4ff]/60 bg-[#7cc4ff]/10 p-2">
                  <p className="text-[11px] text-slate-400">
                    <span aria-hidden>🚶</span> Paidal (on foot)
                  </p>
                  <p className="text-base font-bold tabular-nums text-slate-100">{formatWalk(current.minutes)}</p>
                  <p className="text-[11px] tabular-nums text-slate-400">{current.distanceKm} km · no petrol</p>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => {
                  const tr = trips[m.mode];
                  const on = m.mode === mode;
                  return (
                    <button
                      key={m.mode}
                      type="button"
                      onClick={() => setMode(m.mode)}
                      className={`rounded-lg border p-2 text-left transition-colors ${
                        on ? 'border-[#7cc4ff]/60 bg-[#7cc4ff]/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <p className="text-[11px] text-slate-400">
                        <span aria-hidden>{m.icon}</span> {m.label}
                      </p>
                      {tr ? (
                        <>
                          <p className="text-base font-bold tabular-nums text-slate-100">{tr.minutes} min</p>
                          <p className="text-[11px] tabular-nums text-slate-400">
                            {tr.distanceKm} km · {tr.fuelLitres.toFixed(1)} L
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">No route</p>
                      )}
                    </button>
                  );
                })}
              </div>
              )}
              <p className="text-[11px] text-slate-500">
                {walking ? 'Trip details are in the panel on the right.' : 'Best time to leave is in the panel on the right.'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onMap) {
                      useAppStore.getState().setShowRoute(false);
                    } else {
                      setActive(true);
                      const st = useAppStore.getState();
                      if (st.selectedRoadId !== null) st.selectRoad(null);
                      shownRoute.current = current;
                      useAppStore.getState().setAltRoute(current);
                      useAppStore.getState().setShowRoute(true);
                    }
                  }}
                  className="flex-1 rounded-lg bg-[#7cc4ff] py-1.5 text-xs font-semibold text-[#0b1220] hover:opacity-90"
                >
                  {onMap ? 'Hide from map' : 'Show on map'}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
