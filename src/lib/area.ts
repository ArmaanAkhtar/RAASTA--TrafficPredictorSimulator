// src/lib/area.ts
// A place picked in the search bar (area / landmark): the camera flies there and the place panel
// lists the traffic cameras around it. A road selection or an active trip replaces it.
import { create } from 'zustand';
import { useAppStore } from '../store/useAppStore';
import type { Place } from './places';

interface AreaState {
  place: Place | null;
  /** bumped on every pick so the camera flies even to the same place again */
  flyToken: number;
  setPlace: (p: Place | null) => void;
}

export const useAreaStore = create<AreaState>((set) => ({
  place: null,
  flyToken: 0,
  setPlace: (place) => set((s) => ({ place, flyToken: place ? s.flyToken + 1 : s.flyToken })),
}));

/** Place panel is showing (no road selected and a place picked). */
export function useAreaPanelVisible(): boolean {
  const noRoad = useAppStore((s) => s.selectedRoadId === null);
  const hasPlace = useAreaStore((s) => s.place !== null);
  return noRoad && hasPlace;
}
