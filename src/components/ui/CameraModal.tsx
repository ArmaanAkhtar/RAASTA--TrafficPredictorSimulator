// src/components/ui/CameraModal.tsx
// Opens when activeCameraId is set. Shows the camera's live view once the Sindh Government (Safe City)
// grants access; until then an "Access not granted" box. Arrows step through the other cameras on the
// same road. Esc closes.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { LEVEL_COLOR, predict } from '../../lib/api';
import { hasLiveFeed, loadCameras, type CameraInfo } from '../../lib/cameras';
import type { RushLevel } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const LEVEL_LABEL: Record<RushLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

export default function CameraModal() {
  const activeCameraId = useAppStore((s) => s.activeCameraId);
  const openCamera = useAppStore((s) => s.openCamera);
  const roads = useAppStore((s) => s.roads);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);

  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [videoErrorFor, setVideoErrorFor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCameras()
      .then((c) => {
        if (alive) setCameras(c);
      })
      .catch(() => {
        // no cameras.json
      });
    return () => {
      alive = false;
    };
  }, []);

  const cam = cameras.find((c) => c.id === activeCameraId) ?? null;
  const siblings = useMemo(() => (cam ? cameras.filter((c) => c.roadId === cam.roadId) : []), [cameras, cam]);
  const index = cam ? siblings.findIndex((c) => c.id === cam.id) : -1;
  const step = (delta: number) => {
    if (siblings.length < 2 || index < 0) return;
    openCamera(siblings[(index + delta + siblings.length) % siblings.length].id);
  };

  // Keyboard: Esc closes, arrows switch camera
  useEffect(() => {
    if (!activeCameraId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openCamera(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!activeCameraId) return null;

  const road = cam ? roads.find((r) => r.id === cam.roadId) ?? null : null;
  const level = road ? predict(road, selectedTime, rain).nowLevel : null;
  const live = cam !== null && hasLiveFeed(cam) && videoErrorFor !== cam.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => openCamera(null)}
      role="dialog"
      aria-modal="true"
      aria-label={cam ? cam.name : 'Camera'}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220] text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{cam ? cam.name : 'Camera'}</h2>
            <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
              {cam?.roadName}
              {level && (
                <>
                  <span>·</span>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LEVEL_COLOR[level] }} />
                  {LEVEL_LABEL[level]} rush predicted
                </>
              )}
            </p>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              live ? 'border-[#30a46c]/50 bg-[#30a46c]/15 text-[#5fd497]' : 'border-white/15 bg-white/5 text-slate-300'
            }`}
          >
            {live ? '● Live' : 'Access pending'}
          </span>
          <button
            type="button"
            onClick={() => openCamera(null)}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* View */}
        <div className="relative aspect-video w-full bg-[#05080f]">
          {live && cam ? (
            <video
              key={cam.id}
              src={cam.videoSrc}
              autoPlay
              muted
              playsInline
              onError={() => setVideoErrorFor(cam.id)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {/* faint scan lines so the box reads as a camera screen */}
              <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_4px)]" />
              <div className="grid h-14 w-14 place-items-center rounded-full border border-[#ffb547]/40 bg-[#ffb547]/10">
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#ffb547]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              </div>
              <p className="text-base font-semibold text-slate-100">Access not granted by Sindh Govt</p>
              <p className="max-w-md text-xs leading-relaxed text-slate-400">
                This is where the live view from this traffic camera will play. Raasta is ready to connect to the
                Karachi Safe City camera network as soon as the Sindh Government grants access, so you can see
                the road live from home before you leave.
              </p>
            </div>
          )}

          {siblings.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous camera on this road"
                className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next camera on this road"
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                ›
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
            {cam?.source ? `Location: ${cam.source} (approximate)` : 'Location approximate'}
          </p>
          {siblings.length > 1 && (
            <p className="shrink-0 text-[11px] tabular-nums text-slate-400">
              Camera {index + 1} of {siblings.length} on this road
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
