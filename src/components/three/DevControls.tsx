'use client';

import { useAppStore } from '@/store/useAppStore';

export function DevControls() {
  const roads = useAppStore((state) => state.roads);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const selectedTime = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
  const setTime = useAppStore((state) => state.setTime);
  const setRain = useAppStore((state) => state.setRain);
  const selectRoad = useAppStore((state) => state.selectRoad);

  const firstThirty = [...roads].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);

  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2 rounded-lg border border-white/10 bg-[#0b1220]/90 p-3 text-xs text-white shadow-xl backdrop-blur-sm">
      <label className="flex items-center gap-2">
        <span className="w-10">Hour</span>
        <input
          aria-label="Hour"
          type="range"
          min={0}
          max={23}
          value={selectedTime.hour}
          onChange={(event) => setTime({ ...selectedTime, hour: Number(event.target.value), minute: 0 })}
        />
        <span>{selectedTime.hour}:00</span>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-10">Day</span>
        <select
          className="rounded border border-white/15 bg-[#101a2d] px-2 py-1"
          value={selectedTime.day}
          onChange={(event) => setTime({ ...selectedTime, day: Number(event.target.value) })}
        >
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, index) => (
            <option key={name} value={index}>{name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={rain} onChange={(event) => setRain(event.target.checked)} />
        Rain
      </label>
      <label className="flex flex-col gap-1">
        <span>Road</span>
        <select
          className="max-w-56 rounded border border-white/15 bg-[#101a2d] px-2 py-1"
          value={selectedRoadId ?? ''}
          onChange={(event) => selectRoad(event.target.value || null)}
        >
          <option value="">None</option>
          {firstThirty.map((road) => (
            <option key={road.id} value={road.id}>{road.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
