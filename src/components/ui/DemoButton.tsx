// src/components/ui/DemoButton.tsx
// One click plays the pitch story: Wednesday 4 PM -> Shahrah-e-Faisal -> better route shown.
'use client';

import { useEffect, useRef, useState } from 'react';
import { findAltRoute } from '../../lib/api';
import type { SelectedTime } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const DEMO_ROAD = 'Shahrah-e-Faisal';
const DEMO_TIME: SelectedTime = { day: 3, hour: 16, minute: 0 }; // Wednesday 4:00 PM
const ROUTE_DELAY_MS = 1500;
const CHIP_MS = 5000;

export default function DemoButton({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  const run = () => {
    const state = useAppStore.getState();
    const road = state.roads.find((r) => r.name === DEMO_ROAD);
    if (!road) {
      setNote('Roads are still loading, try again in a second.');
      timers.current.push(window.setTimeout(() => setNote(null), 2500));
      return;
    }

    clearTimers();
    setNote(null);
    setRunning(true);

    // 1. Wednesday 4 PM  2. select Shahrah-e-Faisal (camera flies there)
    state.setTime(DEMO_TIME);
    state.selectRoad(road.id);

    // 3. after a moment, show the better route
    timers.current.push(
      window.setTimeout(() => {
        const s = useAppStore.getState();
        const route = findAltRoute(s.roads, road.id, DEMO_TIME);
        s.setAltRoute(route);
        s.setShowRoute(route !== null);
      }, ROUTE_DELAY_MS),
    );
    timers.current.push(window.setTimeout(() => setRunning(false), CHIP_MS));
  };

  return (
    <div className={iconOnly ? 'flex flex-col items-center gap-2' : 'flex items-center gap-2'}>
      <button
        type="button"
        onClick={run}
        disabled={running}
        aria-label={iconOnly ? (running ? 'Demo running' : 'Play demo') : undefined}
        title={iconOnly ? 'Play demo' : undefined}
        className={iconOnly
          ? 'raasta-mobile-fab grid h-11 w-11 place-items-center rounded-full disabled:opacity-60'
          : 'raasta-button-primary flex min-h-10 items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60'}
      >
        <svg viewBox="0 0 24 24" className={iconOnly ? 'h-5 w-5' : 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth={iconOnly ? '1.75' : '1.5'} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        {!iconOnly && 'Play demo'}
      </button>
      {running && (
        <span className={`${iconOnly ? 'sr-only' : 'raasta-panel flex items-center gap-1.5 px-3 py-1 text-xs text-slate-200'}`} role={iconOnly ? 'status' : undefined}>
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#7cc4ff]" />
          Demo running
        </span>
      )}
      {note && <span className={iconOnly ? 'sr-only' : 'text-xs text-slate-400'} role={iconOnly ? 'status' : undefined}>{note}</span>}
    </div>
  );
}
