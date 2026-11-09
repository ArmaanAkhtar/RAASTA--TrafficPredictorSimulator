// src/lib/location.ts
// The user's current location (browser geolocation), shared by the 3D marker, the camera and the trip planner.
// Separate small store so the shared app store does not need to change.
'use client';

import { create } from 'zustand';
import { toLocal } from './places';
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

// The road map covers x -10..24 km, y -8..24 km around the origin; allow ~5 km around it
const KARACHI_BOX = { minX: -15000, maxX: 29000, minY: -13000, maxY: 29000 };
const inKarachi = ([x, y]: Pt) => x >= KARACHI_BOX.minX && x <= KARACHI_BOX.maxX && y >= KARACHI_BOX.minY && y <= KARACHI_BOX.maxY;

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
        if (!inKarachi(point)) {
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
