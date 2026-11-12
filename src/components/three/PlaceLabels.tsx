'use client';

import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useAreaStore } from '@/lib/area';
import { useAllPlaces } from '@/lib/osmPlaces';
import type { Place } from '@/lib/places';
import type { Road } from '@/lib/types';
import { useTripStore } from '@/lib/trip';
import { useAppStore } from '@/store/useAppStore';

const MAX_LABELS = 40;
const RECHECK_MS = 250;
const MAJOR_AREA_LABELS = new Map([
  ['clifton', 'Clifton'],
  ['saddar', 'Saddar'],
  ['gulshan e iqbal', 'Gulshan-e-Iqbal'],
  ['korangi', 'Korangi'],
  ['malir', 'Malir'],
  ['north karachi', 'North Karachi'],
  ['orangi town', 'Orangi Town'],
  ['dha', 'DHA'],
  ['dha defence', 'DHA'],
]);

interface ScreenPoint {
  x: number;
  y: number;
}

interface ScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface VisibleLabel {
  place: Place;
  text: string;
  fontSize: number;
  color: string;
}

interface ControlsHandle {
  target?: THREE.Vector3;
  addEventListener: (type: 'change', listener: () => void) => void;
  removeEventListener: (type: 'change', listener: () => void) => void;
}

interface LabelCandidate extends VisibleLabel {
  priority: number;
  distance: number;
  rect: ScreenRect;
}

const TMP_TARGET = new THREE.Vector3();

function overviewDistanceFor(roads: Road[], fov: number, aspect: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  roads.forEach((road) => {
    road.segments.forEach((segment) => {
      segment.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    });
  });
  if (!Number.isFinite(minX)) return Infinity;
  const radius = Math.max(maxX - minX, maxY - minY, 1) * 0.72;
  const halfFov = THREE.MathUtils.degToRad(fov * 0.5);
  const limitingHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * Math.max(aspect, 0.1)));
  return Math.max(1200, radius / Math.max(Math.sin(limitingHalfFov), 0.1));
}

function projectToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenPoint | null {
  const projected = point.clone().project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  return {
    x: (projected.x + 1) * width * 0.5,
    y: (1 - projected.y) * height * 0.5,
  };
}

function overlaps(a: ScreenRect, b: ScreenRect, padding = 4): boolean {
  return a.left - padding < b.right && a.right + padding > b.left &&
    a.top - padding < b.bottom && a.bottom + padding > b.top;
}

function segmentIntersectsRect(start: ScreenPoint, end: ScreenPoint, rect: ScreenRect, padding = 8): boolean {
  const left = rect.left - padding;
  const right = rect.right + padding;
  const top = rect.top - padding;
  const bottom = rect.bottom + padding;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [start.x - left, right - start.x, start.y - top, bottom - start.y];
  let minT = 0;
  let maxT = 1;
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) minT = Math.max(minT, t);
    else maxT = Math.min(maxT, t);
    if (minT > maxT) return false;
  }
  return true;
}

