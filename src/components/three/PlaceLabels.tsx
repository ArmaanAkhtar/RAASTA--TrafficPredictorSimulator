'use client';

// Names on the map, like Google Maps: areas (Gulshan-e-Iqbal, Nazimabad ...) from city zoom,
// their blocks / sectors when you zoom in, famous places (hospitals, universities, parks ...) up close.
// Only the ~40 most useful labels around the view are shown at a time, spaced so they never pile up.
// Click a name: fly there and see its cameras (same as picking it in the search).
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useState } from 'react';
import * as THREE from 'three';
import { useAreaStore } from '@/lib/area';
import { useAllPlaces } from '@/lib/osmPlaces';
import type { Place } from '@/lib/places';
import { useTripStore } from '@/lib/trip';
import { useAppStore } from '@/store/useAppStore';

const MAX_LABELS = 40;
const RECHECK_MS = 250;
/** Show a kind of label only when the camera is closer than this (metres from the point it looks at). */
const SHOW_BELOW: Partial<Record<Place['kind'], number>> = { area: 45000, landmark: 7000, block: 9000 };
const PRIORITY: Partial<Record<Place['kind'], number>> = { area: 0, landmark: 1, block: 2 };

const TMP_TARGET = new THREE.Vector3();

export function PlaceLabels() {
  const places = useAllPlaces();
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const [shown, setShown] = useState<Place[]>([]);
  const last = useRef({ t: 0, key: '' });

  useFrame(({ camera, clock }) => {
    const now = clock.elapsedTime * 1000;
    if (now - last.current.t < RECHECK_MS) return;
    last.current.t = now;

    const target = controls?.target ?? TMP_TARGET.set(camera.position.x, 0, camera.position.z);
    const d = camera.position.distanceTo(target);
    const tx = target.x;
    const ty = -target.z; // world z -> map y
    const radius = d * 1.6;
    const spacing = d * 0.09; // labels at least this far apart (metres), so they never overlap on screen

    const candidates: Array<{ p: Place; score: number }> = [];
    for (const p of places) {
      const limit = SHOW_BELOW[p.kind];
      if (limit === undefined || d > limit) continue;
      const dist = Math.hypot(p.point[0] - tx, p.point[1] - ty);
      if (dist > radius) continue;
      candidates.push({ p, score: (PRIORITY[p.kind] ?? 3) * radius + dist });
    }
    candidates.sort((a, b) => a.score - b.score);

    const picked: Place[] = [];
    for (const { p } of candidates) {
      if (picked.length >= MAX_LABELS) break;
      if (picked.some((q) => Math.hypot(q.point[0] - p.point[0], q.point[1] - p.point[1]) < spacing)) continue;
      picked.push(p);
    }
    const key = picked.map((p) => p.id).join('|');
    if (key !== last.current.key) {
      last.current.key = key;
      setShown(picked);
    }
  });

  const open = (p: Place) => {
    const app = useAppStore.getState();
    if (app.selectedRoadId !== null) app.selectRoad(null);
    useTripStore.getState().setActive(false);
    useAreaStore.getState().setPlace(p);
  };

  return (
    <group>
      {shown.map((p) => (
        <Html key={p.id} position={[p.point[0], 30, -p.point[1]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <button
            type="button"
            onClick={() => open(p)}
            title={`${p.name}: show cameras nearby`}
            className={`pointer-events-auto whitespace-nowrap rounded px-1 leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.95),0_0_8px_rgba(0,0,0,0.7)] hover:text-white ${
              p.kind === 'area'
                ? 'text-[13px] font-bold uppercase tracking-wide text-slate-100'
                : p.kind === 'block'
                  ? 'text-[11px] font-semibold text-slate-300'
                  : 'text-[11px] font-medium text-[#f6f2ea]'
            }`}
          >
            {p.kind === 'landmark' && (
              <svg viewBox="0 0 24 24" className="mr-0.5 inline h-3.5 w-3.5 text-[#7cc4ff]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            )}
            {p.kind === 'block' ? p.name.split(',')[0] : p.name}
          </button>
        </Html>
      ))}
    </group>
  );
}
