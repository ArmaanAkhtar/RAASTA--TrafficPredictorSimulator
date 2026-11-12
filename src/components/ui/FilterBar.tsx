// src/components/ui/FilterBar.tsx
// Heavy / Medium / Light toggle pills. No props.
'use client';

import { LEVEL_COLOR } from '../../lib/api';
import type { RushLevel } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';

const LEVELS: Array<{ level: RushLevel; label: string }> = [
  { level: 'heavy', label: 'Heavy' },
  { level: 'medium', label: 'Medium' },
  { level: 'light', label: 'Light' },
];

export default function FilterBar() {
  const filter = useAppStore((s) => s.filter);
  const toggleFilter = useAppStore((s) => s.toggleFilter);

  return (
    <div className="flex gap-2" role="group" aria-label="Filter roads by rush level">
      {LEVELS.map(({ level, label }) => {
        const on = filter[level];
        return (
          <button
            key={level}
            type="button"
            aria-pressed={on}
            onClick={() => toggleFilter(level)}
            className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              on
                ? 'border-[#7cc4ff]/50 bg-[#7cc4ff]/10 text-[#f6f2ea]'
                : 'border-[#1f2a44] bg-[#0f1729]/80 text-slate-500 line-through'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: on ? LEVEL_COLOR[level] : '#475569' }}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
