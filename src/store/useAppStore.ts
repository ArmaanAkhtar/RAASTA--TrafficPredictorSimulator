import { create } from 'zustand';
import type { Road, RouteResult, RushLevel, SelectedTime } from '@/lib/types';

interface AppState {
  roads: Road[];
  sceneReady: boolean;
  roadLoadError: string | null;
  selectedRoadId: string | null;
  selectedTime: SelectedTime;
  filter: Record<RushLevel, boolean>;
  altRoute: RouteResult | null;
  showRoute: boolean;
  activeCameraId: string | null;
  flyToken: number;
  lowGraphics: boolean;
  setRoads: (roads: Road[]) => void;
  setRoadLoadError: (message: string | null) => void;
  setSceneReady: (ready: boolean) => void;
  selectRoad: (id: string | null) => void;
  setTime: (time: SelectedTime) => void;
  toggleFilter: (level: RushLevel) => void;
  setAltRoute: (route: RouteResult | null) => void;
  setShowRoute: (show: boolean) => void;
  openCamera: (id: string | null) => void;
  setLowGraphics: (low: boolean) => void;
}


export const useAppStore = create<AppState>((set) => ({
  roads: [],
  sceneReady: false,
  roadLoadError: null,
  selectedRoadId: null,
  selectedTime: { day: 3, hour: 16, minute: 0 }, // Wed 4:00 PM fixed default (avoids hydration mismatch)
  filter: { light: true, medium: true, heavy: true },
  altRoute: null,
  showRoute: false,
  activeCameraId: null,
  flyToken: 0,
  lowGraphics: false,
  setRoads: (roads) => set({ roads, sceneReady: false, roadLoadError: null }),
  setRoadLoadError: (roadLoadError) => set({ roadLoadError }),
  setSceneReady: (sceneReady) => set({ sceneReady }),
  selectRoad: (selectedRoadId) => set((state) => ({
    selectedRoadId,
    flyToken: state.flyToken + 1,
    altRoute: null,
    showRoute: false,
  })),
  setTime: (selectedTime) => set({ selectedTime }),
  toggleFilter: (level) => set((state) => ({
    filter: { ...state.filter, [level]: !state.filter[level] },
  })),
  setAltRoute: (altRoute) => set({ altRoute }),
  setShowRoute: (showRoute) => set({ showRoute }),
  openCamera: (activeCameraId) => set({ activeCameraId }),
  setLowGraphics: (lowGraphics) => set({ lowGraphics }),
}));
