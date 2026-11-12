// src/lib/location.ts
// The user's current location (browser geolocation), shared by the 3D marker, the camera and the trip planner.
// Separate small store so the shared app store does not need to change.
'use client';

import { create } from 'zustand';
import { toLocal } from './places';
import { useAppStore } from '@/store/useAppStore';
import type { Pt } from './types';

export type LocationStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'outside';

interface LocationState {
  status: LocationStatus;
  point: Pt | null; // local metres
  accuracyM: number | null;
  /** Bumped when the user asks to fly the camera to their location. */
  flyToken: number;
  locate: (flyThere?: boolean) => void;
}

function inMapBounds([x, y]: Pt): boolean {
  const roads = useAppStore.getState().roads;
  if (roads.length === 0) return true;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  roads.forEach((road) => road.segments.forEach((segment) => segment.forEach(([roadX, roadY]) => {
    minX = Math.min(minX, roadX);
    maxX = Math.max(maxX, roadX);
    minY = Math.min(minY, roadY);
    maxY = Math.max(maxY, roadY);
  })));
  const margin = 5000;
  return x >= minX - margin && x <= maxX + margin && y >= minY - margin && y <= maxY + margin;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  status: 'idle',
  point: null,
  accuracyM: null,
  flyToken: 0,
  locate: (flyThere = true) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      set({ status: 'unavailable' });
      return;
    }
    if (get().status === 'locating') return;
    set({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = toLocal(pos.coords.latitude, pos.coords.longitude);
        if (!inMapBounds(point)) {
          set({ status: 'outside', point: null, accuracyM: null });
          return;
        }
        set((s) => ({
          status: 'ok',
          point,
          accuracyM: Math.round(pos.coords.accuracy),
          flyToken: flyThere ? s.flyToken + 1 : s.flyToken,
        }));
      },
      (err) => set({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  },
}));

export const LOCATION_MESSAGE: Record<LocationStatus, string> = {
  idle: '',
  locating: 'Finding your location…',
  ok: '',
  denied: 'Location permission was blocked. Allow it in the browser address bar and try again.',
  unavailable: 'Could not get your location. Check that location is on, then try again.',
  outside: 'You seem to be outside Karachi, so your location is not on this map.',
};
