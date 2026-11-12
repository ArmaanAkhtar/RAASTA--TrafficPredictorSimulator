'use client';

import { useEffect, useState } from 'react';

function currentTime(): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

export function RestrictedCameraScreen({ className = '' }: { className?: string }) {
  const [time, setTime] = useState(currentTime);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(currentTime()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`camera-feed-screen relative isolate overflow-hidden bg-[#050912] text-[#f6f2ea] ${className}`}>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2 text-[10px] font-medium tracking-[0.12em] text-[#8f9bb8]">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e5484d]" />
          LIVE
        </span>
        <time className="tabular-nums tracking-normal">{time}</time>
      </div>
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-2 pt-5">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#8f9bb8]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        <span className="text-xs font-medium text-[#f6f2ea]">Access restricted</span>
      </div>
    </div>
  );
}
