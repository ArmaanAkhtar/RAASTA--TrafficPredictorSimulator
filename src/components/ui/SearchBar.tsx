'use client';

import Image from 'next/image';
import Fuse from 'fuse.js';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAreaStore } from '../../lib/area';
import { useAllPlaces } from '../../lib/osmPlaces';
import { MAP_BBOX } from '../../lib/mapBounds';
import { projectLatLon } from '../../lib/projection';
import { PLACE_KIND_LABEL, type Place } from '../../lib/places';
import { useTripStore } from '../../lib/trip';
import type { Road, RoadType } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const MAX_RESULTS = 8;
const TYPE_LABEL: Record<RoadType, string> = { highway: 'Highway', arterial: 'Arterial', local: 'Local road' };
const GLASS = 'raasta-panel';
const PHOTON_CACHE = new Map<string, Place[]>();
let lastPhotonRequestAt = 0;

type Hit = { kind: 'road'; road: Road } | { kind: 'place'; place: Place };
type Result = { hit: Hit; source: 'offline' | 'photon'; score: number };

interface SearchItem {
  hit: Hit;
  name: string;
  nameEn?: string;
  nameUr?: string;
  aliases: string[];
  parentArea?: string;
  searchKeys: string[];
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: {
    name?: unknown;
    street?: unknown;
    city?: unknown;
    district?: unknown;
    county?: unknown;
    osm_key?: unknown;
    osm_value?: unknown;
    osm_type?: unknown;
    osm_id?: unknown;
    extent?: unknown;
  };
}

const normalise = (value: string): string =>
  value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const searchVariants = (value: string): string[] => {
  const compact = normalise(value);
  const withoutE = compact.replace(/e/g, '');
  return compact === withoutE ? [compact] : [compact, withoutE];
};
const makeSearchKeys = (...values: Array<string | undefined>): string[] =>
  [...new Set(values.filter((value): value is string => !!value).flatMap(searchVariants))];
const hitId = (hit: Hit) => hit.kind === 'road' ? `road-${hit.road.id}` : hit.place.id;
const hitName = (hit: Hit) => hit.kind === 'road' ? hit.road.name : hit.place.name;

function photonPlace(feature: PhotonFeature, index: number): Place | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') return null;
  const props = feature.properties ?? {};
  const name = typeof props.name === 'string' ? props.name.trim() : '';
  if (!name) return null;
  const lon = coordinates[0];
  const lat = coordinates[1];
  const center = projectLatLon(lat, lon);
  const extent = Array.isArray(props.extent) && props.extent.length === 4 &&
      props.extent.every((point) => typeof point === 'number')
    ? props.extent as [number, number, number, number]
    : undefined;
  const bbox: Place['bbox'] = extent
    ? [
      projectLatLon(extent[1], extent[0])[0],
      projectLatLon(extent[1], extent[0])[1],
      projectLatLon(extent[3], extent[2])[0],
      projectLatLon(extent[3], extent[2])[1],
    ]
    : undefined;
  const osmKey = typeof props.osm_key === 'string' ? props.osm_key : '';
  const kind: Place['kind'] = ['place', 'boundary', 'landuse'].includes(osmKey)
    ? 'area'
    : osmKey === 'highway' ? 'street' : 'landmark';
  const id = typeof props.osm_id === 'number' ? props.osm_id : `${name}-${lat}-${lon}-${index}`;
  const parentArea = [props.city, props.district, props.county].find((value) => typeof value === 'string');
  return {
    id: `photon-${String(props.osm_type ?? 'feature')}-${id}`,
    name,
    kind,
    point: center,
    bbox,
    category: typeof props.osm_value === 'string' ? props.osm_value : osmKey || undefined,
    parentArea: typeof parentArea === 'string' ? parentArea : undefined,
  };
}

