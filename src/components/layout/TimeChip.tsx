'use client';

import { formatTime } from '@/components/ui/TimePicker';
import { useAppStore } from '@/store/useAppStore';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Compact time button that opens the full TimePicker. */
export default function TimeChip({
  open,
  onToggle,
  className = '',
  compact = false,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  compact?: boolean;
}) {
  const t = useAppStore((state) => state.selectedTime);
  const label = `${DAYS[t.day] ?? ''} · ${formatTime(t.hour, t.minute)}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Leaving ${label}. ${open ? 'Hide' : 'Change'} time`}
      className={`raasta-button-secondary flex min-h-10 items-center gap-2 px-3 py-2 text-sm hover:text-[#7cc4ff] ${
        open ? 'border-[#7cc4ff] bg-[#7cc4ff]/10 text-[#7cc4ff]' : ''
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7cc4ff]" fill="none" stroke="currentColor" strokeWidth={compact ? '1.75' : '1.5'} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="tabular-nums">{label}</span>
      {!compact && <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>}
    </button>
  );
}
