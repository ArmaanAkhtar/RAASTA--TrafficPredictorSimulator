'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

const FADE_MS = 400;

export default function IntroOverlay() {
  const roadsReady = useAppStore((state) => state.roads.length > 0);
  const sceneReady = useAppStore((state) => state.sceneReady);
  const roadLoadError = useAppStore((state) => state.roadLoadError);
  const [shown, setShown] = useState(true);
  const [closing, setClosing] = useState(false);
  const timeout = useRef<number | null>(null);
  const ready = roadsReady && sceneReady;

  const explore = useCallback(() => {
    if (!ready || closing) return;
    setClosing(true);
    timeout.current = window.setTimeout(() => {
      setShown(false);
      window.dispatchEvent(new Event('raasta-intro-complete'));
    }, FADE_MS);
  }, [closing, ready]);

  useEffect(() => () => {
    if (timeout.current !== null) window.clearTimeout(timeout.current);
  }, []);

  useEffect(() => {
    if (!ready || closing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) return;
      event.preventDefault();
      explore();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closing, explore, ready]);

  if (!shown) return null;

  return (
    <div
      className={`raasta-intro fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-[#0b1220] px-5 text-center transition-opacity duration-[400ms] ${
        closing ? 'opacity-0' : 'opacity-100'
      }`}
      aria-label="Raasta introduction"
    >
      <div className="raasta-intro-roads" aria-hidden="true" />
      <div className="raasta-intro-glow" aria-hidden="true" />
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center">
        <Image
          src="/raasta_logo_header.svg"
          width={272}
          height={64}
          alt="Raasta"
          priority
          className="h-11 w-auto md:h-16"
        />
        <p className="mt-5 text-sm tracking-[0.12em] text-[#f6f2ea]/80">
          Know the rush before you leave
        </p>
        <p className="mt-2 text-[13px] text-[#8f9bb8]">
          Karachi&apos;s 3D traffic prediction
        </p>

        {ready ? (
          <button
            type="button"
            autoFocus
            onClick={explore}
            className="mt-9 flex h-[52px] min-w-[220px] items-center justify-center gap-3 rounded-[14px] bg-[#7cc4ff] px-6 text-sm font-semibold text-[#0b1220] shadow-[0_0_24px_rgba(124,196,255,0.12)] transition-[box-shadow,background-color,transform] hover:bg-[#a4d8ff] hover:shadow-[0_0_32px_rgba(124,196,255,0.28)] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7cc4ff]"
          >
            Explore the rush
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </button>
        ) : roadLoadError ? (
          <div className="mt-9 max-w-sm text-sm text-[#e5484d]" role="alert">
            <p>Karachi map data could not be loaded. Refresh the page to try again.</p>
            <p className="mt-2 text-xs text-[#8f9bb8]">{roadLoadError}</p>
          </div>
        ) : (
          <div className="mt-9 flex w-56 flex-col items-center gap-3" role="status" aria-live="polite">
            <div className="h-px w-full overflow-hidden bg-[#1f2a44]">
              <div className="raasta-intro-progress h-full w-2/5 bg-[#7cc4ff]" />
            </div>
            <span className="text-xs tracking-[0.08em] text-[#8f9bb8]">Loading Karachi...</span>
          </div>
        )}
      </div>
    </div>
  );
}