function shortName(place: Place): string {
  const name = place.name.split(',')[0].trim();
  return name.length > 28 ? `${name.slice(0, 27).trimEnd()}…` : name;
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isMajorArea(place: Place): boolean {
  return place.kind === 'area' && MAJOR_AREA_LABELS.has(normalizedName(place.name));
}

function isCuratedArea(place: Place): boolean {
  return place.kind === 'area' && place.category === undefined;
}

export function PlaceLabels() {
  const places = useAllPlaces();
  const controls = useThree((s) => s.controls) as unknown as ControlsHandle | null;
  const roads = useAppStore((state) => state.roads);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const showRoute = useAppStore((state) => state.showRoute);
  const altRoute = useAppStore((state) => state.altRoute);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const [shown, setShown] = useState<VisibleLabel[]>([]);
  const last = useRef({ key: '' });
  const aspect = size.width / Math.max(size.height, 1);
  const fov = camera.fov;
  const overviewDistance = useMemo(
    () => overviewDistanceFor(roads, fov, aspect),
    [aspect, fov, roads],
  );

  useEffect(() => {
    let timer: number | null = null;
    let lastCheck = 0;
    const updateLabels = () => {
    camera.updateMatrixWorld();
    const target = controls?.target ?? TMP_TARGET.set(camera.position.x, 0, camera.position.z);
    const distance = camera.position.distanceTo(target);
    const tx = target.x;
    const ty = -target.z;
    const radius = distance * 1.6;
    const overview = distance > overviewDistance * 0.65;
    const close = distance < 9000;
    const routeScreenPoints = showRoute && altRoute
      ? altRoute.path.map(([x, y]) => projectToScreen(new THREE.Vector3(x, 8, -y), camera, size.width, size.height))
      : [];
    const selectedRoad = selectedRoadId ? roads.find((road) => road.id === selectedRoadId) : undefined;
    const selectedPoint = selectedRoad
      ? projectToScreen(new THREE.Vector3(selectedRoad.center[0], 180, -selectedRoad.center[1]), camera, size.width, size.height)
      : null;
    const selectedRect = selectedPoint && selectedRoad
      ? {
          left: selectedPoint.x - (selectedRoad.name.length * 8.5 + 96) / 2,
          right: selectedPoint.x + (selectedRoad.name.length * 8.5 + 96) / 2,
          top: selectedPoint.y - 17,
          bottom: selectedPoint.y + 17,
        }
      : null;

    const candidates: LabelCandidate[] = [];
    for (const place of places) {
      const majorArea = isMajorArea(place);
      const curatedArea = isCuratedArea(place);
      if (overview) {
        if (!majorArea) continue;
      } else if (!close) {
        if (!curatedArea) continue;
      } else if (close && place.kind === 'street' && distance > 4500) {
        continue;
      } else if (close && place.kind === 'landmark' && distance > 7000) {
        continue;
      }

      const placeDistance = Math.hypot(place.point[0] - tx, place.point[1] - ty);
      if (placeDistance > radius) continue;
      const worldPoint = new THREE.Vector3(place.point[0], 30, -place.point[1]);
      const screen = projectToScreen(worldPoint, camera, size.width, size.height);
      if (!screen || screen.x < 0 || screen.x > size.width || screen.y < 0 || screen.y > size.height) continue;

      const text = majorArea
        ? MAJOR_AREA_LABELS.get(normalizedName(place.name)) ?? place.name
        : place.kind === 'area' ? place.name : shortName(place);
      const fontSize = overview ? 16 : curatedArea ? 13 : 12;
      const iconWidth = place.kind === 'landmark' ? 16 : 0;
      const labelWidth = Math.max(fontSize * 2, text.length * fontSize * 0.62 + iconWidth + 12);
      const labelHeight = fontSize + 8;
      const priority = majorArea ? 0 : curatedArea ? 1 : place.kind === 'block' ? 2 : 3;
      candidates.push({
        place,
        text,
        fontSize,
        color: majorArea || curatedArea ? 'rgba(246,242,234,0.85)' : '#8f9bb8',
        priority,
        distance: placeDistance,
        rect: {
          left: screen.x - labelWidth / 2,
          right: screen.x + labelWidth / 2,
          top: screen.y - labelHeight / 2,
          bottom: screen.y + labelHeight / 2,
        },
      });
    }

    candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    const picked: LabelCandidate[] = [];
    for (const candidate of candidates) {
      if (picked.length >= MAX_LABELS) break;
      if (selectedRect && overlaps(candidate.rect, selectedRect, 6)) continue;
      let blockedByRoute = false;
      for (let i = 1; i < routeScreenPoints.length; i += 1) {
        const start = routeScreenPoints[i - 1];
        const end = routeScreenPoints[i];
        if (start && end && segmentIntersectsRect(start, end, candidate.rect)) {
          blockedByRoute = true;
          break;
        }
      }
      if (blockedByRoute || picked.some((label) => overlaps(candidate.rect, label.rect))) continue;
      picked.push(candidate);
    }

    const key = picked.map(({ place, fontSize }) => `${place.id}:${fontSize}`).join('|');
    if (key !== last.current.key) {
      last.current.key = key;
      setShown(picked.map(({ place, text, fontSize, color }) => ({ place, text, fontSize, color })));
    }
    };

    const scheduleUpdate = () => {
      if (timer !== null) return;
      const delay = Math.max(0, RECHECK_MS - (Date.now() - lastCheck));
      timer = window.setTimeout(() => {
        timer = null;
        lastCheck = Date.now();
        updateLabels();
      }, delay);
    };

    controls?.addEventListener('change', scheduleUpdate);
    scheduleUpdate();
    return () => {
      controls?.removeEventListener('change', scheduleUpdate);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [altRoute, camera, controls, overviewDistance, places, roads, selectedRoadId, showRoute, size.height, size.width]);

  const open = (place: Place) => {
    const app = useAppStore.getState();
    if (app.selectedRoadId !== null) app.selectRoad(null);
    useTripStore.getState().setActive(false);
    useAreaStore.getState().setPlace(place);
  };

  return (
    <group>
      {shown.map(({ place, text, fontSize, color }) => (
        <Html key={place.id} position={[place.point[0], 30, -place.point[1]]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <button
            type="button"
            onClick={() => open(place)}
            title={`${place.name}: show cameras nearby`}
            className="pointer-events-auto whitespace-nowrap rounded px-1 leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.95),0_0_8px_rgba(0,0,0,0.7)] hover:text-white"
            style={{ color, fontSize, fontWeight: place.kind === 'area' ? 600 : 500 }}
          >
            {place.kind === 'landmark' && (
              <svg viewBox="0 0 24 24" className="mr-0.5 inline h-3.5 w-3.5 text-[#7cc4ff]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            )}
            {text}
          </button>
        </Html>
      ))}
    </group>
  );
}
