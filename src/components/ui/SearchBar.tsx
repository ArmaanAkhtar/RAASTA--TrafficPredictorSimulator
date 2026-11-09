// src/components/ui/SearchBar.tsx
// Fuzzy road search. No props: reads/writes the store only.
'use client';

import Fuse from 'fuse.js';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { LEVEL_COLOR, predict } from '../../lib/api';
import { useAreaStore } from '../../lib/area';
import { CAT_ICON, PLACE_KIND_LABEL, type Place } from '../../lib/places';
import { useAllPlaces } from '../../lib/osmPlaces';
import { useTripStore } from '../../lib/trip';
import type { Road, RoadType } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const MAX_RESULTS = 8;
const TYPE_LABEL: Record<RoadType, string> = { highway: 'Highway', arterial: 'Arterial', local: 'Local road' };
const GLASS = 'rounded-2xl border border-white/10 bg-[#0b1220]/75 shadow-xl backdrop-blur-md';

/** "Shahrah-e-Faisal" -> "shahrahefaisal", "shahra faisal" -> "shahrafaisal" (so they match closely). */
const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A search result: a road, or an area / landmark (shows the cameras around it). */
type Hit = { kind: 'road'; road: Road } | { kind: 'place'; place: Place };

interface SearchItem {
  hit: Hit;
  key: string;
  alt: string;
}

const hitId = (h: Hit) => (h.kind === 'road' ? h.road.id : h.place.id);
/** "Block 13-D, Gulshan-e-Iqbal" can also be found as "gulshan block 13" */
const altKey = (name: string) => normalise(name.split(',').reverse().join(' '));
const hitName = (h: Hit) => (h.kind === 'road' ? h.road.name : h.place.name);

export default function SearchBar() {
  const roads = useAppStore((s) => s.roads);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);
  const selectRoad = useAppStore((s) => s.selectRoad);

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const places = useAllPlaces();
  const fuse = useMemo(
    () =>
      new Fuse<SearchItem>(
        [
          ...places.map((place) => ({ hit: { kind: 'place' as const, place }, key: normalise(place.name), alt: altKey(place.name) })),
          ...roads.map((road) => ({ hit: { kind: 'road' as const, road }, key: normalise(road.name), alt: '' })),
        ],
        { keys: ['key', 'alt'], threshold: 0.35, ignoreLocation: true },
      ),
    [roads, places],
  );

  const results = useMemo(() => {
    const q = normalise(query);
    if (!q) return [];
    return fuse.search(q, { limit: MAX_RESULTS }).map((r) => r.item.hit);
  }, [fuse, query]);

  // "/" anywhere on the page focuses the search box
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/') return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (hit: Hit) => {
    if (hit.kind === 'road') {
      useAreaStore.getState().setPlace(null);
      selectRoad(hit.road.id);
    } else {
      // Area / landmark: fly there and list its cameras; it replaces a road or trip on the right
      if (useAppStore.getState().selectedRoadId !== null) selectRoad(null);
      useTripStore.getState().setActive(false);
      useAreaStore.getState().setPlace(hit.place);
    }
    setQuery(hitName(hit));
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      const hit = results[active];
      if (hit) {
        e.preventDefault();
        choose(hit);
      }
    } else if (e.key === 'Escape') {
      if (open && query) {
        setOpen(false);
      } else {
        setQuery('');
        inputRef.current?.blur();
      }
    }
  };

  const showDropdown = open && query.trim() !== '';

  return (
    <div className="relative w-full">
      <div className={`${GLASS} flex items-center gap-2 px-3 py-2.5`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Search a road or area, e.g. Clifton"
          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="road-search-results"
          aria-autocomplete="list"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="rounded px-1 text-slate-400 hover:text-slate-100"
          >
            ×
          </button>
        ) : (
          <kbd className="hidden rounded border border-white/15 px-1.5 text-[11px] text-slate-400 sm:inline">/</kbd>
        )}
      </div>

      {showDropdown && (
        <ul id="road-search-results" role="listbox" className={`${GLASS} absolute inset-x-0 top-full z-40 mt-2 overflow-hidden py-1`}>
          {results.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">No roads or places found</li>}
          {results.map((hit, i) => {
            const id = hitId(hit);
            return (
              <li key={id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // keep focus in the input so onBlur does not close the list before the click lands
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === active ? 'bg-white/10' : ''}`}
                >
                  {hit.kind === 'road' ? (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: LEVEL_COLOR[predict(hit.road, selectedTime, rain).nowLevel] }}
                    />
                  ) : (
                    <span className="w-2.5 shrink-0 text-center text-[11px]" aria-hidden>
                      {hit.place.cat ? CAT_ICON[hit.place.cat] ?? '📍' : '📍'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">{hitName(hit)}</span>
                    <span className="block text-xs text-slate-400">
                      {hit.kind === 'road'
                        ? `${TYPE_LABEL[hit.road.type]} · ${(hit.road.lengthM / 1000).toFixed(1)} km`
                        : `${PLACE_KIND_LABEL[hit.place.kind]} · cameras nearby`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
