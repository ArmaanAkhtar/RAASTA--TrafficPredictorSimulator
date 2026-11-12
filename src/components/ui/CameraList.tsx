// src/components/ui/CameraList.tsx
// Shared list of cameras used inside the road, place and trip panels.
// Click a camera to open its view (CameraModal). Not mounted on its own.
'use client';

import { useEffect, useState } from 'react';
import { hasLiveFeed, loadCameras, type CameraInfo } from '../../lib/cameras';
import { useAppStore } from '../../store/useAppStore';
import { CameraIcon } from './CameraIcon';

/** All cameras, loaded once. */
export function useCameras(): CameraInfo[] {
  const [cams, setCams] = useState<CameraInfo[]>([]);
  useEffect(() => {
    let alive = true;
    loadCameras()
      .then((c) => {
        if (alive) setCams(c);
      })
      .catch(() => {
        // no cameras.json: the lists just stay empty
      });
    return () => {
      alive = false;
    };
  }, []);
  return cams;
}

export function CameraList({
  title,
  cameras,
  detail,
  emptyText,
}: {
  title: string;
  cameras: CameraInfo[];
  detail?: (c: CameraInfo) => string;
  emptyText: string;
}) {
  const openCamera = useAppStore((s) => s.openCamera);
  const activeCameraId = useAppStore((s) => s.activeCameraId);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? cameras : cameras.slice(0, 4);

  return (
    <div className="raasta-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <CameraIcon className="h-4 w-4 text-[#7cc4ff]" />
        <p className="raasta-section-label flex-1">{title}</p>
        <span className="rounded-md bg-[#7cc4ff]/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#7cc4ff]">
          {cameras.length}
        </span>
      </div>

      {cameras.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <ul className="raasta-scroll max-h-[35dvh] space-y-1 overflow-y-auto overscroll-contain">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openCamera(c.id)}
                aria-pressed={activeCameraId === c.id}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7cc4ff] md:min-h-10 ${
                  activeCameraId === c.id ? 'bg-[#7cc4ff]/10' : ''
                }`}
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors ${
                    activeCameraId === c.id
                      ? 'border-[#7cc4ff] bg-[#7cc4ff] text-[#0b1220]'
                      : 'border-[#7cc4ff]/70 bg-[#0f1729] text-[#f6f2ea]'
                  }`}
                  aria-hidden
                >
                  <CameraIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-100">{c.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{detail ? detail(c) : c.roadName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                  {hasLiveFeed(c) ? 'Live' : 'View'}
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {cameras.length > 4 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 min-h-11 text-[11px] font-medium text-[#7cc4ff] hover:text-[#f6f2ea] md:min-h-10">
          {expanded ? 'Show less' : `Show all ${cameras.length}`}
        </button>
      )}
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Live views will open once the Sindh Government grants Safe City camera access.
      </p>
    </div>
  );
}
