/**
 * Build the compact offline place and street search index.
 * Run after fetch-osm.ts and build-streets.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BBOX, PROJECTED_BOUNDS, projectLatLon } from './bbox';

type Pt = [number, number];
type Kind = 'area' | 'landmark' | 'street';
type Bounds = [number, number, number, number];
type Tags = Record<string, string>;

interface RawPlace {
  id?: number;
  osmType?: string;
  lat: number;
  lon: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags: Tags;
}

interface Candidate {
  id: string;
  name: string;
  nameEn?: string;
  nameUr?: string;
  aliases: string[];
  kind: Kind;
  category: string;
  center: Pt;
  bbox?: Bounds;
  parentArea?: string;
}

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'scripts', 'data', 'karachi_places.json');
const STREETS_INPUT = path.join(ROOT, 'scripts', 'data', 'karachi_streets.json');
const ALIASES_INPUT = path.join(ROOT, 'scripts', 'data', 'aliases.json');
const ROADS_INPUT = path.join(ROOT, 'public', 'data', 'roads.geojson');
const OUTPUT = path.join(ROOT, 'public', 'data', 'places.json');

const AREA_PLACE_VALUES = new Set([
  'city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'locality', 'isolated_dwelling',
]);
const COVERAGE: Array<{ label: string; kind: Kind | 'road' | 'any'; matches: string[] }> = [
  { label: 'DHA Phase 8', kind: 'area', matches: ['DHA Phase 8'] },
  { label: 'Quaidabad', kind: 'area', matches: ['Quaidabad'] },
  { label: 'Landhi', kind: 'area', matches: ['Landhi'] },
  { label: 'Korangi', kind: 'area', matches: ['Korangi'] },
  { label: 'Malir', kind: 'area', matches: ['Malir'] },
  { label: 'Surjani Town', kind: 'area', matches: ['Surjani Town'] },
  { label: 'Gulshan-e-Maymar', kind: 'area', matches: ['Gulshan-e-Maymar'] },
  { label: 'Bahria Town', kind: 'area', matches: ['Bahria Town'] },
  { label: 'Clifton', kind: 'area', matches: ['Clifton'] },
  { label: 'Saddar', kind: 'area', matches: ['Saddar'] },
  { label: 'Nipa Chowrangi', kind: 'any', matches: ['Nipa Chowrangi'] },
  { label: 'Tariq Road', kind: 'any', matches: ['Tariq Road'] },
  { label: 'Bahadurabad', kind: 'area', matches: ['Bahadurabad'] },
  { label: 'Lyari', kind: 'area', matches: ['Lyari'] },
  { label: 'Orangi Town', kind: 'area', matches: ['Orangi Town'] },
  { label: 'Baldia Town', kind: 'area', matches: ['Baldia Town'] },
  { label: 'Shah Faisal Colony', kind: 'area', matches: ['Shah Faisal Colony'] },
  { label: 'Gulistan-e-Johar', kind: 'area', matches: ['Gulistan-e-Johar'] },
  { label: 'North Karachi', kind: 'area', matches: ['North Karachi'] },
  { label: 'Karachi University', kind: 'landmark', matches: ['Karachi University', 'University of Karachi'] },
  { label: 'Jinnah International Airport', kind: 'landmark', matches: ['Jinnah International Airport'] },
  { label: 'FAST NUCES Karachi (FAST University)', kind: 'landmark', matches: ['FAST NUCES Karachi', 'FAST University'] },
  { label: 'NED University', kind: 'landmark', matches: ['NED University'] },
  { label: 'IBA Karachi', kind: 'landmark', matches: ['IBA Karachi'] },
  { label: 'Habib University', kind: 'landmark', matches: ['Habib University'] },
  { label: 'Aga Khan University Hospital', kind: 'landmark', matches: ['Aga Khan University Hospital'] },
];

const norm = (value: string) => value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const inBounds = (point: Pt) =>
  point[0] >= PROJECTED_BOUNDS.minX && point[0] <= PROJECTED_BOUNDS.maxX &&
  point[1] >= PROJECTED_BOUNDS.minY && point[1] <= PROJECTED_BOUNDS.maxY;
const cleanName = (value: string | undefined) => value?.trim().replace(/\s+/g, ' ') ?? '';
const splitNames = (value: string | undefined) =>
  (value ?? '').split(/[;|]/).map(cleanName).filter(Boolean);

function classify(tags: Tags): Kind {
  if (
    AREA_PLACE_VALUES.has(tags.place ?? '') ||
    (tags.boundary === 'administrative' && Number(tags.admin_level) >= 6 && Number(tags.admin_level) <= 10) ||
    ['residential', 'commercial', 'industrial'].includes(tags.landuse ?? '')
  ) return 'area';
  return 'landmark';
}

function category(tags: Tags): string {
  const amenity = tags.amenity ?? '';
  if (['university', 'college', 'school'].includes(amenity)) return 'education';
  if (['hospital', 'clinic'].includes(amenity)) return 'health';
  if (amenity === 'marketplace' || tags.shop) return 'market';
  if (['bus_station', 'station', 'ferry_terminal'].includes(amenity) || tags.railway === 'station') return 'transit';
  if (amenity === 'place_of_worship') return 'worship';
  if (amenity === 'stadium' || tags.leisure === 'stadium' || tags.leisure === 'sports_centre') return 'sport';
  if (tags.aeroway) return 'airport';
  if (tags.natural === 'beach') return 'beach';
  if (tags.leisure || tags.tourism === 'zoo' || tags.tourism === 'theme_park') return 'park';
  if (tags.highway || tags.junction || tags.bridge || tags['bridge:name']) return 'roadside';
  return 'landmark';
}

function displayNames(tags: Tags): { name: string; nameEn?: string; nameUr?: string; aliases: string[] } {
  const name = cleanName(tags['name:en']) || cleanName(tags.name) ||
    cleanName(tags['bridge:name']) || splitNames(tags.alt_name)[0] || '';
  const nameEn = cleanName(tags['name:en']) || undefined;
  const nameUr = cleanName(tags['name:ur']) || undefined;
  const aliases = [...new Set([
    ...splitNames(tags.alt_name),
    ...splitNames(tags.old_name),
    ...splitNames(tags.short_name),
    ...splitNames(tags.loc_name),
  ].filter((alias) => norm(alias) !== norm(name)))];
  return { name, nameEn, nameUr, aliases };
}

function projectedBounds(bounds: RawPlace['bounds']): Bounds | undefined {
  if (!bounds) return undefined;
  const southwest = projectLatLon(bounds.minlat, bounds.minlon);
  const northeast = projectLatLon(bounds.maxlat, bounds.maxlon);
  return [
    Math.round(southwest[0] / 10) * 10,
    Math.round(southwest[1] / 10) * 10,
    Math.round(northeast[0] / 10) * 10,
    Math.round(northeast[1] / 10) * 10,
  ];
}

function intersectsMap(bounds: Bounds): boolean {
  return bounds[0] <= PROJECTED_BOUNDS.maxX && bounds[2] >= PROJECTED_BOUNDS.minX &&
    bounds[1] <= PROJECTED_BOUNDS.maxY && bounds[3] >= PROJECTED_BOUNDS.minY;
}

function addCandidate(candidates: Candidate[], raw: RawPlace, id: string): void {
  const tags = raw.tags ?? {};
  const names = displayNames(tags);
  if (!names.name) return;
  const kind = classify(tags);
  const bounds = projectedBounds(raw.bounds);
  let center = projectLatLon(raw.lat, raw.lon);
  if (bounds && !inBounds(center)) {
    center = [
      (Math.max(bounds[0], PROJECTED_BOUNDS.minX) + Math.min(bounds[2], PROJECTED_BOUNDS.maxX)) / 2,
      (Math.max(bounds[1], PROJECTED_BOUNDS.minY) + Math.min(bounds[3], PROJECTED_BOUNDS.maxY)) / 2,
    ];
  }
  if (bounds ? !intersectsMap(bounds) : !inBounds(center)) return;
  const bbox: Bounds | undefined = kind === 'area'
    ? bounds ?? [center[0] - 500, center[1] - 500, center[0] + 500, center[1] + 500]
    : undefined;
  candidates.push({
    id,
    ...names,
    kind,
    category: category(tags),
    center: [Math.round(center[0] / 5) * 5, Math.round(center[1] / 5) * 5],
    ...(bbox ? { bbox } : {}),
  });
}

function addAliases(items: Candidate[]): number {
  const mappings = JSON.parse(fs.readFileSync(ALIASES_INPUT, 'utf8')) as Array<{ alias: string; target: string }>;
  let attached = 0;
  for (const { alias, target } of mappings) {
    const key = norm(target);
    const place = items.find((item) =>
      [item.name, item.nameEn, item.nameUr, ...item.aliases].some((value) => value !== undefined && norm(value) === key),
    );
    if (!place) {
      console.log(`  alias skipped (target not found in OSM): ${alias} -> ${target}`);
      continue;
    }
    if (!place.aliases.some((value) => norm(value) === norm(alias)) && norm(place.name) !== norm(alias)) {
      place.aliases.push(alias);
      attached++;
    }
  }
  return attached;
}

function deduplicate(items: Candidate[]): { places: Candidate[]; duplicates: number } {
  const ordered = [...items].sort((a, b) => Number(b.kind === 'area') - Number(a.kind === 'area'));
  const kept: Candidate[] = [];
  const byName = new Map<string, Candidate[]>();
  let duplicates = 0;
  for (const item of ordered) {
    const key = `${item.kind}:${norm(item.name)}`;
    const sameName = byName.get(key) ?? [];
    const duplicate = sameName.find((other) =>
      Math.hypot(other.center[0] - item.center[0], other.center[1] - item.center[1]) < 300,
    );
    if (duplicate) {
      duplicate.aliases = [...new Set([...duplicate.aliases, ...item.aliases])];
      duplicates++;
      continue;
    }
    sameName.push(item);
    byName.set(key, sameName);
    kept.push(item);
  }
  return { places: kept, duplicates };
}

function parentAreas(items: Candidate[]): void {
  const areas = items.filter((item) => item.kind === 'area');
  for (const item of items) {
    if (item.kind === 'area') continue;
    const containing = areas
      .filter((area) => area.bbox &&
        item.center[0] >= area.bbox[0] && item.center[0] <= area.bbox[2] &&
        item.center[1] >= area.bbox[1] && item.center[1] <= area.bbox[3])
      .sort((a, b) => {
        const areaSize = (place: Candidate) => (place.bbox![2] - place.bbox![0]) * (place.bbox![3] - place.bbox![1]);
        return areaSize(a) - areaSize(b);
      })[0];
    if (containing) {
      item.parentArea = containing.name;
      continue;
    }
    let nearest: Candidate | undefined;
    let distance = 6000;
    for (const area of areas) {
      const current = Math.hypot(area.center[0] - item.center[0], area.center[1] - item.center[1]);
      if (current < distance) {
        nearest = area;
        distance = current;
      }
    }
    if (nearest) item.parentArea = nearest.name;
  }
}

function candidateNames(item: Candidate): string[] {
  return [item.name, item.nameEn, item.nameUr, ...item.aliases].filter((value): value is string => !!value);
}

function main(): void {
  if (!fs.existsSync(INPUT)) throw new Error(`Missing ${path.relative(ROOT, INPUT)}. Run: npx tsx scripts/fetch-osm.ts --places-only`);
  const data = JSON.parse(fs.readFileSync(INPUT, 'utf8')) as { places?: RawPlace[] };
  const rawPlaces = data.places ?? [];
  const candidates: Candidate[] = [];
  let unnamed = 0;
  let outside = 0;
  for (const [index, raw] of rawPlaces.entries()) {
    const before = candidates.length;
    const id = `osm-${raw.osmType ?? 'feature'}-${raw.id ?? index}`;
    addCandidate(candidates, raw, id);
    if (candidates.length === before) {
      if (!displayNames(raw.tags ?? {}).name) unnamed++;
      else outside++;
    }
  }

  if (fs.existsSync(STREETS_INPUT)) {
    const streetData = JSON.parse(fs.readFileSync(STREETS_INPUT, 'utf8')) as {
      namedStreets?: Array<{ id: number; name: string; center: [number, number]; tags: Tags }>;
    };
    for (const street of streetData.namedStreets ?? []) {
      const names = displayNames(street.tags ?? {});
      if (!names.name) continue;
      const center = projectLatLon(street.center[1], street.center[0]);
      if (!inBounds(center)) continue;
      candidates.push({
        id: `osm-way-${street.id}`,
        ...names,
        kind: 'street',
        category: 'street',
        center: [Math.round(center[0] / 5) * 5, Math.round(center[1] / 5) * 5],
      });
    }
  }

  const aliasesAttached = addAliases(candidates);
  const { places, duplicates } = deduplicate(candidates);
  parentAreas(places);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({ v: 2, bbox: BBOX, places }));

  const counts = {
    area: places.filter((place) => place.kind === 'area').length,
    landmark: places.filter((place) => place.kind === 'landmark').length,
    street: places.filter((place) => place.kind === 'street').length,
  };
  const roads = fs.existsSync(ROADS_INPUT)
    ? JSON.parse(fs.readFileSync(ROADS_INPUT, 'utf8')) as { features?: Array<{ properties?: { name?: string } }> }
    : {};
  const namedRoadCount = new Set((roads.features ?? []).map((feature) => feature.properties?.name).filter(Boolean)).size;
  console.log('\n=== build-places: done ===');
  console.log(`OSM place features: ${rawPlaces.length} (${unnamed} without a searchable name, ${outside} outside bbox)`);
  console.log(`Areas: ${counts.area} · Landmarks: ${counts.landmark} · Streets: ${counts.street} · Roads: ${namedRoadCount}`);
  console.log(`Duplicates dropped within 300 m: ${duplicates}`);
  console.log(`Aliases attached to OSM places: ${aliasesAttached}`);
  console.log(`File size: ${fs.statSync(OUTPUT).size.toLocaleString()} bytes (${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB) -> ${path.relative(ROOT, OUTPUT)}`);

  const searchable = places.flatMap((place) =>
    candidateNames(place).map((name) => ({ kind: place.kind, name: norm(name) })),
  );
  const source = rawPlaces.flatMap((place) => {
    const names = [place.tags?.name, place.tags?.['name:en'], place.tags?.['name:ur'], ...splitNames(place.tags?.alt_name)];
    return names.filter((name): name is string => !!name).map((name) => ({ kind: classify(place.tags ?? {}), name: norm(name) }));
  });
  const roadNames = (roads.features ?? [])
    .map((feature) => feature.properties?.name ?? '')
    .filter(Boolean)
    .map((name) => ({ kind: 'road' as const, name: norm(name) }));
  searchable.push(...roadNames);
  source.push(...roadNames);
  if (fs.existsSync(STREETS_INPUT)) {
    const streetData = JSON.parse(fs.readFileSync(STREETS_INPUT, 'utf8')) as {
      namedStreets?: Array<{ name: string; tags: Tags }>;
    };
    const namedStreets = (streetData.namedStreets ?? []).flatMap((street) => {
      const names = [street.name, street.tags?.['name:en'], street.tags?.['name:ur'], ...splitNames(street.tags?.alt_name)];
      return names.filter((name): name is string => !!name).map((name) => ({ kind: 'street' as const, name: norm(name) }));
    });
    searchable.push(...namedStreets);
    source.push(...namedStreets);
  }

  console.log('\nCoverage check (offline index):');
  for (const expected of COVERAGE) {
    const patterns = expected.matches.map(norm);
    const found = searchable.some((item) =>
      (expected.kind === 'any' || item.kind === expected.kind) && patterns.some((pattern) => item.name.includes(pattern)),
    );
    const presentInSource = source.some((item) =>
      (expected.kind === 'any' || item.kind === expected.kind) && patterns.some((pattern) => item.name.includes(pattern)),
    );
    console.log(`  ${found ? 'FOUND' : 'MISSING'} ${expected.label}${found || !presentInSource ? '' : ' (present in OSM input but filtered during build)'}`);
    if (!found && !presentInSource) console.log('    Reason: absent from downloaded OSM names within the configured bbox.');
  }
}

main();
