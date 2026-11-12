'use client';

import type { ReactNode } from 'react';
import DemoButton from '@/components/ui/DemoButton';
import LocateButton from './LocateButton';

type MapControlAction = 'zoom-in' | 'zoom-out' | 'reset-view';

function sendMapControl(action: MapControlAction): void {
  window.dispatchEvent(new CustomEvent('raasta-map-control', { detail: action }));
}

function ZoomButton({ action, label, children }: { action: MapControlAction; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => sendMapControl(action)}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center text-xl leading-none text-[#f6f2ea] transition-colors hover:text-[#7cc4ff]"
    >
      {children}
    </button>
  );
}

export default function MapControlStack({ panelOpen = false }: { panelOpen?: boolean }) {
  return (
    <div
      className={`pointer-events-auto fixed bottom-4 z-[45] flex flex-col items-center gap-2 ${
        panelOpen ? 'hidden lg:flex lg:right-[404px]' : 'hidden right-4 md:flex'
      }`}
      aria-label="Map controls"
    >
      <div className="flex flex-col items-center gap-2">
        <LocateButton iconOnly />
        <div className="overflow-hidden rounded-xl border border-[#1f2a44] bg-[#0f1729] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <ZoomButton action="zoom-in" label="Zoom in">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </ZoomButton>
          <div className="mx-2 border-t border-[#1f2a44]" />
          <ZoomButton action="zoom-out" label="Zoom out">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </ZoomButton>
        </div>
        <button
          type="button"
          onClick={() => sendMapControl('reset-view')}
          aria-label="Reset map view"
          title="Reset map view"
          className="raasta-map-control"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12 2 3.2 8.8L12 9l-3.2 1.8L12 2Z" fill="currentColor" stroke="none" />
            <path d="M12 2v20" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </button>
        <DemoButton iconOnly />
      </div>
    </div>
  );
}
