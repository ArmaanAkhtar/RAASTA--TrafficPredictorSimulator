// src/components/ui/SidePanel.tsx
// Details for the selected road. Desktop: right panel. Mobile (<768px): collapsible bottom sheet.
// No props: reads/writes the store only.
'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { LEVEL_COLOR, levelOf, predict } from '../../lib/api';
import type { RoadType, RushLevel, SelectedTime } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from './TimePicker';

const TYPE_LABEL: Record<RoadType, string> = { highway: 'Highway', arterial: 'Arterial road', local: 'Local road' };
const LEVEL_LABEL: Record<RushLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

function addHours(t: SelectedTime, hours: number): SelectedTime {
  let hour = t.hour + hours;
  let day = t.day;
  while (hour >= 24) {
    hour -= 24;
    day = (day + 1) % 7;
  }
  return { day, hour, minute: 0 };
}

export default function SidePanel() {
  const roads = useAppStore((s) => s.roads);
  const selectedRoadId = useAppStore((s) => s.selectedRoadId);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);
  const selectRoad = useAppStore((s) => s.selectRoad);

  const [collapsed, setCollapsed] = useState(false); // mobile only

  const road = useMemo(() => roads.find((r) => r.id === selectedRoadId) ?? null, [roads, selectedRoadId]);
  const prediction = useMemo(() => (road ? predict(road, selectedTime, rain) : null), [road, selectedTime, rain]);

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
  const jamColor = jam > 60 ? LEVEL_COLOR.heavy : jam >= 30 ? LEVEL_COLOR.medium : LEVEL_COLOR.light;

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
            <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: jamColor }}>
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

        {/* ================================================================
            M4 SLOT: "Better route" card goes here.
            Show it when prediction.jamChanceNextHour > 60:
            findAltRoute -> setAltRoute -> route names, jam %, minutes saved,
            and a "Show route" button (setShowRoute(true)).
           ================================================================ */}
      </div>
    </aside>
  );
}
