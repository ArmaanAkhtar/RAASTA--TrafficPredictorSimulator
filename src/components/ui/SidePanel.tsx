// src/components/ui/SidePanel.tsx
// Details for the selected road. Desktop: right panel. Mobile (<768px): collapsible bottom sheet.
// No props: reads/writes the store only.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { findAltRoute, LEVEL_COLOR, levelOf, predict } from '../../lib/api';
import type { RoadType, RouteResult, RushLevel, SelectedTime } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from './TimePicker';
import { CameraList, useCameras } from './CameraList';
import { camerasOnRoad } from '../../lib/cameras';
import { useRoadGraph } from '../../lib/roadGraphStore';

const TYPE_LABEL: Record<RoadType, string> = { highway: 'Highway', arterial: 'Arterial road', local: 'Local road' };
const LEVEL_LABEL: Record<RushLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };
const ROUTE_THRESHOLD = 60; // suggest a better route when jam chance is above this

function addHours(t: SelectedTime, hours: number): SelectedTime {
  let hour = t.hour + hours;
  let day = t.day;
  while (hour >= 24) {
    hour -= 24;
    day = (day + 1) % 7;
  }
  return { day, hour, minute: 0 };
}

function jamColor(jam: number): string {
  if (jam > ROUTE_THRESHOLD) return LEVEL_COLOR.heavy;
  if (jam >= 30) return LEVEL_COLOR.medium;
  return LEVEL_COLOR.light;
}

