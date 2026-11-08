// src/app/playground/page.tsx
// Test page: draws the real Karachi roads on a 2D canvas (no 3D needed).
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadRoads } from '../../lib/roads';
import type { Road, RoadType } from '../../lib/types';

const TYPE_STYLE: Record<RoadType, { color: string; width: number; label: string }> = {
  highway: { color: '#ffb547', width: 2.5, label: 'Highway' },
  arterial: { color: '#7cc4ff', width: 1.6, label: 'Arterial' },
  local: { color: '#5b6b84', width: 1, label: 'Local' },
};
const DRAW_ORDER: RoadType[] = ['local', 'arterial', 'highway'];
const SELECTED_COLOR = '#e5484d';
const BG = '#0b1220';

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
  const [roads, setRoads] = useState<Road[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load roads once
  useEffect(() => {
    let alive = true;
    loadRoads()
      .then((r) => {
        if (alive) setRoads(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Track canvas container size
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
  const sorted = useMemo(() => [...roads].sort((a, b) => b.lengthM - a.lengthM), [roads]);
  const totalKm = useMemo(() => roads.reduce((s, r) => s + r.lengthM, 0) / 1000, [roads]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((r) => r.name.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);

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

    const pad = 20;
    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;
    const scale = Math.min((size.w - 2 * pad) / bw, (size.h - 2 * pad) / bh);
    const offX = (size.w - bw * scale) / 2;
    const offY = (size.h - bh * scale) / 2;
    const toX = (x: number) => offX + (x - bounds.minX) * scale;
    const toY = (y: number) => offY + (bounds.maxY - y) * scale; // north up

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const drawRoad = (road: Road, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const seg of road.segments) {
        ctx.beginPath();
        seg.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(toX(x), toY(y));
          else ctx.lineTo(toX(x), toY(y));
        });
        ctx.stroke();
      }
    };

    for (const t of DRAW_ORDER) {
      for (const r of roads) {
        if (r.type === t && r.id !== selectedId) drawRoad(r, TYPE_STYLE[t].color, TYPE_STYLE[t].width);
      }
    }

    const selected = roads.find((r) => r.id === selectedId);
    if (selected) {
      drawRoad(selected, SELECTED_COLOR, 4);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(toX(selected.center[0]), toY(selected.center[1]), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [roads, bounds, size, selectedId]);

  const selectedRoad = roads.find((r) => r.id === selectedId) ?? null;

  return (
    <main className="flex min-h-screen flex-col bg-[#0b1220] text-slate-100 md:h-screen md:flex-row">
      <div ref={wrapRef} className="relative h-[60vh] flex-1 md:h-auto">
        <canvas ref={canvasRef} className="block h-full w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Loading roads...
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/40 bg-red-950/80 p-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <div className="absolute bottom-3 left-3 flex gap-3 rounded-lg bg-black/40 px-3 py-2 text-xs backdrop-blur">
          {DRAW_ORDER.slice()
            .reverse()
            .map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-4 rounded" style={{ backgroundColor: TYPE_STYLE[t].color }} />
                {TYPE_STYLE[t].label}
              </span>
            ))}
        </div>
      </div>

      <aside className="flex w-full flex-col border-t border-white/10 md:w-80 md:border-l md:border-t-0">
        <div className="space-y-1 border-b border-white/10 p-4">
          <h1 className="text-lg font-semibold text-[#ffb547]">Roads playground</h1>
          <p className="text-sm text-slate-300">
            {roads.length} roads · {totalKm.toFixed(1)} km
          </p>
          {selectedRoad && (
            <p className="text-sm text-slate-300">
              Selected: <span className="text-[#e5484d]">{selectedRoad.name}</span> ·{' '}
              {(selectedRoad.lengthM / 1000).toFixed(1)} km · {selectedRoad.segments.length} segments
            </p>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name..."
            className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#ffb547]"
          />
        </div>
        <ul className="max-h-[40vh] flex-1 overflow-y-auto md:max-h-none">
          {filtered.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId((cur) => (cur === r.id ? null : r.id))}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-white/5 ${
                  r.id === selectedId ? 'bg-white/10' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TYPE_STYLE[r.type].color }}
                  />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{(r.lengthM / 1000).toFixed(1)} km</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
