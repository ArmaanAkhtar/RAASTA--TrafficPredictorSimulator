'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { loadRoads } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';

const Scene = dynamic(
  () => import('@/components/three/Scene').then((module) => module.Scene),
  { ssr: false },
);

export default function Home() {
  const setRoads = useAppStore((state) => state.setRoads);

  useEffect(() => {
    let cancelled = false;

    void loadRoads().then((roads) => {
      if (!cancelled) setRoads(roads);
    });

    return () => {
      cancelled = true;
    };
  }, [setRoads]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b1220]">
      <Scene />
      <header className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-white/10 bg-[#0b1220]/85 px-4 py-3 shadow-lg backdrop-blur-sm">
        <h1 className="text-lg font-semibold text-[#ffb547]">Raasta</h1>
      </header>
    </main>
  );
}
