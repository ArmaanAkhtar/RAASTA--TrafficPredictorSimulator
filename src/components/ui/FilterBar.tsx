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
    <div className="flex w-full flex-nowrap gap-2" role="group" aria-label="Filter roads by rush level">
      {LEVELS.map(({ level, label }) => {
        const on = filter[level];
        return (
          <button
            key={level}
            type="button"
            aria-pressed={on}
            onClick={() => toggleFilter(level)}
            className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border bg-[#0f1729] px-2 py-1.5 text-xs font-medium transition-colors ${
              on
                ? 'border-[#7cc4ff] text-[#f6f2ea]'
                : 'border-[#1f2a44] text-[#8f9bb8]'
            }`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: LEVEL_COLOR[level] }}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
