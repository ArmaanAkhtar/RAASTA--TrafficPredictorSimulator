// src/components/ui/HintChip.tsx
// Small floating hint for new users: "Click any road to see details".
// Shows while no road is selected, until the user has picked a road once (remembered in localStorage).
// No props: reads the store only.
'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

const STORAGE_KEY = 'raasta-hint-done';

export default function HintChip() {
  const selectedRoadId = useAppStore((s) => s.selectedRoadId);

  const [ready, setReady] = useState(false); // browser-only, avoids hydration mismatch
  const [done, setDone] = useState(false);
  const [touch, setTouch] = useState(false);

  // Read storage + device type once in the browser
  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      seen = false;
    }
    setDone(seen);
    setTouch(window.matchMedia('(hover: none)').matches);
    setReady(true);
  }, []);

  // First time a road is selected, the user has learned it: hide for good
  useEffect(() => {
    if (!selectedRoadId || done) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage blocked: hint may show again next visit, which is fine
    }
    setDone(true);
  }, [selectedRoadId, done]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    setDone(true);
  };

  if (!ready || done || selectedRoadId) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-[#ffb547]/30 bg-[#0b1220]/85 py-2 pl-3 pr-2 text-sm text-slate-200 shadow-xl backdrop-blur-md"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ffb547] opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ffb547]" />
        </span>
        <span>
          <span className="font-semibold text-[#ffb547]">{touch ? 'Tap' : 'Click'} any road</span>
          <span className="hidden sm:inline"> to see its rush, jam chance and a better route</span>
          <span className="sm:hidden"> to see details</span>
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss hint"
          className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
