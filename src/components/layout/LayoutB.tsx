'use client';

// Layout B "Top bar + drawer": a slim bar on top, everything else in a drawer that slides in.
import Image from 'next/image';
import { useEffect, useState } from 'react';
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

const GLASS = 'border border-white/10 bg-[#0b1220]/80 shadow-xl backdrop-blur-md';
const ICON_BTN =
  'grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb547]';

export default function LayoutB() {
  const tripPanel = useTripPanelVisible();
  const areaPanel = useAreaPanelVisible();
  const roadPicked = useAppStore((state) => state.selectedRoadId !== null);
  const roadSelected = roadPicked || tripPanel || areaPanel; // any right panel open
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);

  // Esc closes the drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Picking a road closes the drawer and the phone search, so they never cover the SidePanel
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.selectedRoadId !== null && state.selectedRoadId !== prev.selectedRoadId) {
          setDrawerOpen(false);
          setMobileSearch(false);
        }
      }),
    [],
  );

  // On desktop the bar stops before the SidePanel (360px + 16px gap + 16px margin)
  const barRight = roadSelected ? 'md:right-[392px]' : 'md:right-4';

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20">
        {/* ---------- Top bar ---------- */}
        <header
          className={`pointer-events-auto absolute left-2 right-2 top-2 flex h-14 items-center gap-2 rounded-2xl px-2 md:left-4 md:top-4 md:px-3 ${barRight} ${GLASS}`}
        >
          {mobileSearch ? (
            // Phone: search takes the whole bar
            <div className="flex w-full items-center gap-2 md:hidden">
              <div className="min-w-0 flex-1">
                <SearchBar />
              </div>
              <button type="button" aria-label="Close search" className={ICON_BTN} onClick={() => setMobileSearch(false)}>
                ✕
              </button>
            </div>
          ) : null}

          <div className={`${mobileSearch ? 'hidden md:flex' : 'flex'} w-full items-center gap-2`}>
            <div className="flex shrink-0 items-baseline gap-2 pl-1">
              <Image src="/raasta_logo_header.svg" width={119} height={28} alt="Raasta" className="h-6 w-auto md:h-7" />
              <span className="hidden text-xs text-slate-400 xl:inline">Know the rush before you leave</span>
            </div>

            {/* Desktop search, centred */}
            <div className="mx-auto hidden w-full max-w-md md:block [&>div>div]:py-2">
              <SearchBar />
            </div>
            <div className="flex-1 md:hidden" />

            {/* Phone: search icon */}
            <button type="button" aria-label="Search roads" className={`${ICON_BTN} md:hidden`} onClick={() => setMobileSearch(true)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>

            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              <TimeChip open={drawerOpen} onToggle={() => setDrawerOpen((v) => !v)} showRain />
              <DemoButton />
            </div>

            <button
              type="button"
              aria-label={drawerOpen ? 'Close controls' : 'Open controls'}
              aria-expanded={drawerOpen}
              aria-controls="controls-drawer"
              className={ICON_BTN}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
                <circle cx="16" cy="6" r="2" />
                <circle cx="10" cy="12" r="2" />
                <circle cx="18" cy="18" r="2" />
              </svg>
            </button>
          </div>
        </header>

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
          className={`pointer-events-auto absolute left-2 right-2 top-[72px] max-h-[calc(100dvh-88px)] overflow-y-auto rounded-2xl p-3 transition-all duration-300 md:left-4 md:right-auto md:top-[84px] md:w-[340px] ${GLASS} ${
            drawerOpen ? 'visible translate-x-0 opacity-100' : 'invisible -translate-y-2 opacity-0 md:-translate-x-4 md:translate-y-0'
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Controls</p>
            <button type="button" aria-label="Close controls" className={`${ICON_BTN} h-8 w-8`} onClick={() => setDrawerOpen(false)}>
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-3">
            <TimePicker />
            <TripPlanner />
            <LocateButton />
            <FilterBar />
            <div className="flex flex-wrap items-center gap-2 lg:hidden">
              <DemoButton />
            </div>
            <Legend />
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
