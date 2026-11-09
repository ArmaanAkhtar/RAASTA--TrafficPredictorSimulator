/**
 * scripts/build-cameras.ts
 * Run: npx tsx scripts/build-cameras.ts
 * Writes public/data/cameras.json with one sample camera per road below,
 * placed at that road's centre (read from public/data/roads.geojson).
 * Put matching clips in public/videos/cam1.mp4, cam2.mp4, cam3.mp4.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const ROADS_FILE = path.join(ROOT, 'public', 'data', 'roads.geojson');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'cameras.json');

const CAMERAS: Array<{ id: string; name: string; road: string; video: string }> = [
  { id: 'cam1', name: 'Shahrah-e-Faisal camera', road: 'Shahrah-e-Faisal', video: '/videos/cam1.mp4' },
  { id: 'cam2', name: 'University Road camera', road: 'University Road', video: '/videos/cam2.mp4' },
  { id: 'cam3', name: 'M.A. Jinnah Road camera', road: 'M.A. Jinnah Road', video: '/videos/cam3.mp4' },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function main(): void {
  if (!fs.existsSync(ROADS_FILE)) {
    console.error('public/data/roads.geojson not found. Run: npx tsx scripts/build-roads.ts');
    process.exit(1);
  }
  const data: unknown = JSON.parse(fs.readFileSync(ROADS_FILE, 'utf8'));
  if (!isRecord(data) || !Array.isArray(data.features)) {
    console.error('roads.geojson is not a FeatureCollection.');
    process.exit(1);
  }
  const features: unknown[] = data.features;

  const out: Array<{ id: string; name: string; roadId: string; position: [number, number]; videoSrc: string }> = [];
  for (const cam of CAMERAS) {
    const f = features.find((x) => isRecord(x) && isRecord(x.properties) && x.properties.name === cam.road);
    const props = isRecord(f) && isRecord(f.properties) ? f.properties : null;
    const center = props?.center;
    if (!props || typeof props.id !== 'string' || !Array.isArray(center) || typeof center[0] !== 'number' || typeof center[1] !== 'number') {
      console.log(`  MISSING road for ${cam.id}: ${cam.road}`);
      continue;
    }
    out.push({ id: cam.id, name: cam.name, roadId: props.id, position: [center[0], center[1]], videoSrc: cam.video });
    const videoPath = path.join(ROOT, 'public', cam.video);
    console.log(`  ${cam.id}  ${cam.road.padEnd(20)} roadId=${props.id}  video ${fs.existsSync(videoPath) ? 'found' : 'NOT ADDED YET'}`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${out.length} cameras to public/data/cameras.json\n`);
}

main();
