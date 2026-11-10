'use client';

// Layout A "Floating panels": everything in one glass column on the top-left (like /playground).
import Image from 'next/image';
import { useState } from 'react';
import CameraModal from '@/components/ui/CameraModal';
import DemoButton from '@/components/ui/DemoButton';
import FilterBar from '@/components/ui/FilterBar';
import HintChip from '@/components/ui/HintChip';
import IntroOverlay from '@/components/ui/IntroOverlay';
import Legend from '@/components/ui/Legend';
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

export default function LayoutA() {
  const roadPicked = useAppStore((state) => state.selectedRoadId !== null);
  const tripPanel = useTripPanelVisible();
  const areaPanel = useAreaPanelVisible();
  // A right panel (road, place or trip) is open: on phones it is a bottom sheet, so slim down the top column
  const roadSelected = roadPicked || tripPanel || areaPanel;
  const [timeOpen, setTimeOpen] = useState(false); // mobile only; desktop always shows the TimePicker

  // On phones the SidePanel is a bottom sheet: keep only brand + search on top so they never collide
  const hideOnPhoneWhenSelected = roadSelected ? 'hidden md:flex' : 'flex';

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="pointer-events-auto absolute left-3 right-3 top-3 flex flex-col gap-3 sm:left-4 sm:right-auto sm:top-4 sm:w-[360px]">
          <div className="flex items-baseline gap-2 px-1">
            <Image src="/raasta_logo_header.svg" width={119} height={28} alt="Raasta" className="h-6 w-auto md:h-7" />
            <p className="truncate text-xs text-slate-400">Know the rush before you leave</p>
          </div>

          <SearchBar />

          {/* Phone: compact time chip that opens the full picker */}
          <div className={roadSelected ? 'hidden' : 'flex md:hidden'}>
            <TimeChip open={timeOpen} onToggle={() => setTimeOpen((v) => !v)} />
          </div>
          <div className={`${timeOpen && !roadSelected ? 'block' : 'hidden'} md:block`}>
            <TimePicker />
          </div>

          {/* Plan a trip (From -> To, Time save / Petrol save), right under the time */}
          <div className={roadPicked ? 'hidden md:block' : 'block'}>
            <TripPlanner />
          </div>

          <div className={`${hideOnPhoneWhenSelected} flex-wrap items-center gap-2`}>
            <FilterBar />
          </div>
          <div className={`${hideOnPhoneWhenSelected} flex-wrap items-center gap-2`}>
            <DemoButton />
          </div>
          <div className={`${hideOnPhoneWhenSelected} items-start`}>
            <LocateButton />
          </div>
        </div>

        {/* Legend only where there is room next to the bottom-centre hint */}
        <div className="pointer-events-auto absolute bottom-4 left-4 hidden lg:[@media(min-height:900px)]:block">
          <Legend />
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
