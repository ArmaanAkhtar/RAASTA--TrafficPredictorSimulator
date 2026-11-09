// src/app/playground/page.tsx
// Test page for all UI components, without the 3D scene.
// Roads are drawn on a 2D canvas coloured by predicted rush; the better route is drawn in blue
// and cameras are shown as amber squares.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CameraModal from '../../components/ui/CameraModal';
import DemoButton from '../../components/ui/DemoButton';
import FilterBar from '../../components/ui/FilterBar';
import HintChip from '../../components/ui/HintChip';
import IntroOverlay from '../../components/ui/IntroOverlay';
import Legend from '../../components/ui/Legend';
import SearchBar from '../../components/ui/SearchBar';
import SidePanel from '../../components/ui/SidePanel';
import TimePicker from '../../components/ui/TimePicker';
import { LEVEL_COLOR, predict } from '../../lib/api';
import { loadCameras } from '../../lib/cameras';
import { loadRoads } from '../../lib/roads';
import type { CameraFeed, Road, RoadType, RushLevel } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const BG = '#0b1220';
const ROUTE_BLUE = '#7cc4ff';
const WIDTH: Record<RoadType, number> = { highway: 2.6, arterial: 1.7, local: 1.1 };
const DRAW_ORDER: RoadType[] = ['local', 'arterial', 'highway'];

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function getBounds(roads: Road[]): Bounds | null {
  if (roads.length === 0) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of roads) {
    for (const seg of r.segments) {
      for (const [x, y] of seg) {
        if (x < b.minX) b.minX = x;
        if (y < b.minY) b.minY = y;
        if (x > b.maxX) b.maxX = x;
        if (y > b.maxY) b.maxY = y;
      }
    }
  }
  return b;
}

export default function PlaygroundPage() {
  const roads = useAppStore((s) => s.roads);
  const setRoads = useAppStore((s) => s.setRoads);
  const selectedRoadId = useAppStore((s) => s.selectedRoadId);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);
  const filter = useAppStore((s) => s.filter);
  const altRoute = useAppStore((s) => s.altRoute);
  const showRoute = useAppStore((s) => s.showRoute);
  const openCamera = useAppStore((s) => s.openCamera);

  const [cameras, setCameras] = useState<CameraFeed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load roads into the store once
  useEffect(() => {
    if (roads.length > 0) return;
    let alive = true;
    loadRoads()
      .then((r) => {
        if (alive) setRoads(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [roads.length, setRoads]);

  // Load cameras (for the buttons and the squares on the map)
  useEffect(() => {
    let alive = true;
    loadCameras()
      .then((c) => {
        if (alive) setCameras(c);
      })
      .catch(() => {
        // cameras.json missing: the camera buttons simply do not show
      });
    return () => {
      alive = false;
    };
  }, []);

  // Track canvas size
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => getBounds(roads), [roads]);

  const levels = useMemo(() => {
    const m = new Map<string, RushLevel>();
    for (const r of roads) m.set(r.id, predict(r, selectedTime, rain).nowLevel);
    return m;
  }, [roads, selectedTime, rain]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size.w, size.h);
    if (!bounds) return;

    const pad = 24;
    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;
    const scale = Math.min((size.w - 2 * pad) / bw, (size.h - 2 * pad) / bh);
    const offX = (size.w - bw * scale) / 2;
    const offY = (size.h - bh * scale) / 2;
    const toX = (x: number) => offX + (x - bounds.minX) * scale;
    const toY = (y: number) => offY + (bounds.maxY - y) * scale; // north up

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const drawLine = (pts: Array<[number, number]>, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(toX(x), toY(y));
        else ctx.lineTo(toX(x), toY(y));
      });
      ctx.stroke();
    };
    const drawRoad = (road: Road, color: string, width: number) => {
      for (const seg of road.segments) drawLine(seg, color, width);
    };

    for (const t of DRAW_ORDER) {
      for (const r of roads) {
        if (r.type !== t || r.id === selectedRoadId) continue;
        const level = levels.get(r.id) ?? 'light';
        if (filter[level]) drawRoad(r, LEVEL_COLOR[level], WIDTH[t]);
        else drawRoad(r, '#1e293b', 0.8); // filtered out: faint
      }
    }

    const selected = roads.find((r) => r.id === selectedRoadId);
    if (selected) {
      drawRoad(selected, '#ffffff', WIDTH[selected.type] + 4);
      drawRoad(selected, LEVEL_COLOR[levels.get(selected.id) ?? 'light'], WIDTH[selected.type] + 1.5);
    }

    // Better route
    if (showRoute && altRoute && altRoute.path.length > 1) {
      drawLine(altRoute.path, 'rgba(124,196,255,0.35)', 10);
      drawLine(altRoute.path, ROUTE_BLUE, 4);
      const first = altRoute.path[0];
      const last = altRoute.path[altRoute.path.length - 1];
      for (const [x, y] of [first, last]) {
        ctx.fillStyle = ROUTE_BLUE;
        ctx.beginPath();
        ctx.arc(toX(x), toY(y), 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cameras
    for (const cam of cameras) {
      const x = toX(cam.position[0]);
      const y = toY(cam.position[1]);
      ctx.fillStyle = '#ffb547';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.strokeStyle = BG;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
  }, [roads, bounds, size, levels, filter, selectedRoadId, altRoute, showRoute, cameras]);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#0b1220] text-slate-100">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {/* Top-left controls */}
      <div className="absolute left-4 right-4 top-4 z-20 flex flex-col gap-3 sm:right-auto sm:w-[360px]">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-[#ffb547]">Raasta · UI playground</h1>
          <span className="text-xs text-slate-500">{roads.length} roads</span>
        </div>
        <SearchBar />
        <TimePicker />
        <FilterBar />
        <DemoButton />
      </div>

      {/* Bottom-left: cameras + legend */}
      <div className="absolute bottom-4 left-4 z-10 hidden flex-col gap-3 sm:flex">
        {cameras.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-[#0b1220]/75 p-3 text-xs shadow-xl backdrop-blur-md">
            <p className="mb-2 font-medium uppercase tracking-wide text-slate-400">Cameras</p>
            <div className="flex flex-col gap-1">
              {cameras.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openCamera(c.id)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-slate-200 hover:bg-white/10"
                >
                  <span className="h-2.5 w-2.5 bg-[#ffb547]" />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Legend />
      </div>

      <HintChip />
      <SidePanel />
      <CameraModal />
      <IntroOverlay />

      {error && (
        <div className="absolute inset-x-4 bottom-4 z-40 rounded-lg border border-red-500/40 bg-red-950/90 p-3 text-sm text-red-200 sm:left-auto sm:w-96">
          {error}
        </div>
      )}
    </main>
  );
}
