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

export default function DemoButton() {
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

    // 1. Wednesday 4 PM, no rain  2. select Shahrah-e-Faisal (camera flies there)
    state.setRain(false);
    state.setTime(DEMO_TIME);
    state.selectRoad(road.id);

    // 3. after a moment, show the better route
    timers.current.push(
      window.setTimeout(() => {
        const s = useAppStore.getState();
        const route = findAltRoute(s.roads, road.id, DEMO_TIME, false);
        s.setAltRoute(route);
        s.setShowRoute(route !== null);
      }, ROUTE_DELAY_MS),
    );
    timers.current.push(window.setTimeout(() => setRunning(false), CHIP_MS));
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="flex items-center gap-1.5 rounded-full bg-[#ffb547] px-4 py-2 text-sm font-semibold text-[#0b1220] shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
        Play demo
      </button>
      {running && (
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b1220]/80 px-3 py-1 text-xs text-slate-200 backdrop-blur-md">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffb547]" />
          Demo running
        </span>
      )}
      {note && <span className="text-xs text-slate-400">{note}</span>}
    </div>
  );
}
