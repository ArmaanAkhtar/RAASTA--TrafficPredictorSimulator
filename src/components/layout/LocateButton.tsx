'use client';

import { LOCATION_MESSAGE, useLocationStore } from '@/lib/location';

/** "My location" button: asks for location, shows the blue dot and flies the camera there. */
export default function LocateButton({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const status = useLocationStore((s) => s.status);
  const locate = useLocationStore((s) => s.locate);
  const message = LOCATION_MESSAGE[status];

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => locate(true)}
        aria-label={iconOnly ? 'My location' : 'Show my location'}
        title="Show my location on the map"
        className={iconOnly
          ? 'raasta-mobile-fab grid h-11 w-11 place-items-center rounded-full'
          : 'raasta-button-secondary flex min-h-10 items-center gap-1.5 px-3 py-2 text-xs font-semibold hover:text-[#7cc4ff]'}
      >
        <svg viewBox="0 0 24 24" className={`${iconOnly ? 'h-5 w-5' : 'h-4 w-4'} ${status === 'locating' ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth={iconOnly ? '1.75' : '1.5'} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="7.5" />
        </svg>
        {!iconOnly && 'My location'}
      </button>
      {message && status !== 'locating' && (
        <p className={`${iconOnly ? 'sr-only' : 'max-w-[260px] text-[11px] leading-snug text-[#f6f2ea]/80'}`} role={iconOnly ? 'status' : undefined}>
          {message}
        </p>
      )}
    </div>
  );
}
