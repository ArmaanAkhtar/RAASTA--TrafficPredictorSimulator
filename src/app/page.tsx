'use client';

import dynamic from 'next/dynamic';
import { useEffect, useSyncExternalStore } from 'react';
import LayoutA from '@/components/layout/LayoutA';
import LayoutB from '@/components/layout/LayoutB';
import { loadRoads } from '@/lib/api';
import { useRoadGraph } from '@/lib/roadGraphStore';
import { useOsmPlaces } from '@/lib/osmPlaces';
import { useAppStore } from '@/store/useAppStore';

const Scene = dynamic(
  () => import('@/components/three/Scene').then((module) => module.Scene),
  { ssr: false },
);

// Which layout to show: ?layout=b -> B, anything else -> A.
// Read from the URL on the client only (server always renders A), so there is no hydration mismatch.
const noopSubscribe = () => () => {};
const readLayoutB = () => new URLSearchParams(window.location.search).get('layout') === 'b';
const serverLayoutB = () => false;

export default function Home() {
  const setRoads = useAppStore((state) => state.setRoads);
  const layoutB = useSyncExternalStore(noopSubscribe, readLayoutB, serverLayoutB);

  useEffect(() => {
    let cancelled = false;
    void loadRoads().then((roads) => {
      if (!cancelled) setRoads(roads);
    });
    // Directed routing graph (one-way carriageways, real junctions, U-turn cuts), loaded in the background
    useRoadGraph.getState().load();
    // Every area, block and famous place (search + map labels)
    useOsmPlaces.getState().load();
    return () => {
      cancelled = true;
    };
  }, [setRoads]);

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-[#0b1220]">
      <Scene />
      {layoutB ? <LayoutB /> : <LayoutA />}
    </main>
  );
}
