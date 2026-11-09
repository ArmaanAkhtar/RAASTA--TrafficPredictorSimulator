// src/components/ui/IntroOverlay.tsx
// Shown on the first visit only (remembered in localStorage).
'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'raasta-intro-seen';

const STEPS = [
  { title: 'Search a road', text: 'Type any major Karachi road, like Shahrah-e-Faisal.' },
  { title: 'Pick a time', text: 'Choose the day and the time you plan to leave.' },
  { title: 'See the prediction', text: 'Rush right now, jam chance next hour, and a better route.' },
];

export default function IntroOverlay() {
  const [open, setOpen] = useState(false);

  // Read storage only in the browser, after the first render (no hydration mismatch)
  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      seen = false; // storage blocked: just show the intro
    }
    if (!seen) setOpen(true);
  }, []);

  const close = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage blocked: the intro will show again next time, which is fine
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0b1220]/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b1220] p-6 text-slate-100 shadow-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Karachi Traffic Intelligence</p>
        <h1 className="mt-1 text-4xl font-bold text-[#ffb547]">Raasta</h1>
        <p className="mt-2 text-lg text-slate-200">Know the rush before you leave.</p>

        <ol className="mt-6 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ffb547]/15 text-sm font-semibold text-[#ffb547]">
                {i + 1}
              </span>
              <span>
                <span className="block font-medium">{s.title}</span>
                <span className="block text-sm text-slate-400">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={close}
          autoFocus
          className="mt-7 w-full rounded-xl bg-[#ffb547] py-3 font-semibold text-[#0b1220] transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          Start
        </button>
        <p className="mt-3 text-center text-xs text-slate-500">
          Prototype: pattern-based predictions on major roads.
        </p>
      </div>
    </div>
  );
}