function SearchIcon({ kind }: { kind: 'area' | 'road' | 'landmark' | 'street' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'road') {
    return <svg viewBox="0 0 24 24" className="h-5 w-5" {...common} aria-hidden="true"><path d="M5 21 9 3m6 0 4 18M12 5v3m0 4v3m0 4v2" /></svg>;
  }
  if (kind === 'street') {
    return <svg viewBox="0 0 24 24" className="h-5 w-5" {...common} aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16M8 3v4m8 3v4M8 17v4" /></svg>;
  }
  if (kind === 'area') {
    return <svg viewBox="0 0 24 24" className="h-5 w-5" {...common} aria-hidden="true"><path d="m4 7 6-3 5 2 5-2v15l-5 2-5-2-6 3zM10 4v15m5-13v15" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className="h-5 w-5" {...common} aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

function resultKind(hit: Hit): 'area' | 'road' | 'landmark' | 'street' {
  if (hit.kind === 'road') return 'road';
  if (hit.place.kind === 'area' || hit.place.kind === 'block') return 'area';
  if (hit.place.kind === 'street') return 'street';
  return 'landmark';
}

function resultGroup(kind: ReturnType<typeof resultKind>): string {
  return ({ area: 'Areas', road: 'Roads', landmark: 'Landmarks', street: 'Streets' })[kind];
}

function buildPhotonUrl(query: string): string {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  url.searchParams.set('bbox', `${MAP_BBOX.west},${MAP_BBOX.south},${MAP_BBOX.east},${MAP_BBOX.north}`);
  url.searchParams.set('lang', 'en');
  return url.toString();
}

export default function SearchBar({
  mobile = false,
  resultsTarget = null,
  onSearchOpen,
  onSelection,
}: {
  mobile?: boolean;
  resultsTarget?: HTMLElement | null;
  onSearchOpen?: () => void;
  onSelection?: () => void;
} = {}) {
  const roads = useAppStore((state) => state.roads);
  const selectRoad = useAppStore((state) => state.selectRoad);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [photonResponse, setPhotonResponse] = useState<{ key: string; places: Place[]; loading: boolean }>({
    key: '',
    places: [],
    loading: false,
  });
  const places = useAllPlaces(true);
  const resultId = mobile ? 'mobile-road-search-results' : 'road-search-results';

  const fuse = useMemo(() => {
    const items: SearchItem[] = [
      ...places.map((place) => ({
        hit: { kind: 'place' as const, place },
        name: place.name,
        nameEn: place.nameEn,
        nameUr: place.nameUr,
        aliases: place.aliases ?? [],
        parentArea: place.parentArea,
        searchKeys: makeSearchKeys(place.name, place.nameEn, place.nameUr, ...(place.aliases ?? [])),
      })),
      ...roads.map((road) => ({
        hit: { kind: 'road' as const, road },
        name: road.name,
        aliases: [],
        searchKeys: makeSearchKeys(road.name),
      })),
    ];
    return new Fuse<SearchItem>(items, {
      keys: [
        { name: 'searchKeys', weight: 1 },
        { name: 'name', weight: 0.9 },
        { name: 'nameEn', weight: 0.8 },
        { name: 'nameUr', weight: 0.8 },
        { name: 'aliases', weight: 0.75 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
    });
  }, [places, roads]);

  const offlineResults = useMemo<Result[]>(() => {
    const variants = searchVariants(query.trim()).filter(Boolean);
    if (!variants.length) return [];
    const best = new Map<string, Result>();
    for (const variant of variants) {
      for (const match of fuse.search(variant, { limit: MAX_RESULTS * 2 })) {
        const hit = match.item.hit;
        const key = hitId(hit);
        const score = match.score ?? 1;
        const previous = best.get(key);
        if (!previous || score < previous.score) best.set(key, { hit, source: 'offline', score });
      }
    }
    return [...best.values()].sort((a, b) => a.score - b.score).slice(0, MAX_RESULTS);
  }, [fuse, query]);

  useEffect(() => {
    const trimmed = query.trim();
    const cacheKey = normalise(trimmed);
    if (!open || Array.from(trimmed).length < 3 || offlineResults.length >= 3) return;
    const cached = PHOTON_CACHE.get(cacheKey);
    if (cached !== undefined) return;

    const controller = new AbortController();
    const wait = Math.max(350, lastPhotonRequestAt + 1000 - Date.now());
    const timeout = window.setTimeout(async () => {
      lastPhotonRequestAt = Date.now();
      setPhotonResponse({ key: cacheKey, places: [], loading: true });
      try {
        const response = await fetch(buildPhotonUrl(trimmed), { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { features?: PhotonFeature[] };
        const results = (data.features ?? [])
          .map(photonPlace)
          .filter((place): place is Place => place !== null);
        PHOTON_CACHE.set(cacheKey, results);
        if (PHOTON_CACHE.size > 100) PHOTON_CACHE.delete(PHOTON_CACHE.keys().next().value as string);
        setPhotonResponse({ key: cacheKey, places: results, loading: false });
      } catch {
        if (!controller.signal.aborted) setPhotonResponse({ key: cacheKey, places: [], loading: false });
      } finally {
        if (!controller.signal.aborted) {
          setPhotonResponse((current) => current.key === cacheKey ? { ...current, loading: false } : current);
        }
      }
    }, wait);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, offlineResults.length, query]);

  const cacheKey = normalise(query.trim());
  const photonEligible = open && Array.from(query.trim()).length >= 3 && offlineResults.length < 3;
  const photonResults = photonEligible
    ? PHOTON_CACHE.get(cacheKey) ?? (photonResponse.key === cacheKey ? photonResponse.places : [])
    : [];
  const photonLoading = photonEligible && photonResponse.key === cacheKey && photonResponse.loading;
  const visibleOffline = offlineResults.slice(0, MAX_RESULTS);
  const visiblePhoton = photonResults
    .filter((place) => !visibleOffline.some((result) => hitId(result.hit) === place.id))
    .slice(0, Math.max(0, MAX_RESULTS - visibleOffline.length));
  const orderedResults: Result[] = [
    ...visibleOffline,
    ...visiblePhoton.map((place) => ({ hit: { kind: 'place' as const, place }, source: 'photon' as const, score: 1 })),
  ];

  const activeIndex = Math.min(active, Math.max(0, orderedResults.length - 1));

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
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
      if (useAppStore.getState().selectedRoadId !== null) selectRoad(null);
      useTripStore.getState().setActive(false);
      if (hit.place.kind === 'area' || hit.place.kind === 'block') {
        useAreaStore.getState().setPlace(hit.place);
      } else {
        useAreaStore.getState().setPlace(null);
        useAreaStore.getState().flyTo(hit.place);
      }
    }
    setQuery(hitName(hit));
    setOpen(false);
    onSelection?.();
    inputRef.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(orderedResults.length ? (activeIndex + 1) % orderedResults.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(orderedResults.length ? (activeIndex - 1 + orderedResults.length) % orderedResults.length : 0);
    } else if (event.key === 'Enter' && orderedResults[activeIndex]) {
      event.preventDefault();
      choose(orderedResults[activeIndex].hit);
    } else if (event.key === 'Escape') {
      if (open && query) setOpen(false);
      else {
        setQuery('');
        inputRef.current?.blur();
      }
    }
  };

  const showDropdown = open && query.trim() !== '';
  const groups = [
    ...(['area', 'road', 'landmark', 'street'] as const).map((kind) => ({
      label: resultGroup(kind),
      kind,
      results: orderedResults.filter((result) => result.source === 'offline' && resultKind(result.hit) === kind),
    })).filter((group) => group.results.length > 0),
    ...(visiblePhoton.length ? [{
      label: 'More results',
      kind: null,
      results: orderedResults.filter((result) => result.source === 'photon'),
    }] : []),
  ];

  const dropdown = showDropdown ? (
    <ul
      id={resultId}
      role="listbox"
      className={`${GLASS} raasta-scroll ${
        mobile
          ? 'pointer-events-auto relative max-h-[min(55dvh,26rem)] overflow-y-auto overscroll-contain py-1'
          : 'absolute inset-x-0 top-full z-40 mt-2 max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain py-1'
      }`}
    >
      {groups.map((group) => (
        <li key={group.label} role="presentation">
          <h3 className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8f9bb8]">{group.label}</h3>
          <ul>
            {group.results.map((result) => {
              const index = orderedResults.indexOf(result);
              const kind = resultKind(result.hit);
              const place = result.hit.kind === 'place' ? result.hit.place : null;
              return (
                <li key={hitId(result.hit)} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    onPointerDown={(event) => event.preventDefault()}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(result.hit)}
                    className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors ${index === activeIndex ? 'bg-[#7cc4ff]/10' : 'hover:bg-white/5'}`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center text-[#7cc4ff]" aria-hidden="true">
                      <SearchIcon kind={kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[#f6f2ea]">{hitName(result.hit)}</span>
                      <span className="block truncate text-xs text-[#8f9bb8]">
                        {place?.parentArea
                          ? `${place.category ? `${place.category} · ` : ''}${place.parentArea}`
                          : result.hit.kind === 'road'
                            ? `${TYPE_LABEL[result.hit.road.type]} · ${(result.hit.road.lengthM / 1000).toFixed(1)} km`
                            : `${PLACE_KIND_LABEL[place?.kind ?? 'landmark']}${place?.category ? ` · ${place.category}` : ''}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
      {orderedResults.length === 0 && !photonLoading && (
        <li className="px-4 py-3 text-sm text-[#8f9bb8]">No roads or places found</li>
      )}
      {photonLoading && (
        <li className="px-4 py-3 text-xs text-[#8f9bb8]">Searching nearby places…</li>
      )}
    </ul>
  ) : null;

  return (
    <div className="relative w-full">
      <div className={`${mobile ? 'raasta-mobile-search raasta-panel flex h-12 items-center gap-2 px-3' : `${GLASS} flex items-center gap-2 px-3 py-2.5`}`}>
        {mobile ? (
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center" aria-hidden="true">
            <span className="relative h-[22px] w-[11px] overflow-hidden">
              <Image src="/raasta_logo_header.svg" alt="" width={94} height={22} className="absolute left-[-12px] top-0 h-[22px] w-[94px] max-w-none" priority />
            </span>
          </span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#8f9bb8]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            onSearchOpen?.();
          }}
          onFocus={() => {
            setOpen(true);
            onSearchOpen?.();
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={mobile ? 'Search road or area' : 'Search a road or area, e.g. Clifton'}
          className="min-w-0 w-full bg-transparent text-sm text-[#f6f2ea] placeholder:text-[#8f9bb8] focus:outline-none"
          role="combobox"
          aria-label={mobile ? 'Search road or area' : undefined}
          aria-expanded={showDropdown}
          aria-controls={resultId}
          aria-autocomplete="list"
        />
        {mobile ? (
          <>
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="grid h-11 w-8 shrink-0 place-items-center text-[#8f9bb8]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            )}
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[#8f9bb8]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </>
        ) : query ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="grid h-10 w-10 shrink-0 place-items-center rounded text-slate-400 hover:text-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : (
          <kbd className="hidden rounded border border-[#1f2a44] px-1.5 text-[11px] text-slate-400 sm:inline">/</kbd>
        )}
      </div>

      {mobile
        ? resultsTarget && dropdown ? createPortal(dropdown, resultsTarget) : null
        : dropdown}
    </div>
  );
}
