// src/components/ui/TripPlanner.tsx
// "Plan a trip": From -> To with two goals, Time save (fastest) or Petrol save (least fuel ~ shortest).
// No props: reads/writes the store only. The chosen route is drawn as the blue route line.
'use client';

import Fuse from 'fuse.js';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LOCATION_MESSAGE, useLocationStore } from '../../lib/location';
import { findTrip, type TripMode, type TripResult, type Vehicle } from '../../lib/routing';
import { MY_LOCATION_ID, useTripStore } from '../../lib/trip';
import { useAreaStore } from '../../lib/area';
import { useRoadGraph } from '../../lib/roadGraphStore';
import { PLACE_KIND_LABEL, tripOptions, type Place } from '../../lib/places';
import { useOsmPlaces } from '../../lib/osmPlaces';
import { useAppStore } from '../../store/useAppStore';
import { useSettledValue } from '../three/usePerformance';
import { useMobileSheet } from './useMobileSheet';

const GLASS = 'raasta-panel';
const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** 75 -> "1 h 15 min" */
export function formatWalk(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const m = minutes % 60;
  return `${Math.floor(minutes / 60)} h${m ? ` ${m} min` : ''}`;
}
const KIND_LABEL = PLACE_KIND_LABEL;

const MODES: Array<{ mode: TripMode; label: string; icon: 'time' | 'petrol'; hint: string }> = [
  { mode: 'time', label: 'Time save', icon: 'time', hint: 'Fastest route with predicted traffic' },
  { mode: 'petrol', label: 'Petrol save', icon: 'petrol', hint: 'Shortest, least fuel, even if it takes longer' },
];

export const VEHICLES: Array<{ vehicle: Vehicle; label: string; hint: string }> = [
  { vehicle: 'car', label: 'Car', hint: 'Car: follows one-way roads, stuck in jams' },
  { vehicle: 'bike', label: 'Bike', hint: 'Motorbike: weaves through jams, uses little petrol' },
  { vehicle: 'walk', label: 'Paidal', hint: 'On foot: traffic does not slow you down' },
];

export function VehicleIcon({ vehicle, className = 'h-4 w-4' }: { vehicle: Vehicle; className?: string }) {
  const paths: Record<Vehicle, ReactNode> = {
    car: <><path d="m4 14 1.5-5h13L20 14v5h-2v-2H6v2H4z" /><path d="M5.5 14h13M7 9l1-3h8l1 3" /><circle cx="7.5" cy="14.5" r="1" /><circle cx="16.5" cy="14.5" r="1" /></>,
    bike: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="m6 17 4-7h4l4 7m-8-7 3 7h5m-6-10h3" /><path d="M9 7H7" /></>,
    walk: <><circle cx="13" cy="5" r="2" /><path d="m11 10 3-1 2 3 3 1M11 10l-2 4-3 2m8-3-3 4-1 4m4-4 3 4" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[vehicle]}
    </svg>
  );
}

