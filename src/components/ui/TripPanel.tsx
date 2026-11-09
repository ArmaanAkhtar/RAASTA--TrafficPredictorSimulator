// src/components/ui/TripPanel.tsx
// Right-hand panel for a planned trip (From -> To): the trip now, the next 2 hours in 15-minute
// departure slots, and advice on when to leave to avoid traffic. Desktop: right panel. Mobile: bottom sheet.
// No props: reads the app store and the trip store.
'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { LEVEL_COLOR } from '../../lib/api';
import { planDeparture, type DepartureSlot } from '../../lib/departure';
import { useLocationStore } from '../../lib/location';
import type { Place } from '../../lib/places';
import type { TripMode } from '../../lib/routing';
import { MY_LOCATION_ID, tripKey, useTripStore } from '../../lib/trip';
import { formatWalk, VEHICLES } from './TripPlanner';
import type { Pt } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from './TimePicker';
import { CameraList, useCameras } from './CameraList';
import { camerasAlongRoute } from '../../lib/cameras';
import { useRoadGraph } from '../../lib/roadGraphStore';
import { useSettledValue } from '../three/usePerformance';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODE_LABEL: Record<TripMode, string> = { time: '⏱ Time save', petrol: '⛽ Petrol save' };

const pointOf = (p: Place | null, user: Pt | null): Pt | null => (p ? (p.id === MY_LOCATION_ID ? user : p.point) : null);

function jamColour(jam: number): string {
  if (jam > 60) return LEVEL_COLOR.heavy;
  if (jam >= 30) return LEVEL_COLOR.medium;
  return LEVEL_COLOR.light;
}

function slotColour(s: DepartureSlot): string {
  if (!s.trip) return '#334155';
  if (s.trafficFree) return LEVEL_COLOR.light;
  return s.trip.jamChance > 60 ? LEVEL_COLOR.heavy : LEVEL_COLOR.medium;
}

