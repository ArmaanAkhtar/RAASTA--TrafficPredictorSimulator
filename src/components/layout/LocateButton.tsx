'use client';

import { LOCATION_MESSAGE, useLocationStore } from '@/lib/location';

/** "My location" button: asks for location, shows the blue dot and flies the camera there. */
export default function LocateButton() {
  const status = useLocationStore((s) => s.status);
  const locate = useLocationStore((s) => s.locate);
  const message = LOCATION_MESSAGE[status];

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => locate(true)}
        aria-label="Show my location"
        title="Show my location on the map"
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b1220]/75 px-3 py-2 text-xs font-semibold text-slate-200 backdrop-blur-md hover:border-[#4da3ff]/60 hover:text-[#9cc9ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4da3ff]"
      >
        <svg viewBox="0 0 24 24" className={`h-4 w-4 ${status === 'locating' ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="7.5" />
        </svg>
        My location
      </button>
      {message && status !== 'locating' && <p className="max-w-[260px] text-[11px] leading-snug text-amber-300/90">{message}</p>}
    </div>
  );
}
