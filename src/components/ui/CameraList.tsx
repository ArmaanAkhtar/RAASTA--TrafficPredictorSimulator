// src/components/ui/CameraList.tsx
// Shared list of cameras used inside the road, place and trip panels.
// Click a camera to open its view (CameraModal). Not mounted on its own.
'use client';

import { useEffect, useState } from 'react';
import { hasLiveFeed, loadCameras, type CameraInfo } from '../../lib/cameras';
import { useAppStore } from '../../store/useAppStore';

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
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? cameras : cameras.slice(0, 4);

  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#ffb547]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3z" />
          <path d="m16 11 5-3v8l-5-3" />
        </svg>
        <p className="flex-1 text-xs font-semibold text-slate-200">{title}</p>
        <span className="rounded-full bg-[#ffb547]/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#ffb547]">
          {cameras.length}
        </span>
      </div>

      {cameras.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openCamera(c.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb547]"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${hasLiveFeed(c) ? 'bg-[#30a46c]' : 'bg-slate-500'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-100">{c.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{detail ? detail(c) : c.roadName}</span>
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{hasLiveFeed(c) ? 'Live' : 'View'} ›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {cameras.length > 4 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[11px] font-medium text-[#9cc9ff] hover:text-white">
          {expanded ? 'Show less' : `Show all ${cameras.length}`}
        </button>
      )}
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Live views will open once the Sindh Government grants Safe City camera access.
      </p>
    </div>
  );
}