function inText(minutes: number): string {
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h} h${m ? ` ${m} min` : ''}`;
}

export default function TripPanel() {
  const roads = useAppStore((s) => s.roads);
  const selectedRoadId = useAppStore((s) => s.selectedRoadId);
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);
  const setTime = useAppStore((s) => s.setTime);

  const from = useTripStore((s) => s.from);
  const to = useTripStore((s) => s.to);
  const mode = useTripStore((s) => s.mode);
  const vehicle = useTripStore((s) => s.vehicle);
  const key = useTripStore(tripKey);
  const active = useTripStore((s) => s.active);
  const results = useTripStore((s) => s.results);
  const setMode = useTripStore((s) => s.setMode);
  const setActive = useTripStore((s) => s.setActive);
  const userPoint = useLocationStore((s) => s.point);

  const [collapsed, setCollapsed] = useState(false); // mobile only
  const allCameras = useCameras();

  const fromPoint = pointOf(from, userPoint);
  const toPoint = pointOf(to, userPoint);
  const current = results ? results[key] : null;
  const walking = vehicle === 'walk';
  const visible = active && selectedRoadId === null && current !== null && !!from && !!to;

  // 9 departures: now, +15 ... +120 min (waits until the time slider stops, so dragging stays smooth)
  const settledTime = useSettledValue(selectedTime, 250);
  const graphVersion = useRoadGraph((s) => s.version);
  const plan = useMemo(() => {
    if (!visible || !fromPoint || !toPoint) return null;
    return planDeparture(roads, fromPoint, toPoint, settledTime, rain, mode, vehicle);
    // graphVersion: re-plan when the directed graph arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, roads, fromPoint, toPoint, settledTime, rain, mode, vehicle, graphVersion]);

  const nameOf = useMemo(() => new Map(roads.map((r) => [r.id, r.name])), [roads]);
  const routeCameras = useMemo(
    () => (current ? camerasAlongRoute(allCameras, current.path) : []),
    [allCameras, current],
  );

  if (!visible || !plan || !current || !from || !to) return null;

  const { slots, advice } = plan;
  const other: TripMode = mode === 'time' ? 'petrol' : 'time';
  const otherTrip = results ? results[other] : null;
  const via = current.roadIds
    .map((id) => nameOf.get(id) ?? '')
    .filter((n) => n !== '' && !n.startsWith('Unnamed'))
    .slice(0, 3);
  const chart = slots.map((s) => ({
    label: formatTime(s.time.hour, s.time.minute).replace(' AM', 'a').replace(' PM', 'p'),
    minutes: s.trip?.minutes ?? 0,
    slot: s,
  }));
  const recommendedOffset = advice.kind === 'wait' || advice.kind === 'better-later' ? advice.slot.offsetMin : advice.kind === 'clear-now' ? 0 : -1;
  const leaveAt = (s: DepartureSlot) => `${s.time.day !== selectedTime.day ? `${DAYS[s.time.day]} ` : ''}${formatTime(s.time.hour, s.time.minute)}`;

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0b1220]/85 text-slate-100 shadow-2xl backdrop-blur-md transition-[max-height] duration-300 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[360px] md:rounded-2xl ${
        collapsed ? 'max-h-[76px]' : 'max-h-[75vh]'
      }`}
      aria-label={`Trip from ${from.name} to ${to.name}`}
    >
      {/* Mobile drag handle */}
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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7cc4ff]">Your trip · {VEHICLES.find((v) => v.vehicle === vehicle)?.icon} {walking ? 'Paidal' : MODE_LABEL[mode]}
          </p>
          <h2 className="truncate text-base font-semibold">
            {from.name} → {to.name}
          </h2>
          <p className="text-xs text-slate-400">
            Leaving {DAYS[selectedTime.day]} {formatTime(selectedTime.hour, selectedTime.minute)}
            {rain ? ' · rain' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActive(false)}
          aria-label="Close trip"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {/* Now */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/5 p-2.5">
            <p className="text-[11px] text-slate-400">Time</p>
            <p className="text-lg font-bold tabular-nums">{walking ? formatWalk(current.minutes) : `${current.minutes} min`}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-2.5">
            <p className="text-[11px] text-slate-400">Distance</p>
            <p className="text-lg font-bold tabular-nums">{current.distanceKm} km</p>
            <p className="text-[11px] tabular-nums text-slate-500">
              {walking ? 'no petrol' : `${current.fuelLitres.toFixed(1)} L petrol`}
            </p>
          </div>
          {walking ? (
            <div className="rounded-xl bg-white/5 p-2.5">
              <p className="text-[11px] text-slate-400">Steps</p>
              <p className="text-lg font-bold tabular-nums">~{Math.round(current.distanceKm * 1.3)}k</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white/5 p-2.5">
              <p className="text-[11px] text-slate-400">Jam chance</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: jamColour(current.jamChance) }}>
                {current.jamChance}%
              </p>
            </div>
          )}
        </div>
        {via.length > 0 && <p className="text-xs text-slate-300">via {via.join(' → ')}</p>}

        {/* Advice */}
        {advice.kind === 'clear-now' && (
          <div className="rounded-xl border border-[#30a46c]/40 bg-[#30a46c]/10 p-3">
            <p className="text-sm font-semibold text-[#5fd497]">The route is clear now</p>
            <p className="mt-1 text-xs text-slate-300">Light traffic expected. Good time to leave.</p>
          </div>
        )}

        {(advice.kind === 'wait' || advice.kind === 'better-later') && advice.slot.trip && (
          <div
            className={`rounded-xl border p-3 ${
              advice.kind === 'wait' ? 'border-[#30a46c]/40 bg-[#30a46c]/10' : 'border-[#f5a524]/40 bg-[#f5a524]/10'
            }`}
          >
            <p className={`text-sm font-semibold ${advice.kind === 'wait' ? 'text-[#5fd497]' : 'text-[#f5c063]'}`}>
              {advice.kind === 'wait'
                ? `Traffic-free at ${leaveAt(advice.slot)} (${inText(advice.slot.offsetMin)})`
                : `Traffic eases at ${leaveAt(advice.slot)} (${inText(advice.slot.offsetMin)})`}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              If you want to go without the traffic, leave at {leaveAt(advice.slot)}: about{' '}
              <span className="font-semibold text-slate-100">{advice.slot.trip.minutes} min</span>
              {advice.savesMin > 0 ? ` instead of ${current.minutes} (saves ${advice.savesMin} min)` : ''}
              {advice.kind === 'better-later' ? '. It will still be a bit busy.' : '.'}
            </p>
            <button
              type="button"
              onClick={() => setTime(advice.slot.time)}
              className="mt-2 w-full rounded-lg bg-[#7cc4ff] py-1.5 text-xs font-semibold text-[#0b1220] hover:opacity-90"
            >
              Plan for {leaveAt(advice.slot)}
            </button>
          </div>
        )}

        {advice.kind === 'walk' && (
          <div className="rounded-xl border border-[#7cc4ff]/40 bg-[#7cc4ff]/10 p-3">
            <p className="text-sm font-semibold text-[#9cc9ff]">Walking: traffic will not slow you down</p>
            <p className="mt-1 text-xs text-slate-300">
              About {formatWalk(current.minutes)} at a normal pace. The route stays off expressways and may use either side of
              one-way roads.
              {current.distanceKm > 3 ? ' It is a long walk, a bike or rickshaw may be easier.' : ''}
            </p>
          </div>
        )}

        {advice.kind === 'steady' && (
          <div className="rounded-xl border border-[#f5a524]/40 bg-[#f5a524]/10 p-3">
            <p className="text-sm font-semibold text-[#f5c063]">
              {advice.worsens ? 'Leave now: it gets busier later' : 'Busy but moving for the next 2 hours'}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {advice.worsens
                ? 'Traffic on this route builds up over the next 2 hours, so the sooner you go, the quicker the trip.'
                : 'Traffic stays about the same, so waiting will not save time. Leave whenever you are ready.'}
            </p>
          </div>
        )}

        {advice.kind === 'jammed' && (
          <div className="rounded-xl border border-[#e5484d]/40 bg-[#e5484d]/10 p-3">
            <p className="text-sm font-semibold text-[#ff8a8d]">This route stays jammed for the next 2 hours</p>
            <p className="mt-1 text-xs text-slate-300">
              Leaving later will not help much. Pick what matters more to you:
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['time', 'petrol'] as const).map((m) => {
                const tr = results ? results[m] : null;
                const on = m === mode;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-lg border p-2 text-left ${on ? 'border-[#7cc4ff]/60 bg-[#7cc4ff]/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <p className="text-[11px] text-slate-400">{MODE_LABEL[m]}</p>
                    {tr ? (
                      <>
                        <p className="text-sm font-bold tabular-nums">{tr.minutes} min</p>
                        <p className="text-[11px] tabular-nums text-slate-400">
                          {tr.distanceKm} km · {tr.fuelLitres.toFixed(1)} L
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-500">No route</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Next 2 hours (not for walking: traffic does not change a walk) */}
        {!walking && (
        <div className="rounded-xl bg-white/5 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-xs text-slate-400">If you leave at… (next 2 hours)</p>
            <p className="text-[10px] text-slate-500">minutes</p>
          </div>
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 16, right: 2, bottom: 0, left: 2 }}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} interval={1} />
                <YAxis hide domain={[0, 'dataMax']} />
                <Bar dataKey="minutes" radius={[4, 4, 0, 0]} label={{ position: 'top', fill: '#cbd5e1', fontSize: 9 }} isAnimationActive={false}>
                  {chart.map((d) => (
                    <Cell
                      key={d.label}
                      fill={slotColour(d.slot)}
                      stroke={d.slot.offsetMin === recommendedOffset ? '#ffffff' : 'none'}
                      strokeWidth={2}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Green = traffic-free · amber = busy · red = jam likely · white outline = suggested time
          </p>
        </div>
        )}

        {/* Cameras along the way, in driving order */}
        <CameraList
          title="Cameras on your route"
          cameras={routeCameras}
          detail={(c) => {
            const along = routeCameras.find((r) => r.id === c.id)?.alongKm ?? 0;
            return `${c.roadName} · ${along} km into the trip`;
          }}
          emptyText="No traffic cameras reported along this route yet."
        />

        {otherTrip && !walking && advice.kind !== 'jammed' && (
          <button
            type="button"
            onClick={() => setMode(other)}
            className="w-full rounded-xl border border-white/10 bg-white/5 p-2.5 text-left text-xs text-slate-300 hover:bg-white/10"
          >
            {MODE_LABEL[other]} instead: {otherTrip.minutes} min · {otherTrip.distanceKm} km · {otherTrip.fuelLitres.toFixed(1)} L
          </button>
        )}
        <p className="text-[10px] text-slate-500">Predictions come from typical Karachi traffic patterns, not live data.</p>
      </div>
    </aside>
  );
}
