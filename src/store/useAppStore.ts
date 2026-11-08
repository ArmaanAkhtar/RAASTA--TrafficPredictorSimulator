import { create } from 'zustand';
import type { Road, RouteResult, RushLevel, SelectedTime } from '@/lib/types';

interface AppState {
  roads: Road[];
  selectedRoadId: string | null;
  selectedTime: SelectedTime;
  rain: boolean;
  filter: Record<RushLevel, boolean>;
  altRoute: RouteResult | null;
  showRoute: boolean;
  activeCameraId: string | null;
  flyToken: number;
  setRoads: (roads: Road[]) => void;
  selectRoad: (id: string | null) => void;
  setTime: (time: SelectedTime) => void;
  setRain: (rain: boolean) => void;
  toggleFilter: (level: RushLevel) => void;
  setAltRoute: (route: RouteResult | null) => void;
  setShowRoute: (show: boolean) => void;
  openCamera: (id: string | null) => void;
}

const now = new Date();

export const useAppStore = create<AppState>((set) => ({
  roads: [],
  selectedRoadId: null,
  selectedTime: { day: now.getDay(), hour: now.getHours(), minute: now.getMinutes() },
  rain: false,
  filter: { light: true, medium: true, heavy: true },
  altRoute: null,
  showRoute: false,
  activeCameraId: null,
  flyToken: 0,
  setRoads: (roads) => set({ roads }),
  selectRoad: (selectedRoadId) => set((state) => ({
    selectedRoadId,
    flyToken: state.flyToken + 1,
    altRoute: null,
    showRoute: false,
  })),
  setTime: (selectedTime) => set({ selectedTime }),
  setRain: (rain) => set({ rain }),
  toggleFilter: (level) => set((state) => ({
    filter: { ...state.filter, [level]: !state.filter[level] },
  })),
  setAltRoute: (altRoute) => set({ altRoute }),
  setShowRoute: (showRoute) => set({ showRoute }),
  openCamera: (activeCameraId) => set({ activeCameraId }),
}));
