// src/components/ui/TimePicker.tsx
// Day chips, 15-minute time slider, "Now" button and rain toggle. No props.
'use client';

import { useSyncExternalStore } from 'react';
import { useAppStore } from '../../store/useAppStore';

// true in the browser, false during server render. The store's starting time comes from
// the clock, so server and browser can differ by a few minutes; render the picker only
// in the browser to avoid a hydration mismatch.
const noopSubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GLASS = 'rounded-2xl border border-white/10 bg-[#0b1220]/75 shadow-xl backdrop-blur-md';

export function formatTime(hour: number, minute: number): string {
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

export default function TimePicker() {
  const selectedTime = useAppStore((s) => s.selectedTime);
  const rain = useAppStore((s) => s.rain);
  const setTime = useAppStore((s) => s.setTime);
  const setRain = useAppStore((s) => s.setRain);
  const isClient = useIsClient();

  if (!isClient) {
    // Same size placeholder so the layout does not jump
    return <div className={`${GLASS} h-[178px]`} aria-hidden />;
  }

  const sliderValue = selectedTime.hour * 4 + Math.floor(selectedTime.minute / 15);

  const setNow = () => {
    const d = new Date();
    setTime({ day: d.getDay(), hour: d.getHours(), minute: Math.floor(d.getMinutes() / 15) * 15 });
  };

  return (
    <div className={`${GLASS} space-y-3 p-3`}>
      {/* Day chips */}
      <div className="flex gap-1">
        {DAYS.map((label, i) => {
          const on = selectedTime.day === i;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => setTime({ ...selectedTime, day: i })}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                on ? 'bg-[#ffb547] text-[#0b1220]' : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Time slider */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-400">Leaving at</span>
          <span className="text-lg font-semibold tabular-nums text-slate-100">
            {formatTime(selectedTime.hour, selectedTime.minute)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={95}
          step={1}
          value={sliderValue}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTime({ ...selectedTime, hour: Math.floor(v / 4), minute: (v % 4) * 15 });
          }}
          aria-label="Time of day"
          className="w-full accent-[#ffb547]"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>11:45 PM</span>
        </div>
      </div>

      {/* Now + rain */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={setNow}
          className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-sm text-slate-200 hover:bg-white/10"
        >
          Now
        </button>
        <button
          type="button"
          aria-pressed={rain}
          onClick={() => setRain(!rain)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 text-sm transition-colors ${
            rain
              ? 'border-[#7cc4ff]/60 bg-[#7cc4ff]/20 text-[#7cc4ff]'
              : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 0 7H7Z" />
            <path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" />
          </svg>
          Rain {rain ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}
