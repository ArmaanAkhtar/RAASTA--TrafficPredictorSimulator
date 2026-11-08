'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

export function DevControls() {
  const lowGraphics = useAppStore((state) => state.lowGraphics);
  const setLowGraphics = useAppStore((state) => state.setLowGraphics);
  const [open, setOpen] = useState(false);

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <label className="rounded-lg border border-white/10 bg-[#0b1220]/90 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur-sm">
          <input
            type="checkbox"
            checked={lowGraphics}
            onChange={(event) => setLowGraphics(event.target.checked)}
            className="mr-2 accent-[#ffb547]"
          />
          Low graphics
        </label>
      )}
      <button
        type="button"
        aria-label="Graphics settings"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[#0b1220]/90 text-slate-300 shadow-xl backdrop-blur-sm hover:text-[#ffb547]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06A1.7 1.7 0 0 0 16.44 18a1.7 1.7 0 0 0-1 .44V19h-2v-.1a1.7 1.7 0 0 0-1-.44 1.7 1.7 0 0 0-1.88-.34l-.06-.06-1.42-1.42.06-.06A1.7 1.7 0 0 0 9 16.44V15H7v2h1.56a1.7 1.7 0 0 0 1 1.56" />
        </svg>
      </button>
    </div>
  );
}
