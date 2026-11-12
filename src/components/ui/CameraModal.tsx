'use client';

import { useEffect, useRef, useState } from 'react';
import { loadCameras, type CameraInfo } from '@/lib/cameras';
import { useAppStore } from '@/store/useAppStore';
import { RestrictedCameraScreen } from './RestrictedCameraScreen';

const RESTRICTED_FEED_MESSAGE =
  "Karachi's traffic cameras are not publicly accessible yet. Raasta is ready to plug in official live feeds the moment the city opens them, like London (TfL) and California (Caltrans) already do. Until then, Raasta's prediction shows you what this road will look like.";

export default function CameraModal() {
  const activeCameraId = useAppStore((state) => state.activeCameraId);
  const openCamera = useAppStore((state) => state.openCamera);
  const selectRoad = useAppStore((state) => state.selectRoad);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const camera = cameras.find((item) => item.id === activeCameraId) ?? null;

  useEffect(() => {
    let active = true;
    loadCameras()
      .then((items) => {
        if (active) setCameras(items);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Camera information could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeCameraId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        openCamera(null);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const index = cameras.findIndex((item) => item.id === activeCameraId);
        if (index < 0 || cameras.length < 2) return;
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (index + direction + cameras.length) % cameras.length;
        openCamera(cameras[nextIndex].id);
      }
    };
    const handleFullscreenChange = () => setFullscreen(document.fullscreenElement === overlayRef.current);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [activeCameraId, cameras, openCamera]);

  useEffect(() => {
    setFullscreen(document.fullscreenElement === overlayRef.current);
  }, [activeCameraId]);

  if (!activeCameraId) return null;

  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    openCamera(null);
  };

  const toggleFullscreen = async () => {
    setFullscreenMessage(null);
    const overlay = overlayRef.current;
    if (!overlay) return;
    try {
      if (document.fullscreenElement === overlay) {
        await document.exitFullscreen();
      } else if (document.fullscreenEnabled && typeof overlay.requestFullscreen === 'function') {
        await overlay.requestFullscreen();
      } else {
        setFullscreenMessage("Full screen isn't available here. The camera view remains open in this window.");
      }
    } catch {
      setFullscreenMessage("Full screen couldn't be started. The camera view remains open in this window.");
    }
  };

  const showPrediction = () => {
    if (!camera) return;
    close();
    selectRoad(camera.roadId);
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-modal-title"
      className="fixed inset-0 z-[100] bg-[#0b1220] text-[#f6f2ea]"
    >
      <div className="flex h-[100dvh] flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-6">
        <header className="flex shrink-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="camera-modal-title" className="truncate text-lg font-semibold sm:text-xl">
              {camera?.name ?? (loadError ? 'Camera unavailable' : 'Traffic camera')}
            </h2>
            <p className="mt-1 truncate text-sm text-[#8f9bb8]">
              {camera?.roadName || (camera ? 'Karachi' : loadError ? 'Camera details are unavailable.' : 'Loading camera details…')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="hidden shrink-0 rounded-lg border border-[#1f2a44] px-3 py-2 text-xs font-medium text-[#f6f2ea] transition-colors hover:border-[#7cc4ff] hover:text-[#7cc4ff] sm:inline-flex"
          >
            {fullscreen ? 'Exit full screen' : 'Enter full screen'}
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close camera view"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#1f2a44] text-[#f6f2ea] transition-colors hover:border-[#7cc4ff] hover:text-[#7cc4ff]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-[35vh] flex-1 flex-col overflow-hidden rounded-xl border border-[#1f2a44]">
          <RestrictedCameraScreen className="min-h-[35vh] flex-1" />
        </div>

        {camera && (
          <p className="shrink-0 text-xs tabular-nums text-[#8f9bb8]">
            Map coordinates (m): {camera.position[0].toFixed(1)}, {camera.position[1].toFixed(1)}
          </p>
        )}

        <section className="raasta-card shrink-0 p-4 sm:p-5" aria-labelledby="restricted-feed-title">
          <h3 id="restricted-feed-title" className="text-sm font-semibold text-[#f6f2ea]">
            Live feed restricted
          </h3>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[#8f9bb8]">
            {RESTRICTED_FEED_MESSAGE}
          </p>
          {loadError && <p className="mt-2 text-xs text-[#8f9bb8]">{loadError}</p>}
          {fullscreenMessage && <p className="mt-2 text-xs text-[#8f9bb8]">{fullscreenMessage}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={showPrediction}
              disabled={!camera}
              className="rounded-lg bg-[#7cc4ff] px-4 py-2.5 text-sm font-semibold text-[#0b1220] transition-colors hover:bg-[#a4d8ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              See prediction for this road
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="rounded-lg border border-[#1f2a44] px-4 py-2.5 text-sm font-medium text-[#f6f2ea] transition-colors hover:border-[#7cc4ff] hover:text-[#7cc4ff] sm:hidden"
            >
              {fullscreen ? 'Exit full screen' : 'Enter full screen'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