function ModeIcon({ icon }: { icon: 'time' | 'petrol' }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon === 'time' ? (
        <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
      ) : (
        <><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M5 21h12M16 8h2l3 3v6a2 2 0 0 1-2 2h-1" /><path d="M8 7h5v5H8zM19 11v4" /></>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// One "From" or "To" box with fuzzy search over areas, landmarks and roads
// ---------------------------------------------------------------------------
function PlaceInput({
  label,
  value,
  onChange,
  options,
  mobileEmbedded,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  options: Place[];
  mobileEmbedded: boolean;
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
      <label className={`flex items-center gap-2 border border-[#1f2a44] focus-within:border-[#7cc4ff] ${
        mobileEmbedded
          ? 'h-12 rounded-[14px] bg-[#141d33] px-3'
          : 'rounded-lg bg-[#0b1220]/60 px-2.5 py-2'
      }`}>
        <span className={`shrink-0 font-semibold uppercase text-slate-400 ${mobileEmbedded ? 'w-9 text-xs' : 'w-8 text-[11px]'}`}>{label}</span>
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
          className={`w-full min-w-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none ${mobileEmbedded ? 'pr-9' : ''}`}
          role="combobox"
          aria-label={`${label} place`}
          aria-expanded={shown}
          aria-controls={`${label.toLowerCase()}-place-options`}
          aria-autocomplete="list"
        />
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(null)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:text-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </label>
      {shown && (
        <ul id={`${label.toLowerCase()}-place-options`} role="listbox" className={`${GLASS} raasta-scroll absolute inset-x-0 top-full z-40 mt-1 max-h-[min(50dvh,24rem)] overflow-y-auto overscroll-contain py-1`}>
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
export default function TripPlanner({
  mobileSheetActive = true,
  mobileEmbedded = false,
  onMapAction,
}: {
  mobileSheetActive?: boolean;
  mobileEmbedded?: boolean;
  onMapAction?: () => void;
} = {}) {
  const roads = useAppStore((s) => s.roads);
  // settled: re-route once the time slider stops, not on every step while dragging
  const selectedTime = useSettledValue(useAppStore((s) => s.selectedTime), 250);
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
  const plannerOpen = mobileEmbedded || open;
  const { snapPoint, snapHeightClass, handleProps } = useMobileSheet();
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
      time: findTrip(roads, fromPoint, toPoint, selectedTime, 'time', vehicle),
      // walking: one route only (same speed everywhere), so skip the second search
      petrol: vehicle === 'walk' ? null : findTrip(roads, fromPoint, toPoint, selectedTime, 'petrol', vehicle),
    });
  }, [roads, from, to, fromPoint, toPoint, selectedTime, vehicle, setResults, graphVersion]);

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
  const toggleRoute = () => {
    if (!current) return;
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
    onMapAction?.();
  };

  return (
    <div
      data-mobile-sheet={!mobileEmbedded && open && mobileSheetActive ? '' : undefined}
      data-sheet-snap={!mobileEmbedded && open && mobileSheetActive ? snapPoint : undefined}
      onWheelCapture={(event) => {
        if (plannerOpen) event.stopPropagation();
      }}
      className={mobileEmbedded ? 'flex min-h-0 flex-none flex-col overflow-hidden' : `${GLASS} p-3 ${
        plannerOpen
          ? `fixed inset-x-0 bottom-0 z-30 flex ${snapHeightClass} flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] md:static md:h-auto md:max-h-none md:flex-none md:pb-3`
          : ''
      }`}
    >
      {!mobileEmbedded && plannerOpen && (
        <button
          type="button"
          {...handleProps}
          className="-mx-3 -mt-3 mb-2 flex min-h-10 shrink-0 touch-none items-center justify-center md:hidden"
          aria-label={`Resize trip planner, currently ${snapPoint}`}
        >
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </button>
      )}
      {!mobileEmbedded && <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={plannerOpen}
        className="flex w-full items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7cc4ff]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7cc4ff]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
        </svg>
        <span className="flex-1 text-sm font-semibold text-slate-100">Plan a trip</span>
        {!plannerOpen && current && (
          <span className="text-xs text-slate-400">
            {current.minutes} min · {current.distanceKm} km
          </span>
        )}
        <span className={`text-slate-400 transition-transform ${plannerOpen ? 'rotate-180' : ''}`} aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>}

      {plannerOpen && (
        <div className={`raasta-scroll min-h-0 overflow-y-auto overscroll-contain ${
          mobileEmbedded
            ? 'raasta-mobile-planner-scroll flex-none space-y-3 overflow-y-auto px-4 pb-4 pt-3'
            : 'flex-1 space-y-2 mt-3'
        }`}>
          <div className={mobileEmbedded ? 'relative' : 'flex items-stretch gap-2'}>
            <div className={mobileEmbedded ? 'min-w-0 space-y-2' : 'min-w-0 flex-1 space-y-2'}>
              <PlaceInput label="From" value={from} onChange={setFrom} options={options} mobileEmbedded={mobileEmbedded} />
              <PlaceInput label="To" value={to} onChange={setTo} options={options} mobileEmbedded={mobileEmbedded} />
            </div>
            <button
              type="button"
              aria-label="Swap From and To"
              onClick={swap}
              className={mobileEmbedded
                ? 'absolute -right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-slate-300'
                : 'raasta-button-secondary grid h-10 w-10 shrink-0 place-items-center text-slate-300'}
            >
              <span className="grid h-9 w-9 place-items-center rounded-full border border-[#1f2a44] bg-[#0f1729] shadow-[0_4px_12px_rgba(0,0,0,0.35)]">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0 3 3m-3-3-3 3" />
                </svg>
              </span>
            </button>
          </div>

          {from?.id !== MY_LOCATION_ID && (
            <button
              type="button"
              onClick={useMyLocation}
              className="flex min-h-11 items-center gap-1.5 text-xs font-medium text-[#7cc4ff] hover:text-[#f6f2ea]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {locStatus === 'locating' ? 'Finding your location…' : 'Start from my location'}
            </button>
          )}
          {(locStatus === 'denied' || locStatus === 'unavailable' || locStatus === 'outside') && (
            <p className="text-[11px] leading-snug text-[#f6f2ea]/80">{LOCATION_MESSAGE[locStatus]}</p>
          )}

          {/* How you travel */}
          <div role="radiogroup" aria-label="How you travel" className={`grid grid-cols-3 ${
            mobileEmbedded
              ? 'h-11 overflow-hidden rounded-[14px] border border-[#1f2a44] bg-[#0b1220]'
              : 'gap-1 rounded-lg border border-[#1f2a44] bg-[#0b1220]/60 p-1'
          }`}>
            {VEHICLES.map((v) => (
              <button
                key={v.vehicle}
                type="button"
                role="radio"
                aria-checked={vehicle === v.vehicle}
                title={v.hint}
                onClick={() => setVehicle(v.vehicle)}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 px-1 text-xs font-semibold transition-colors ${
                  vehicle === v.vehicle ? 'bg-[#7cc4ff] text-[#0b1220]' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <VehicleIcon vehicle={v.vehicle} className="h-4 w-4 shrink-0" />
                <span className="truncate">{v.label}</span>
              </button>
            ))}
          </div>

          {/* Goal (not for walking: a walk is just the shortest way) */}
          {!walking && (
          <div role="radiogroup" aria-label="Trip goal" className={`grid grid-cols-2 ${
            mobileEmbedded
              ? 'h-11 overflow-hidden rounded-[14px] border border-[#1f2a44] bg-[#0b1220]'
              : 'gap-1 rounded-lg border border-[#1f2a44] bg-[#0b1220]/60 p-1'
          }`}>
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                title={m.hint}
                onClick={() => setMode(m.mode)}
                className={`flex min-h-11 items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
                  mode === m.mode ? 'bg-[#7cc4ff] text-[#0b1220]' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <ModeIcon icon={m.icon} /> {m.label}
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
                <div className={`border border-[#7cc4ff]/60 bg-[#7cc4ff]/10 ${mobileEmbedded ? 'rounded-[14px] p-4' : 'rounded-lg p-2'}`}>
                  <p className="text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <VehicleIcon vehicle="walk" /> Paidal (on foot)
                    </span>
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
                      className={`border text-left transition-colors ${mobileEmbedded ? 'min-h-24 rounded-[14px] p-4' : 'rounded-lg p-2'} ${
                        on ? 'border-[#7cc4ff]/60 bg-[#7cc4ff]/10' : 'border-[#1f2a44] bg-[#0f1729]/45 hover:bg-[#0f1729]/80'
                      }`}
                    >
                      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <ModeIcon icon={m.icon} /> {m.label}
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
              {!mobileEmbedded && <div className="flex gap-2">
                <button
                  type="button"
                  onClick={toggleRoute}
                  className="raasta-button-primary min-h-10 flex-1 py-1.5 text-xs"
                >
                  {onMap ? 'Hide from map' : 'Show on map'}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="raasta-button-secondary min-h-10 px-3 py-1.5 text-xs text-slate-300"
                >
                  Clear
                </button>
              </div>}
              {mobileEmbedded && (
                <button
                  type="button"
                  onClick={clear}
                  className="min-h-11 rounded-[14px] px-3 text-xs font-medium text-[#8f9bb8] hover:bg-white/5 hover:text-[#f6f2ea]"
                >
                  Clear trip
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {mobileEmbedded && (
        <div className="z-10 shrink-0 border-t border-[#1f2a44] bg-[#0f1729] px-4 pb-3 pt-3">
          <button
            type="button"
            onClick={toggleRoute}
            disabled={!current}
            className="raasta-button-primary h-12 w-full rounded-[14px] text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {onMap ? 'Hide from map' : 'Find route'}
          </button>
        </div>
      )}
    </div>
  );
}
