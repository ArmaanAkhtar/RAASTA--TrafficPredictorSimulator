// src/components/ui/AreaPanel.tsx
// Right panel for an area / landmark picked in search: the traffic cameras around it (live view once
// Sindh Safe City grants access) and quick directions. Desktop: right panel. Mobile: bottom sheet.
'use client';

import { useEffect, useMemo } from 'react';
import { useAreaPanelVisible, useAreaStore } from '../../lib/area';
import { camerasNear } from '../../lib/cameras';
import { useLocationStore } from '../../lib/location';
import { MY_LOCATION_ID, useTripStore } from '../../lib/trip';
import { useAppStore } from '../../store/useAppStore';
import { CameraList, useCameras } from './CameraList';
import { PLACE_KIND_LABEL } from '../../lib/places';
import { useMobileSheet } from './useMobileSheet';

const RADIUS_M = 2500;

export default function AreaPanel({
  mobileEmbedded = false,
  onDirections,
}: {
  mobileEmbedded?: boolean;
  onDirections?: () => void;
} = {}) {
  const place = useAreaStore((s) => s.place);
  const setPlace = useAreaStore((s) => s.setPlace);
  const visible = useAreaPanelVisible();
  const allCameras = useCameras();
  const { snapPoint, snapHeightClass, handleProps } = useMobileSheet();

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
    onDirections?.();
  };

  return (
    <aside
      data-mobile-sheet={!mobileEmbedded || undefined}
      data-sheet-snap={mobileEmbedded ? undefined : snapPoint}
      onWheelCapture={(event) => event.stopPropagation()}
      className={mobileEmbedded
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden text-slate-100'
        : `raasta-panel fixed inset-x-0 bottom-0 z-30 flex ${snapHeightClass} flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] text-slate-100 transition-[height] duration-300 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[360px] md:pb-0`}
      aria-label={`Cameras around ${place.name}`}
    >
      {!mobileEmbedded && <button
        type="button"
        {...handleProps}
        className="flex min-h-10 w-full shrink-0 touch-none items-center justify-center md:hidden"
        aria-label={`Resize panel, currently ${snapPoint}`}
      >
        <span className="h-1 w-10 rounded-full bg-white/25" />
      </button>}

      <div className={`flex shrink-0 items-start gap-3 px-4 pb-3 ${mobileEmbedded ? 'pt-0' : 'pt-2 md:pt-4'}`}>
        <div className="min-w-0 flex-1">
          <p className="raasta-section-label">
            {PLACE_KIND_LABEL[place.kind]}
          </p>
          <h2 className={`truncate ${mobileEmbedded ? 'text-[17px]' : 'text-lg'} font-semibold`}>{place.name}</h2>
          <p className="text-xs text-slate-400">Traffic cameras within {RADIUS_M / 1000} km</p>
        </div>
        <button
          type="button"
          onClick={() => setPlace(null)}
          aria-label="Close"
          className={`grid ${mobileEmbedded ? 'h-11 w-11 rounded-[14px]' : 'h-10 w-10 rounded-lg'} shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-slate-100`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="raasta-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4">
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
          className="raasta-button-primary min-h-10 w-full py-2 text-sm"
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
