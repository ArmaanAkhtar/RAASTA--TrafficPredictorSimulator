// src/lib/rushProfiles.ts
// Hourly base rush scores (0-100), index 0 = 00:00 ... 23 = 23:00.
// Imported directly so predict() stays synchronous.
// KEEP IN SYNC with public/data/rush_profiles.json (scripts/test-prediction.ts warns if they differ).
//
// Karachi pattern: light 0-6, morning peak 8-10, school/uni closing 13-16,
// evening office peak 17-20 (highest of the day).
import type { RoadType } from './types';

export type HourlyProfile = readonly number[]; // exactly 24 numbers

export interface RushProfiles {
  byType: Record<RoadType, HourlyProfile>;
  byRoad: Record<string, HourlyProfile>; // key = exact road name from roads.geojson
}

export const RUSH_PROFILES: RushProfiles = {
  byType: {
    highway: [18, 12, 10, 9, 10, 16, 30, 55, 78, 82, 70, 62, 64, 68, 72, 74, 80, 92, 95, 86, 68, 50, 36, 25],
    arterial: [15, 10, 8, 7, 8, 14, 28, 52, 75, 80, 68, 62, 66, 72, 76, 74, 78, 90, 92, 82, 64, 46, 32, 22],
    local: [12, 8, 6, 5, 6, 12, 24, 45, 65, 68, 58, 55, 60, 66, 68, 62, 64, 74, 76, 68, 52, 38, 26, 18],
  },
  byRoad: {
    // Busiest corridor: airport, offices, everything
    'Shahrah-e-Faisal': [22, 15, 12, 10, 12, 20, 38, 65, 88, 92, 80, 72, 74, 78, 82, 84, 88, 97, 99, 92, 76, 58, 42, 30],
    // Universities + schools: strong 13-16 bump
    'University Road': [16, 10, 8, 7, 8, 15, 30, 58, 82, 86, 72, 66, 74, 84, 86, 82, 82, 94, 95, 85, 66, 48, 34, 24],
    // Old city + markets: busy all day
    'M.A. Jinnah Road': [18, 12, 9, 8, 9, 16, 32, 56, 76, 82, 80, 78, 80, 82, 84, 82, 84, 92, 93, 86, 72, 55, 40, 28],
    // Main alternative to Shahrah-e-Faisal: busy but lighter
    'Rashid Minhas Road': [14, 9, 7, 6, 7, 13, 26, 48, 66, 70, 60, 55, 58, 62, 64, 62, 66, 74, 76, 68, 52, 38, 26, 18],
    'Shahrah-e-Pakistan': [16, 10, 8, 7, 8, 14, 30, 54, 76, 80, 68, 62, 66, 70, 74, 74, 80, 90, 92, 82, 64, 46, 32, 22],
    // Industrial: factory shift changes around 7-8 and 18-19
    'Korangi Road': [18, 12, 10, 9, 12, 22, 45, 70, 80, 74, 62, 58, 60, 64, 68, 70, 76, 86, 88, 80, 62, 44, 32, 24],
    // Trucks at night, moderate in the day
    'Lyari Expressway': [30, 28, 26, 24, 24, 26, 34, 52, 64, 66, 58, 54, 54, 56, 58, 60, 64, 72, 74, 68, 56, 46, 38, 34],
    // Business district: office hours only, empty at night
    'I.I. Chundrigar Road': [8, 5, 4, 4, 4, 8, 20, 48, 82, 88, 80, 76, 80, 78, 76, 74, 80, 90, 84, 62, 38, 22, 14, 10],
  },
};
