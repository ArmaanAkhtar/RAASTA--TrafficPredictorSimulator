'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { loadRoads } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import SearchBar from '@/components/ui/SearchBar';
import TimePicker from '@/components/ui/TimePicker';
import FilterBar from '@/components/ui/FilterBar';
import Legend from '@/components/ui/Legend';
import SidePanel from '@/components/ui/SidePanel';

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
    <main className="relative h-dvh w-screen overflow-hidden bg-[#0b1220]">
      <Scene />

      <div className="pointer-events-none absolute inset-0 z-10">
        <header className="pointer-events-auto absolute left-2 top-2 w-[calc(100%-1rem)] max-w-[320px] md:left-4 md:top-4 md:w-[320px]">
          <div className="rounded-t-2xl rounded-b-none border border-b-0 border-white/10 bg-[#0b1220]/75 px-3 py-2.5 shadow-xl backdrop-blur-md">
            <h1 className="text-lg font-semibold leading-none text-[#ffb547]">Raasta</h1>
          </div>
          <SearchBar />
        </header>

        <div className="pointer-events-auto absolute left-2 top-[92px] w-[calc(100%-1rem)] max-w-[360px] md:left-1/2 md:top-4 md:w-[360px] md:-translate-x-1/2 md:transform">
          <TimePicker />
        </div>

        <div className="pointer-events-auto absolute bottom-3 left-2 flex max-w-[210px] flex-col gap-2 md:bottom-4 md:left-4 md:max-w-none">
          <FilterBar />
          <Legend />
        </div>

        <SidePanel />
      </div>
    </main>
  );
}