// ---------------------------------------------------------------------------
// Better route card (M4)
// ---------------------------------------------------------------------------
function BetterRouteCard({ mainJam }: { mainJam: number }) {
  const roads = useAppStore((s) => s.roads);
  const altRoute = useAppStore((s) => s.altRoute);
  const showRoute = useAppStore((s) => s.showRoute);
  const setShowRoute = useAppStore((s) => s.setShowRoute);

  if (mainJam <= ROUTE_THRESHOLD) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm text-slate-400">
        Jam chance is low, no detour needed.
      </div>
    );
  }

  if (!altRoute) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm text-slate-400">
        No better route found nearby. Try leaving a bit later.
      </div>
    );
  }

  const nameOf = new Map(roads.map((r) => [r.id, r.name]));
  const named = altRoute.roadIds
    .map((id) => nameOf.get(id) ?? '')
    .filter((n) => n !== '' && !n.startsWith('Unnamed'));
  const via = (named.length ? named : altRoute.roadIds.map((id) => nameOf.get(id) ?? id)).slice(0, 3);
  const saved = altRoute.minutesSaved;

  return (
    <div className="rounded-xl border border-[#7cc4ff]/30 bg-[#7cc4ff]/10 p-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-5 rounded-full bg-[#7cc4ff]" />
        <p className="text-sm font-semibold text-[#7cc4ff]">Better route</p>
      </div>
      <p className="mt-2 text-sm text-slate-200">via {via.join(' → ')}</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-400">Jam chance</p>
          <p className="text-xl font-bold tabular-nums" style={{ color: jamColor(altRoute.jamChance) }}>
            {altRoute.jamChance}%
          </p>
          <p className="text-xs text-slate-500">vs {mainJam}% on this road</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Time</p>
          <p className="text-xl font-bold tabular-nums text-slate-100">
            {saved > 0 ? `${saved} min` : saved <= -5 ? `+${-saved} min` : `${altRoute.minutes} min`}
          </p>
          <p className="text-xs text-slate-500">
            {saved > 0 ? 'saved' : saved <= -5 ? 'longer, but less jam risk' : 'about the same time'} ·{' '}
            {altRoute.distanceKm} km
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowRoute(!showRoute)}
        className={`mt-3 w-full rounded-lg py-2 text-sm font-semibold transition-colors ${
          showRoute ? 'border border-[#7cc4ff]/40 text-[#7cc4ff] hover:bg-[#7cc4ff]/10' : 'bg-[#7cc4ff] text-[#0b1220] hover:opacity-90'
        }`}
      >
        {showRoute ? 'Hide route' : 'Show route'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------
export default function SidePanel() {
  const roads = useAppStore((s) => s.roads);
  const selectedRoadId = useAppStore((s) => s.selectedRoadId);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);
  const selectRoad = useAppStore((s) => s.selectRoad);
  const setAltRoute = useAppStore((s) => s.setAltRoute);
  const setShowRoute = useAppStore((s) => s.setShowRoute);
  const autoShownFor = useRef<string | null>(null); // road the route was last auto-shown for
  const ownRoute = useRef<RouteResult | null>(null); // the route object this panel put in the store

  const [collapsed, setCollapsed] = useState(false); // mobile only
  const allCameras = useCameras();
  const graphVersion = useRoadGraph((s) => s.version); // re-route when the directed graph arrives

  const road = useMemo(() => roads.find((r) => r.id === selectedRoadId) ?? null, [roads, selectedRoadId]);
  const prediction = useMemo(() => (road ? predict(road, selectedTime, rain) : null), [road, selectedTime, rain]);
  const needsRoute = prediction !== null && prediction.jamChanceNextHour > ROUTE_THRESHOLD;

  // Compute the better route when the jam chance is high; clear it otherwise
  // and draw it in blue straight away the first time a busy road is picked (user can still hide it)
  // Only ever clear a route this panel created (never the Trip planner's route)
  useEffect(() => {
    if (!road) autoShownFor.current = null;
    if (!road || !needsRoute) {
      if (ownRoute.current && useAppStore.getState().altRoute === ownRoute.current) setAltRoute(null);
      ownRoute.current = null;
      return;
    }
    const route = findAltRoute(roads, road.id, selectedTime, rain);
    ownRoute.current = route;
    setAltRoute(route);
    if (route && autoShownFor.current !== road.id) {
      autoShownFor.current = road.id;
      setShowRoute(true);
    }
  }, [road, needsRoute, roads, selectedTime, rain, setAltRoute, setShowRoute, graphVersion]);

  // Next 4 whole hours (can roll over into the next day)
  const chartData = useMemo(() => {
    if (!road) return [];
    return [1, 2, 3, 4].map((i) => {
      const t = addHours(selectedTime, i);
      const score = predict(road, t, rain).nowScore;
      return { label: formatTime(t.hour, 0).replace(':00', ''), score, level: levelOf(score) };
    });
  }, [road, selectedTime, rain]);

  if (!road || !prediction) return null;

  const jam = prediction.jamChanceNextHour;

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0b1220]/85 text-slate-100 shadow-2xl backdrop-blur-md transition-[max-height] duration-300 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[360px] md:rounded-2xl ${
        collapsed ? 'max-h-[76px]' : 'max-h-[75vh]'
      }`}
      aria-label={`Prediction for ${road.name}`}
    >
      {/* Mobile drag handle / collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full justify-center pt-2 md:hidden"
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <span className="h-1 w-10 rounded-full bg-white/25" />
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-2 md:pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{road.name}</h2>
          <p className="text-xs text-slate-400">
            {TYPE_LABEL[road.type]} · {(road.lengthM / 1000).toFixed(1)} km
          </p>
        </div>
        <button
          type="button"
          onClick={() => selectRoad(null)}
          aria-label="Close"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {/* Right now + jam chance */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-slate-400">Right now</p>
            <p className="mt-1 flex items-center gap-2 text-xl font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LEVEL_COLOR[prediction.nowLevel] }} />
              {LEVEL_LABEL[prediction.nowLevel]}
            </p>
            <p className="text-xs text-slate-400">Rush score {prediction.nowScore}/100</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-slate-400">Jam chance next hour</p>
            <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: jamColor(jam) }}>
              {jam}%
            </p>
            <p className="text-xs text-slate-400">
              {rain ? 'Rain included' : `at ${formatTime(selectedTime.hour, selectedTime.minute)}`}
            </p>
          </div>
        </div>

        {/* Next 4 hours chart */}
        <div className="rounded-xl bg-white/5 p-3">
          <p className="mb-2 text-xs text-slate-400">Next 4 hours</p>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 18, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} hide />
                <Bar
                  dataKey="score"
                  radius={[6, 6, 0, 0]}
                  label={{ position: 'top', fill: '#cbd5e1', fontSize: 11 }}
                  isAnimationActive={false}
                >
                  {chartData.map((d) => (
                    <Cell key={d.label} fill={LEVEL_COLOR[d.level]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Better route (M4) */}
        <BetterRouteCard mainJam={jam} />

        {/* Traffic cameras on this road (live view once Sindh Safe City grants access) */}
        <CameraList
          title="Cameras on this road"
          cameras={camerasOnRoad(allCameras, road.id)}
          emptyText="No traffic cameras reported on this road yet."
        />
      </div>
    </aside>
  );
}
