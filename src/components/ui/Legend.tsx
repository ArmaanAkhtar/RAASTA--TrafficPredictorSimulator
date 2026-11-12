// src/components/ui/Legend.tsx
// Colour key for the map. No props.
'use client';

import { LEVEL_COLOR } from '../../lib/api';

const ROWS = [
  { color: LEVEL_COLOR.heavy, label: 'Heavy rush', note: '> 70' },
  { color: LEVEL_COLOR.medium, label: 'Medium', note: '40-70' },
  { color: LEVEL_COLOR.light, label: 'Light', note: '< 40' },
];

export default function Legend() {
  return (
    <div className="raasta-panel p-3 text-xs">
      <p className="raasta-section-label mb-2">Rush level</p>
      <ul className="space-y-1.5">
        {ROWS.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: r.color }} />
            <span className="text-slate-200">{r.label}</span>
            <span className="ml-auto pl-3 text-slate-500">{r.note}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-[#1f2a44] pt-1.5">
          <span className="h-1.5 w-5 rounded-full bg-[#7cc4ff]" />
          <span className="text-slate-200">Better route</span>
        </li>
      </ul>
      <p className="mt-2 text-slate-500">Thin grey lines are streets (no prediction)</p>
    </div>
  );
}
