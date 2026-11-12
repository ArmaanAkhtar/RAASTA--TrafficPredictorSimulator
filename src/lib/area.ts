// src/lib/area.ts
// A place picked in the search bar (area / landmark): the camera flies there and the place panel
// lists the traffic cameras around it. A road selection or an active trip replaces it.
import { create } from 'zustand';
import { useAppStore } from '../store/useAppStore';
import type { Place } from './places';

interface AreaState {
  place: Place | null;
  cameraPlace: Place | null;
  /** bumped on every pick so the camera flies even to the same place again */
  flyToken: number;
  setPlace: (p: Place | null) => void;
  flyTo: (p: Place) => void;
}

export const useAreaStore = create<AreaState>((set) => ({
  place: null,
  cameraPlace: null,
  flyToken: 0,
  setPlace: (place) => set((state) => ({
    place,
    cameraPlace: place ?? state.cameraPlace,
    flyToken: place ? state.flyToken + 1 : state.flyToken,
  })),
  flyTo: (place) => set((state) => ({ cameraPlace: place, flyToken: state.flyToken + 1 })),
}));

/** Place panel is showing (no road selected and a place picked). */
export function useAreaPanelVisible(): boolean {
  const noRoad = useAppStore((s) => s.selectedRoadId === null);
  const hasPlace = useAreaStore((s) => s.place !== null);
  return noRoad && hasPlace;
}
