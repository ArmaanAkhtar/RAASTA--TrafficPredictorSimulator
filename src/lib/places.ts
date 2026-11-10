// src/lib/places.ts
// Well-known Karachi areas and landmarks for the trip planner (From / To).
// Coordinates are approximate area centres; the router snaps them to the nearest major road,
// so being a few hundred metres off does not matter.
import type { Pt, Road } from './types';

const LAT0 = 24.8607;
const LON0 = 67.0011;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_DEG_LAT = 110540;

export interface Place {
  id: string;
  name: string;
  kind: 'area' | 'block' | 'landmark' | 'road' | 'location';
  point: Pt; // local metres, same system as roads
  /** landmark type from OpenStreetMap: 'edu', 'hospital', 'park', 'shop', 'sport', 'station', 'airport', 'worship', 'sight' */
  cat?: string;
}

export const PLACE_KIND_LABEL: Record<Place['kind'], string> = {
  area: 'Area',
  block: 'Block',
  landmark: 'Place',
  road: 'Road',
  location: 'GPS',
};

export const CAT_ICON: Record<string, string> = {
  edu: '🎓',
  hospital: '🏥',
  park: '🌳',
  shop: '🛍️',
  sport: '🏟️',
  station: '🚉',
  airport: '✈️',
  worship: '🕌',
  sight: '📍',
};

/** [lat, lon] -> local metres [x, y] (same formula as scripts/build-roads.ts). */
export function toLocal(lat: number, lon: number): Pt {
  return [(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT];
}

const RAW: Array<[string, 'area' | 'landmark', number, number]> = [
  // Areas
  ['Gulshan-e-Iqbal', 'area', 24.9180, 67.0971],
  ['Gulistan-e-Jauhar', 'area', 24.9180, 67.1350],
  ['Clifton', 'area', 24.8138, 67.0300],
  ['DHA (Defence)', 'area', 24.8030, 67.0650],
  ['Saddar', 'area', 24.8546, 67.0225],
  ['PECHS', 'area', 24.8680, 67.0600],
  ['Bahadurabad', 'area', 24.8820, 67.0680],
  ['Tariq Road', 'area', 24.8720, 67.0640],
  ['North Nazimabad', 'area', 24.9425, 67.0380],
  ['Nazimabad', 'area', 24.9100, 67.0300],
  ['Federal B Area', 'area', 24.9300, 67.0730],
  ['North Karachi', 'area', 24.9750, 67.0600],
  ['Korangi', 'area', 24.8390, 67.1270],
  ['Landhi', 'area', 24.8500, 67.2100],
  ['Malir', 'area', 24.8930, 67.2050],
  ['Shah Faisal Colony', 'area', 24.8780, 67.1550],
  ['Lyari', 'area', 24.8620, 66.9930],
  ['Kemari', 'area', 24.8180, 66.9900],
  ['Orangi Town', 'area', 24.9500, 66.9900],
  ['Gulberg', 'area', 24.9330, 67.0600],
  ['Surjani Town', 'area', 25.0200, 67.0500],
  // Landmarks
  ['Jinnah International Airport', 'landmark', 24.9065, 67.1608],
  ['University of Karachi', 'landmark', 24.9420, 67.1140],
  ['NED University', 'landmark', 24.9330, 67.1110],
  ['I.I. Chundrigar Road (Tower)', 'landmark', 24.8490, 66.9970],
  ['Sea View', 'landmark', 24.7980, 67.0430],
  ['Teen Talwar', 'landmark', 24.8340, 67.0330],
  ['Dolmen Mall Clifton', 'landmark', 24.8020, 67.0300],
  ['Millennium Mall', 'landmark', 24.9010, 67.1140],
  ['Lucky One Mall', 'landmark', 24.9320, 67.0870],
  ['Numaish (Quaid\'s Mazar)', 'landmark', 24.8750, 67.0400],
  ['Karachi Cantt Station', 'landmark', 24.8406, 67.0436],
  ['Nipa Chowrangi', 'landmark', 24.9170, 67.0970],
  ['Gulshan Chowrangi', 'landmark', 24.9240, 67.0920],
  ['Karsaz', 'landmark', 24.8800, 67.0920],
  ['Nursery (Shahrah-e-Faisal)', 'landmark', 24.8650, 67.0740],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const PLACES: Place[] = RAW.map(([name, kind, lat, lon]) => ({
  id: `place-${slug(name)}`,
  name,
  kind,
  point: toLocal(lat, lon),
}));

/** Places (hand-picked + OpenStreetMap areas, blocks, famous places) + every road, for the From / To search. */
export function tripOptions(roads: Road[], extra: Place[] = []): Place[] {
  return [
    ...PLACES,
    ...extra,
    ...roads.map((r) => ({ id: `road-${r.id}`, name: r.name, kind: 'road' as const, point: r.center })),
  ];
}
