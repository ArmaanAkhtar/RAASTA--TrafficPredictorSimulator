// src/components/ui/CameraModal.tsx
// Opens when activeCameraId is set. Plays a sample clip (never labelled LIVE). Esc closes.
'use client';

import { useEffect, useState } from 'react';
import { LEVEL_COLOR, predict } from '../../lib/api';
import { loadCameras } from '../../lib/cameras';
import type { CameraFeed, RushLevel } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const LEVEL_LABEL: Record<RushLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

export default function CameraModal() {
  const activeCameraId = useAppStore((s) => s.activeCameraId);
  const openCamera = useAppStore((s) => s.openCamera);
  const roads = useAppStore((s) => s.roads);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);

  const [cameras, setCameras] = useState<CameraFeed[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [videoErrorFor, setVideoErrorFor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCameras()
      .then((c) => {
        if (alive) setCameras(c);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Esc closes
  useEffect(() => {
    if (!activeCameraId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openCamera(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeCameraId, openCamera]);

  if (!activeCameraId) return null;

  const cam = cameras.find((c) => c.id === activeCameraId) ?? null;
  const road = cam ? roads.find((r) => r.id === cam.roadId) ?? null : null;
  const level = road ? predict(road, selectedTime, rain).nowLevel : null;
  const videoFailed = videoErrorFor === activeCameraId;

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
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{cam ? cam.name : 'Camera'}</h2>
            {road && (
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                {road.name}
                {level && (
                  <>
                    <span>·</span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LEVEL_COLOR[level] }} />
                    {LEVEL_LABEL[level]} rush predicted
                  </>
                )}
              </p>
            )}
          </div>
          <span className="rounded-full border border-[#ffb547]/40 bg-[#ffb547]/15 px-2.5 py-1 text-xs font-medium text-[#ffb547]">
            Sample feed
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

        <div className="relative aspect-video w-full bg-black">
          {cam && !videoFailed && (
            <video
              key={cam.id}
              src={cam.videoSrc}
              autoPlay
              muted
              loop
              playsInline
              onError={() => setVideoErrorFor(cam.id)}
              className="h-full w-full object-cover"
            />
          )}
          {(!cam || videoFailed) && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-400">
              {loadError ?? (!cam ? 'Loading camera...' : 'Clip not added yet. Put it in public/videos/.')}
            </div>
          )}
        </div>

        <p className="px-4 py-2 text-xs text-slate-500">
          Recorded sample clip for the prototype, not a live stream. Press Esc to close.
        </p>
      </div>
    </div>
  );
}
