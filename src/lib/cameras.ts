// src/lib/cameras.ts
// Traffic cameras (public/data/cameras.json, made by scripts/build-cameras.ts) and helpers to find
// the cameras on a road, near a place, or along a route. Live feeds need Sindh Safe City access,
// so videoSrc is empty for now and the UI shows "access not granted".
import type { CameraFeed, Pt } from './types';

const CAMERAS_URL = '/data/cameras.json';

export interface CameraInfo extends CameraFeed {
  roadName: string;
  source: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPt(v: unknown): v is Pt {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';
}

function parseCamera(v: unknown): CameraInfo | null {
  if (!isRecord(v)) return null;
  const { id, name, roadId, position, videoSrc, roadName, source } = v;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof roadId !== 'string') return null;
  if (typeof videoSrc !== 'string' || !isPt(position)) return null;
  return {
    id,
    name,
    roadId,
    position: [position[0], position[1]],
    videoSrc,
    roadName: typeof roadName === 'string' ? roadName : '',
    source: typeof source === 'string' ? source : '',
  };
}

let cache: Promise<CameraInfo[]> | null = null;

export function loadCameras(): Promise<CameraInfo[]> {
  if (!cache) {
    cache = fetch(CAMERAS_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${CAMERAS_URL} not found (HTTP ${res.status}). Run: npx tsx scripts/build-cameras.ts`);
        const data: unknown = await res.json();
        if (!Array.isArray(data)) throw new Error(`${CAMERAS_URL} should be an array.`);
        const list: unknown[] = data;
        return list.map(parseCamera).filter((c): c is CameraInfo => c !== null);
      })
      .catch((err: unknown) => {
        cache = null; // allow a retry later
        throw err;
      });
  }
  return cache;
}

/** True once a real live stream URL has been added for this camera. */
export const hasLiveFeed = (c: CameraFeed): boolean => c.videoSrc.trim() !== '';

const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Cameras on a road (in the order they were placed along it). */
export function camerasOnRoad(cams: CameraInfo[], roadId: string): CameraInfo[] {
  return cams.filter((c) => c.roadId === roadId);
}

/** Cameras within `radiusM` of a point, nearest first. */
export function camerasNear(cams: CameraInfo[], p: Pt, radiusM: number): Array<CameraInfo & { distanceM: number }> {
  return cams
    .map((c) => ({ ...c, distanceM: d2(c.position, p) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Distance from p to segment a-b, and how far along the segment (0..1) the closest point is. */
function toSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

/**
 * Cameras along a route path (within `maxM` of it), in driving order, with how far along the
 * route each one is. 250 m covers the width of the drawn road plus both carriageways.
 */
export function camerasAlongRoute(cams: CameraInfo[], path: Pt[], maxM = 250): Array<CameraInfo & { alongKm: number }> {
  if (path.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + d2(path[i - 1], path[i]));
  const out: Array<CameraInfo & { alongKm: number }> = [];
  for (const c of cams) {
    let best = Infinity;
    let along = 0;
    for (let i = 1; i < path.length; i++) {
      const { d, t } = toSegment(c.position, path[i - 1], path[i]);
      if (d < best) {
        best = d;
        along = cum[i - 1] + t * (cum[i] - cum[i - 1]);
      }
    }
    if (best <= maxM) out.push({ ...c, alongKm: Math.round(along / 100) / 10 });
  }
  return out.sort((a, b) => a.alongKm - b.alongKm);
}
