// src/components/ui/AreaPanel.tsx
// Right panel for an area / landmark picked in search: the traffic cameras around it (live view once
// Sindh Safe City grants access) and quick directions. Desktop: right panel. Mobile: bottom sheet.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAreaPanelVisible, useAreaStore } from '../../lib/area';
import { camerasNear } from '../../lib/cameras';
import { useLocationStore } from '../../lib/location';
import { MY_LOCATION_ID, useTripStore } from '../../lib/trip';
import { useAppStore } from '../../store/useAppStore';
import { CameraList, useCameras } from './CameraList';
import { CAT_ICON, PLACE_KIND_LABEL } from '../../lib/places';

const RADIUS_M = 2500;

export default function AreaPanel() {
  const place = useAreaStore((s) => s.place);
  const setPlace = useAreaStore((s) => s.setPlace);
  const visible = useAreaPanelVisible();
  const allCameras = useCameras();
  const [collapsed, setCollapsed] = useState(false);

  // Picking a road hands the right side over to the road panel
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.selectedRoadId !== null && state.selectedRoadId !== prev.selectedRoadId) {
          useAreaStore.getState().setPlace(null);
        }
      }),
    [],
  );

  const near = useMemo(() => (place ? camerasNear(allCameras, place.point, RADIUS_M) : []), [allCameras, place]);

  if (!visible || !place) return null;

  const directions = () => {
    const trip = useTripStore.getState();
    const loc = useLocationStore.getState();
    trip.setTo(place);
    if (loc.point) {
      trip.setFrom({ id: MY_LOCATION_ID, name: 'My location', kind: 'location', point: loc.point });
    } else {
      loc.locate(false); // the planner fills "My location" in once it is known, or the user types a From
    }
    setPlace(null); // show the trip panel instead
  };

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0b1220]/85 text-slate-100 shadow-2xl backdrop-blur-md transition-[max-height] duration-300 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[360px] md:rounded-2xl ${
        collapsed ? 'max-h-[76px]' : 'max-h-[75vh]'
      }`}
      aria-label={`Cameras around ${place.name}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full justify-center pt-2 md:hidden"
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <span className="h-1 w-10 rounded-full bg-white/25" />
      </button>

      <div className="flex items-start gap-3 px-4 pb-3 pt-2 md:pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#ffb547]">
            {place.cat ? `${CAT_ICON[place.cat] ?? ''} ` : ''}{PLACE_KIND_LABEL[place.kind]}
          </p>
          <h2 className="truncate text-lg font-semibold">{place.name}</h2>
          <p className="text-xs text-slate-400">Traffic cameras within {RADIUS_M / 1000} km</p>
        </div>
        <button
          type="button"
          onClick={() => setPlace(null)}
          aria-label="Close"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <CameraList
          title={`Cameras near ${place.name}`}
          cameras={near}
          detail={(c) => {
            const d = near.find((n) => n.id === c.id)?.distanceM ?? 0;
            return `${c.roadName} · ${d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`} away`;
          }}
          emptyText="No traffic cameras reported around here yet. Search a main road to see its cameras."
        />
        <button
          type="button"
          onClick={directions}
          className="w-full rounded-xl bg-[#7cc4ff] py-2 text-sm font-semibold text-[#0b1220] hover:opacity-90"
        >
          Directions to {place.name}
        </button>
        <p className="text-[11px] text-slate-500">
          Opens a trip from your location (allow location access), with the best time to leave and the cameras on the way.
        </p>
      </div>
    </aside>
  );
}
