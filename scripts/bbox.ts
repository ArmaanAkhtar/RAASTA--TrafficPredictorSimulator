import { projectLatLon } from '../src/lib/projection';
import { MAP_BBOX } from '../src/lib/mapBounds';

export const BBOX = MAP_BBOX;

export { projectLatLon };

const southwest = projectLatLon(BBOX.south, BBOX.west);
const northeast = projectLatLon(BBOX.north, BBOX.east);

export const PROJECTED_BOUNDS = {
  minX: southwest[0],
  maxX: northeast[0],
  minY: southwest[1],
  maxY: northeast[1],
} as const;

export const OVERPASS_BBOX = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
