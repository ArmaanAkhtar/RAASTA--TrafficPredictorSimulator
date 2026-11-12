// Loads public/data/places.json once for search, trip planning, and map labels.
import { create } from 'zustand';
import { PLACES, type Place } from './places';
import type { Pt } from './types';

const KINDS = ['area', 'landmark', 'street'] as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface SerializedPlace {
  id?: unknown;
  name?: unknown;
  nameEn?: unknown;
  nameUr?: unknown;
  aliases?: unknown;
  kind?: unknown;
  category?: unknown;
  center?: unknown;
  bbox?: unknown;
  parentArea?: unknown;
}

interface OsmPlacesState {
  status: 'idle' | 'loading' | 'ready' | 'missing';
  places: Place[];
  load: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPoint(value: unknown): value is Pt {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) &&
    typeof value[1] === 'number' && Number.isFinite(value[1]);
}

function loadPlace(row: unknown, index: number): Place | null {
  if (Array.isArray(row)) {
    if (typeof row[0] !== 'string' || typeof row[2] !== 'number' || typeof row[3] !== 'number') return null;
    const legacyKinds: Array<Place['kind']> = ['area', 'block', 'landmark'];
    const kind = legacyKinds[Number(row[1])] ?? 'landmark';
    return {
      id: `osm-${index}-${slug(row[0])}`,
      name: row[0],
      kind,
      point: [row[2], row[3]],
      cat: typeof row[4] === 'string' && row[4] ? row[4] : undefined,
    };
  }
  if (!isRecord(row)) return null;
  const place = row as SerializedPlace;
  const kind = typeof place.kind === 'string' ? KINDS.find((candidate) => candidate === place.kind) : undefined;
  if (typeof place.name !== 'string' || !isPoint(place.center) || !kind) return null;
  const bbox = Array.isArray(place.bbox) && place.bbox.length === 4 &&
      place.bbox.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ? place.bbox as Place['bbox']
    : undefined;
  return {
    id: typeof place.id === 'string' ? place.id : `osm-${index}-${slug(place.name)}`,
    name: place.name,
    kind,
    point: place.center,
    nameEn: typeof place.nameEn === 'string' ? place.nameEn : undefined,
    nameUr: typeof place.nameUr === 'string' ? place.nameUr : undefined,
    aliases: Array.isArray(place.aliases) ? place.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
    category: typeof place.category === 'string' ? place.category : undefined,
    bbox,
    parentArea: typeof place.parentArea === 'string' ? place.parentArea : undefined,
  };
}

export const useOsmPlaces = create<OsmPlacesState>((set, get) => ({
  status: 'idle',
  places: [],
  load: () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    fetch('/data/places.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        const rows = isRecord(data) && Array.isArray(data.places) ? data.places : [];
        const places = rows.map(loadPlace).filter((place): place is Place => place !== null);
        set({ status: places.length ? 'ready' : 'missing', places });
      })
      .catch(() => set({ status: 'missing' }));
  },
}));

/** Search callers can include named local streets; map labels and trip forms stay compact. */
export function useAllPlaces(includeStreets = false): Place[] {
  const osm = useOsmPlaces((state) => state.places);
  return osm.length
    ? [...PLACES, ...(includeStreets ? osm : osm.filter((place) => place.kind !== 'street'))]
    : PLACES;
}
