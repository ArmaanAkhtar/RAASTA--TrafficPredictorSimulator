'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LEVEL_COLOR, predict } from '@/lib/api';
import { useAreaPanelVisible, useAreaStore } from '@/lib/area';
import { useTripPanelVisible } from '@/lib/trip';
import type { RushLevel } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import AreaPanel from '@/components/ui/AreaPanel';
import { CameraList, useCameras } from '@/components/ui/CameraList';
import CameraModal from '@/components/ui/CameraModal';
import DemoButton from '@/components/ui/DemoButton';
import IntroOverlay from '@/components/ui/IntroOverlay';
import SearchBar from '@/components/ui/SearchBar';
import SidePanel from '@/components/ui/SidePanel';
import TimePicker, { formatTime } from '@/components/ui/TimePicker';
import TimeChip from './TimeChip';
import TripPanel from '@/components/ui/TripPanel';
import TripPlanner from '@/components/ui/TripPlanner';
import LocateButton from './LocateButton';
import { useMobileSheet } from '@/components/ui/useMobileSheet';

type MobileView = 'home' | 'time' | 'planner' | 'cameras';

const LEVELS: RushLevel[] = ['heavy', 'medium', 'light'];

export default function MobileExperience() {
  const roads = useAppStore((state) => state.roads);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const placeId = useAreaStore((state) => state.place?.id ?? null);
  const selectedTime = useAppStore((state) => state.selectedTime);
  const tripPanel = useTripPanelVisible();
  const areaPanel = useAreaPanelVisible();
  const cameras = useCameras();
  const { snapPoint, handleProps, setSnapPoint } = useMobileSheet();
  const [view, setView] = useState<MobileView>('home');
  const [plannerEditing, setPlannerEditing] = useState(false);
  const [searchResultsTarget, setSearchResultsTarget] = useState<HTMLDivElement | null>(null);
  const previousSelection = useRef({ roadId: selectedRoadId, placeId });

  const summary = useMemo(() => {
    const counts: Record<RushLevel, number> = { heavy: 0, medium: 0, light: 0 };
    for (const road of roads) counts[predict(road, selectedTime).nowLevel] += 1;
    return counts;
  }, [roads, selectedTime]);
  const total = roads.length;
  const panel = view === 'time' || view === 'cameras'
    ? view
    : view === 'planner'
      ? plannerEditing ? 'planner' : tripPanel ? 'trip' : 'planner'
      : selectedRoadId !== null ? 'road' : areaPanel ? 'area' : tripPanel ? 'trip' : 'home';
  const timeLabel = formatTime(selectedTime.hour, selectedTime.minute);
  const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][selectedTime.day] ?? '';

  useEffect(() => {
    if (panel === 'road' || panel === 'area' || panel === 'trip') setSnapPoint('half');
  }, [panel, setSnapPoint]);

  useEffect(() => {
    if (
      (selectedRoadId !== null && selectedRoadId !== previousSelection.current.roadId) ||
      (placeId !== null && placeId !== previousSelection.current.placeId)
    ) {
      setView('home');
    }
    previousSelection.current = { roadId: selectedRoadId, placeId };
  }, [selectedRoadId, placeId]);

  const openView = (next: MobileView) => {
    setView(next);
    setPlannerEditing(next === 'planner');
    setSnapPoint('half');
  };

  const closeView = () => {
    setView('home');
    setPlannerEditing(false);
    setSnapPoint(selectedRoadId !== null || areaPanel || tripPanel ? 'half' : 'peek');
  };

  return (
    <>
      <header className="pointer-events-auto absolute inset-x-3 top-[calc(env(safe-area-inset-top)+12px)] z-40 flex flex-col gap-2">
        <SearchBar
          mobile
          resultsTarget={searchResultsTarget}
          onSearchOpen={() => setSnapPoint('half')}
          onSelection={() => {
            setView('home');
            setPlannerEditing(false);
          }}
        />
        <div className="raasta-mobile-chips flex min-w-0 items-center gap-2 overflow-x-auto">
          <TimeChip
            open={panel === 'time'}
            onToggle={() => panel === 'time' ? closeView() : openView('time')}
            compact
            className="raasta-mobile-chip min-h-11 shrink-0 px-3 py-1 text-[13px]"
          />
          <button
            type="button"
            onClick={() => panel === 'planner' ? closeView() : openView('planner')}
            aria-expanded={panel === 'planner' || panel === 'trip'}
            className={`raasta-mobile-chip raasta-button-secondary flex min-h-11 shrink-0 items-center gap-2 px-3 py-1 text-[13px] font-medium ${
              panel === 'planner' || panel === 'trip' ? 'border-[#7cc4ff] bg-[#7cc4ff]/10 text-[#7cc4ff]' : ''
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7cc4ff]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="18" r="2.5" />
              <circle cx="18" cy="6" r="2.5" />
              <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
            </svg>
            Plan a trip
          </button>
        </div>
      </header>

      <div className="raasta-mobile-floats pointer-events-auto fixed right-3 z-30 flex flex-col items-center gap-2">
        <LocateButton iconOnly />
        <DemoButton iconOnly />
      </div>

      <section
        data-mobile-sheet
        data-sheet-snap={snapPoint}
        data-sheet-content-fit={panel === 'planner' ? '' : undefined}
        aria-label="Raasta"
        className="raasta-mobile-sheet raasta-panel pointer-events-auto fixed inset-x-0 bottom-0 z-30 flex h-[88dvh] flex-col overflow-visible"
      >
        <div className="raasta-mobile-floats pointer-events-auto absolute right-3 top-[-12px] z-[45] flex -translate-y-full flex-col items-center gap-2">
          <LocateButton iconOnly />
          <DemoButton iconOnly />
        </div>
        {panel !== 'planner' && (
          <button
            type="button"
            {...handleProps}
            className="flex h-11 w-full shrink-0 touch-none items-center justify-center"
            aria-label={`Resize panel, currently ${snapPoint}`}
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </button>
        )}
        <div
          id="mobile-search-results"
          ref={(element) => setSearchResultsTarget(element)}
          className="pointer-events-none absolute inset-x-3 top-11 z-20"
        />

        {panel === 'road' && <SidePanel mobileEmbedded />}
        {panel === 'area' && <AreaPanel mobileEmbedded onDirections={() => openView('planner')} />}
        {panel === 'trip' && <TripPanel mobileEmbedded />}

        {panel === 'home' && (
          <div className="mobile-sheet-scroll min-h-0 flex-1 px-4 pb-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-base font-semibold leading-5 text-[#f6f2ea]">Karachi right now</h1>
              <p className="shrink-0 text-[11px] tabular-nums text-[#8f9bb8]">{dayLabel} · {timeLabel}</p>
            </div>

            <div className="mt-1" aria-label="Traffic level share">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-[#1f2a44]">
                {LEVELS.map((level) => (
                  <span
                    key={level}
                    className="h-full"
                    style={{
                      width: `${total ? (summary[level] / total) * 100 : 0}%`,
                      backgroundColor: LEVEL_COLOR[level],
                    }}
                  />
                ))}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[13px] leading-5 text-[#8f9bb8]">
                {total
                  ? <>Heavy {summary.heavy} <span className="text-[#1f2a44]">·</span> Medium {summary.medium} <span className="text-[#1f2a44]">·</span> Light {summary.light}</>
                  : 'Traffic data loading'}
              </p>
            </div>

            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openView('planner')}
                className="raasta-button-primary min-h-11 rounded-full px-3 text-[13px] font-semibold"
              >
                Plan a trip
              </button>
              <button
                type="button"
                onClick={() => openView('cameras')}
                className="raasta-button-secondary min-h-11 rounded-full px-3 text-[13px] font-semibold"
              >
                Cameras
              </button>
            </div>
          </div>
        )}

        {panel === 'time' && (
          <div className="mobile-sheet-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            <SheetHeading title="Departure time" onClose={closeView} />
            <TimePicker mobileEmbedded />
          </div>
        )}

        {panel === 'planner' && (
          <>
            <SheetHeading title="Plan a trip" onClose={closeView} />
            <TripPlanner mobileEmbedded onMapAction={() => setPlannerEditing(false)} />
          </>
        )}

        {panel === 'cameras' && (
          <div className="mobile-sheet-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            <SheetHeading title="Traffic cameras" onClose={closeView} />
            <CameraList
              title="Cameras around Karachi"
              cameras={cameras}
              emptyText="No traffic cameras reported yet."
            />
          </div>
        )}
      </section>
      <CameraModal />
      <IntroOverlay />
    </>
  );
}

function SheetHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-3 px-4 pt-2">
      <button
        type="button"
        onClick={onClose}
        aria-label="Back to Karachi right now"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#1f2a44] bg-[#141d33] text-[#8f9bb8] hover:border-[#7cc4ff] hover:text-[#f6f2ea]"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5m7 7-7-7 7-7" />
        </svg>
      </button>
      <h2 className="min-w-0 flex-1 text-[17px] font-semibold text-[#f6f2ea]">{title}</h2>
    </div>
  );
}
