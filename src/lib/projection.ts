import type { Pt } from './types';

export const MAP_PROJECTION_ORIGIN = { lat0: 24.8607, lon0: 67.0011 } as const;

const METRES_PER_DEGREE_LON = 111320 * Math.cos((MAP_PROJECTION_ORIGIN.lat0 * Math.PI) / 180);
const METRES_PER_DEGREE_LAT = 110540;

export function projectLatLon(lat: number, lon: number): Pt {
  return [
    (lon - MAP_PROJECTION_ORIGIN.lon0) * METRES_PER_DEGREE_LON,
    (lat - MAP_PROJECTION_ORIGIN.lat0) * METRES_PER_DEGREE_LAT,
  ];
}
