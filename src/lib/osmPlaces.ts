// src/lib/osmPlaces.ts
// Every Karachi area, block / sector and famous place from OpenStreetMap (public/data/places.json,
// made by scripts/build-places.ts). Loaded once in the background; used by the search, the trip
// planner and the map labels. Until it loads (or if the file is missing) only the hand-picked PLACES exist.
import { create } from 'zustand';
import { PLACES, type Place } from './places';

const KINDS: Array<Place['kind']> = ['area', 'block', 'landmark'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface OsmPlacesState {
  status: 'idle' | 'loading' | 'ready' | 'missing';
  places: Place[];
  load: () => void;
}

export const useOsmPlaces = create<OsmPlacesState>((set, get) => ({
  status: 'idle',
  places: [],
  load: () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    fetch('/data/places.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        const rows = data && typeof data === 'object' && Array.isArray((data as { places?: unknown }).places)
          ? ((data as { places: unknown[] }).places)
          : [];
        const places: Place[] = [];
        rows.forEach((r, i) => {
          if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[2] !== 'number' || typeof r[3] !== 'number') return;
          const kind = KINDS[Number(r[1])] ?? 'landmark';
          places.push({
            id: `osm-${i}-${slug(r[0])}`,
            name: r[0],
            kind,
            point: [r[2], r[3]],
            cat: typeof r[4] === 'string' && r[4] ? r[4] : undefined,
          });
        });
        set({ status: places.length ? 'ready' : 'missing', places });
      })
      .catch(() => set({ status: 'missing' }));
  },
}));

/** Hand-picked places + OpenStreetMap places (areas first). */
export function useAllPlaces(): Place[] {
  const osm = useOsmPlaces((s) => s.places);
  return osm.length ? [...PLACES, ...osm] : PLACES;
}
