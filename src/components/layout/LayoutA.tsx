'use client';

// Layout A "Floating panels": everything in one glass column on the top-left (like /playground).
import Image from 'next/image';
import { useState } from 'react';
import CameraModal from '@/components/ui/CameraModal';
import DemoButton from '@/components/ui/DemoButton';
import FilterBar from '@/components/ui/FilterBar';
import HintChip from '@/components/ui/HintChip';
import IntroOverlay from '@/components/ui/IntroOverlay';
import SearchBar from '@/components/ui/SearchBar';
import SidePanel from '@/components/ui/SidePanel';
import TimePicker from '@/components/ui/TimePicker';
import TripPlanner from '@/components/ui/TripPlanner';
import TripPanel from '@/components/ui/TripPanel';
import AreaPanel from '@/components/ui/AreaPanel';
import { useAreaPanelVisible } from '@/lib/area';
import LocateButton from './LocateButton';
import { useAppStore } from '@/store/useAppStore';
import { useTripPanelVisible } from '@/lib/trip';
import TimeChip from './TimeChip';
import MobileExperience from './MobileExperience';
import { useMobileViewport } from './useMobileViewport';

export default function LayoutA() {
  const isMobile = useMobileViewport();
  return isMobile ? <MobileExperience /> : <DesktopLayoutA />;
}

function DesktopLayoutA() {
  const roadPicked = useAppStore((state) => state.selectedRoadId !== null);
  const tripPanel = useTripPanelVisible();
  const areaPanel = useAreaPanelVisible();
  // A selected result takes the mobile bottom sheet; keep the map controls compact above it.
  const roadSelected = roadPicked || tripPanel || areaPanel;
  const [timeOpen, setTimeOpen] = useState(false); // mobile only; desktop always shows the TimePicker

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-40">
        <div className="raasta-scroll pointer-events-auto absolute left-2 right-2 top-2 flex max-h-[calc(100dvh-1rem)] flex-col gap-2 overflow-visible sm:left-4 sm:right-auto sm:top-4 md:max-h-[calc(100dvh-2rem)] md:w-[360px] md:gap-3 md:overflow-y-auto md:overscroll-contain md:pr-1">
          <div className="flex items-center gap-2 md:flex-col md:items-start">
            <div className="raasta-panel flex w-[128px] shrink-0 flex-col items-start gap-0.5 px-2 py-1.5 md:w-full md:gap-1.5 md:px-4 md:py-3">
              <Image src="/raasta_logo_header.svg" width={170} height={40} alt="Raasta" className="h-7 w-auto md:h-10" />
              <p className="hidden max-w-[120px] text-[8px] leading-tight uppercase tracking-[0.1em] text-[#f6f2ea]/70 min-[390px]:block md:max-w-none md:text-xs md:tracking-[0.14em]">Know the rush before you leave</p>
            </div>
            <div className="min-w-0 flex-1 md:w-full md:flex-none">
              <SearchBar />
            </div>
          </div>

          <div className="raasta-mobile-time-row flex items-center gap-2 md:hidden">
            <TimeChip open={timeOpen} onToggle={() => setTimeOpen((v) => !v)} />
          </div>
          <div className={`${timeOpen ? 'block' : 'hidden'} md:hidden`}>
            <TimePicker />
          </div>
          <div className="hidden md:block">
            <TimePicker />
          </div>

          <div className={roadSelected ? 'hidden md:block' : 'block'}>
            <TripPlanner mobileSheetActive={!roadSelected} />
          </div>

          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <FilterBar />
          </div>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <DemoButton />
            <LocateButton />
          </div>
        </div>

        <div className="raasta-mobile-floats pointer-events-auto fixed right-3 bottom-[calc(25dvh+0.75rem+env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2 md:hidden">
          <div className="raasta-mobile-demo"><DemoButton /></div>
          <LocateButton />
        </div>
      </div>

      {/* These position themselves (fixed) */}
      <HintChip />
      <SidePanel />
      <TripPanel />
      <AreaPanel />
      <CameraModal />
      <IntroOverlay />
    </>
  );
}
