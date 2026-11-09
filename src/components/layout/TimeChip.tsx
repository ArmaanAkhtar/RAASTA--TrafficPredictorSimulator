'use client';

import { formatTime } from '@/components/ui/TimePicker';
import { useAppStore } from '@/store/useAppStore';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Compact "Wed · 4:00 PM · Rain off" button that opens the full TimePicker. */
export default function TimeChip({
  open,
  onToggle,
  showRain = false,
  className = '',
}: {
  open: boolean;
  onToggle: () => void;
  showRain?: boolean;
  className?: string;
}) {
  const t = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
  const label = `${DAYS[t.day] ?? ''} · ${formatTime(t.hour, t.minute)}${showRain ? ` · Rain ${rain ? 'on' : 'off'}` : ''}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Leaving ${label}. ${open ? 'Hide' : 'Change'} time`}
      className={`flex items-center gap-2 rounded-full border border-white/10 bg-[#0b1220]/75 px-3 py-2 text-sm text-slate-100 shadow-lg backdrop-blur-md hover:border-[#ffb547]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb547] ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#ffb547]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="tabular-nums">{label}</span>
      {!showRain && rain && <span className="text-[#7cc4ff]">· Rain</span>}
      <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
        ▾
      </span>
    </button>
  );
}
