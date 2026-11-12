'use client';

// Layout B "Top bar + drawer": a slim bar on top, everything else in a drawer that slides in.
import Image from 'next/image';
import { useEffect, useState } from 'react';
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

const GLASS = 'raasta-panel';
const ICON_BTN =
  'raasta-button-secondary grid h-10 w-10 shrink-0 place-items-center';

export default function LayoutB() {
  const isMobile = useMobileViewport();
  return isMobile ? <MobileExperience /> : <DesktopLayoutB />;
}

function DesktopLayoutB() {
  const tripPanel = useTripPanelVisible();
  const areaPanel = useAreaPanelVisible();
  const roadPicked = useAppStore((state) => state.selectedRoadId !== null);
  const roadSelected = roadPicked || tripPanel || areaPanel; // any right panel open
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  // Esc closes the drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Picking a road closes the drawer so it does not cover the selected result.
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.selectedRoadId !== null && state.selectedRoadId !== prev.selectedRoadId) {
          setDrawerOpen(false);
        }
      }),
    [],
  );

  // On desktop the bar stops before the side panel (360px + 16px gap + 16px margin).
  const barRight = roadSelected ? 'md:right-[392px]' : 'md:right-4';

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-40">
        {/* ---------- Top bar ---------- */}
        <header
          className={`pointer-events-auto absolute left-2 right-2 top-2 flex min-h-[56px] items-center gap-2 px-2 py-2 md:left-4 md:top-4 md:min-h-[84px] md:px-3 ${barRight} ${GLASS}`}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <div className="raasta-panel flex w-[128px] shrink-0 flex-col items-start gap-0.5 px-2 py-1 md:w-auto md:gap-1 md:px-3 md:py-2">
              <Image src="/raasta_logo_header.svg" width={170} height={40} alt="Raasta" className="h-7 w-auto md:h-10" />
              <span className="hidden max-w-none text-xs leading-tight uppercase tracking-[0.14em] text-[#f6f2ea]/70 md:block md:whitespace-nowrap">
                Know the rush before you leave
              </span>
            </div>

            <div className="min-w-0 flex-1 [&>div>div]:py-2 md:mx-auto md:max-w-md">
              <SearchBar />
            </div>

            <div className="hidden shrink-0 items-center gap-2 2xl:flex">
              <TimeChip open={drawerOpen} onToggle={() => setDrawerOpen((v) => !v)} />
              <DemoButton />
            </div>

            <button
              type="button"
              aria-label={drawerOpen ? 'Close controls' : 'Open controls'}
              aria-expanded={drawerOpen}
              aria-controls="controls-drawer"
              className={ICON_BTN}
              onClick={() => {
                setTimeOpen(false);
                setDrawerOpen((v) => !v);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
                <circle cx="16" cy="6" r="2" />
                <circle cx="10" cy="12" r="2" />
                <circle cx="18" cy="18" r="2" />
              </svg>
            </button>
          </div>
        </header>

        <div className="raasta-mobile-time-row pointer-events-none absolute left-2 right-2 top-[72px] z-20 flex items-start gap-2 min-[390px]:top-[84px] md:left-4 md:right-auto md:top-[104px] md:hidden 2xl:hidden">
          <div className="pointer-events-auto relative inline-flex">
            <TimeChip open={timeOpen} onToggle={() => {
              setDrawerOpen(false);
              setTimeOpen((value) => !value);
            }} />
            {timeOpen && (
              <div className="absolute left-0 top-full mt-2 w-[min(360px,calc(100vw-1rem))]">
                <TimePicker />
              </div>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute left-4 right-[392px] top-[104px] z-20 hidden md:flex 2xl:hidden">
          <div className="pointer-events-auto relative">
            <TimeChip open={timeOpen} onToggle={() => {
              setDrawerOpen(false);
              setTimeOpen((value) => !value);
            }} />
            {timeOpen && (
              <div className="absolute left-0 top-full z-30 mt-2 w-[min(360px,calc(100vw-1rem))]">
                <TimePicker />
              </div>
            )}
          </div>
        </div>

        <div className="raasta-mobile-floats pointer-events-auto fixed right-3 bottom-[calc(25dvh+0.75rem+env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2 md:hidden">
          <div className="raasta-mobile-demo"><DemoButton /></div>
          <LocateButton />
        </div>

        {/* ---------- Drawer ---------- */}
        {drawerOpen && (
          // Click outside closes it
          <button
            type="button"
            aria-label="Close controls"
            tabIndex={-1}
            className="pointer-events-auto absolute inset-0 cursor-default bg-black/20"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <div
          id="controls-drawer"
          role="dialog"
          aria-label="Controls"
          aria-hidden={!drawerOpen}
          onWheelCapture={(event) => event.stopPropagation()}
          className={`raasta-scroll pointer-events-auto absolute left-2 right-2 top-[132px] max-h-[calc(100dvh-144px)] overflow-y-auto overscroll-contain p-3 transition-all duration-300 md:left-4 md:right-auto md:top-[100px] md:max-h-[calc(100dvh-116px)] md:w-[340px] ${GLASS} ${
            drawerOpen ? 'visible translate-x-0 opacity-100' : 'invisible -translate-y-2 opacity-0 md:-translate-x-4 md:translate-y-0'
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Controls</p>
            <button type="button" aria-label="Close controls" className={`${ICON_BTN} h-10 w-10`} onClick={() => setDrawerOpen(false)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="flex flex-col gap-3">
            <TimePicker />
            <div className={roadSelected ? 'hidden md:block' : 'block'}>
              <TripPlanner mobileSheetActive={!roadSelected} />
            </div>
            <div className="hidden md:block"><LocateButton /></div>
            <div className="hidden md:block"><FilterBar /></div>
            <div className="hidden flex-wrap items-center gap-2 2xl:hidden md:flex">
              <DemoButton />
            </div>
          </div>
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
