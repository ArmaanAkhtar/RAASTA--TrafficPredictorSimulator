// src/lib/cameras.ts
// Loads /data/cameras.json (made by scripts/build-cameras.ts). Cached after the first load.
import type { CameraFeed, Pt } from './types';

const CAMERAS_URL = '/data/cameras.json';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPt(v: unknown): v is Pt {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';
}

function parseCamera(v: unknown): CameraFeed | null {
  if (!isRecord(v)) return null;
  const { id, name, roadId, position, videoSrc } = v;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof roadId !== 'string') return null;
  if (typeof videoSrc !== 'string' || !isPt(position)) return null;
  return { id, name, roadId, position: [position[0], position[1]], videoSrc };
}

let cache: Promise<CameraFeed[]> | null = null;

export function loadCameras(): Promise<CameraFeed[]> {
  if (!cache) {
    cache = fetch(CAMERAS_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${CAMERAS_URL} not found (HTTP ${res.status}). Run: npx tsx scripts/build-cameras.ts`);
        const data: unknown = await res.json();
        if (!Array.isArray(data)) throw new Error(`${CAMERAS_URL} should be an array.`);
        const list: unknown[] = data;
        return list.map(parseCamera).filter((c): c is CameraFeed => c !== null);
      })
      .catch((err: unknown) => {
        cache = null; // allow a retry later
        throw err;
      });
  }
  return cache;
}
