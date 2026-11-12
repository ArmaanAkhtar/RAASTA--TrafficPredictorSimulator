// src/components/ui/TimePicker.tsx
// Day chips, 15-minute time slider and "Now" button. No props.
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
const GLASS = 'raasta-panel';

export function formatTime(hour: number, minute: number): string {
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

export default function TimePicker({ mobileEmbedded = false }: { mobileEmbedded?: boolean } = {}) {
  const selectedTime = useAppStore((s) => s.selectedTime);
  const setTime = useAppStore((s) => s.setTime);
  const isClient = useIsClient();

  if (!isClient) {
    // Same size placeholder so the layout does not jump
    return <div className={`${mobileEmbedded ? '' : `${GLASS} `}h-[178px]`} aria-hidden />;
  }

  const sliderValue = selectedTime.hour * 4 + Math.floor(selectedTime.minute / 15);

  const setNow = () => {
    const d = new Date();
    setTime({ day: d.getDay(), hour: d.getHours(), minute: Math.floor(d.getMinutes() / 15) * 15 });
  };

  return (
    <div className={mobileEmbedded ? 'space-y-4' : `${GLASS} space-y-3 p-3`}>
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
              className={`min-h-11 flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors md:min-h-10 ${
                on ? 'border-[#7cc4ff] bg-[#7cc4ff] text-[#0b1220]' : 'border-[#1f2a44] bg-[#0f1729] text-slate-300 hover:border-[#7cc4ff] hover:bg-[#14233a]'
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
          <span className="raasta-section-label">Leaving at</span>
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
          className="h-11 w-full accent-[#7cc4ff] md:h-10"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>11:45 PM</span>
        </div>
      </div>

      <div className="flex">
        <button
          type="button"
          onClick={setNow}
          className="raasta-button-secondary min-h-10 flex-1 py-2 text-sm"
        >
          Now
        </button>
      </div>
    </div>
  );
}
