import type {
  Prediction,
  Road,
  RouteResult,
  RushLevel,
  SelectedTime,
} from './types';

export const LEVEL_COLOR: Record<RushLevel, string> = {
  light: '#30a46c',
  medium: '#f5a524',
  heavy: '#e5484d',
};

const roads: Road[] = [
  { id: 'shahrah-e-faisal', name: 'Shahrah-e-Faisal', type: 'highway', segments: [[[-7200, -4200], [-4800, -4000], [-2200, -3500], [1800, -2800], [5200, -2200]], [[5200, -2200], [6800, -1600], [7600, 400]]], lengthM: 15000, center: [-200, -1800] },
  { id: 'university-road', name: 'University Road', type: 'arterial', segments: [[[-5200, 5800], [-2200, 5200], [900, 4400], [4200, 3200]], [[4200, 3200], [5600, 2200], [6500, 800]]], lengthM: 14500, center: [700, 3300] },
  { id: 'rashid-minhas-road', name: 'Rashid Minhas Road', type: 'arterial', segments: [[[-6800, -600], [-3800, 300], [-800, 900], [2600, 1300], [6200, 1800]]], lengthM: 13000, center: [-300, 600] },
  { id: 'm-a-jinnah-road', name: 'M. A. Jinnah Road', type: 'arterial', segments: [[[-3500, -6500], [-2400, -4200], [-1500, -1500], [200, 1800], [1600, 4800]]], lengthM: 12000, center: [-900, -600] },
  { id: 'ii-chundrigar-road', name: 'I. I. Chundrigar Road', type: 'highway', segments: [[[1000, -5200], [1500, -3800], [1000, -2200], [-100, -900], [-800, 500]]], lengthM: 6200, center: [100, -2400] },
  { id: 'korangi-road', name: 'Korangi Road', type: 'highway', segments: [[[-6200, -7000], [-3600, -6200], [-500, -5400], [3000, -4700], [6200, -3900]]], lengthM: 13200, center: [0, -5500] },
  { id: 'liaquatabad-flyover', name: 'Liaquatabad Flyover', type: 'highway', segments: [[[-3000, 1500], [-1800, 2600], [-400, 4200], [1000, 6000]]], lengthM: 5200, center: [-800, 4000] },
  { id: 'nishtar-road', name: 'Nishtar Road', type: 'arterial', segments: [[[5000, -7000], [4000, -4800], [2600, -2200], [1500, 300], [800, 2800]]], lengthM: 10500, center: [2600, -2400] },
  { id: 'stadium-road', name: 'Stadium Road', type: 'local', segments: [[[-7600, 6800], [-5000, 6200], [-1800, 5600], [1200, 5000], [4000, 4300]]], lengthM: 11800, center: [-1800, 5600] },
  { id: 'super-highway', name: 'Super Highway', type: 'highway', segments: [[[3800, 7000], [4400, 5200], [5000, 3000], [5500, 500], [6200, -3000]]], lengthM: 10800, center: [5000, 2200] },
  { id: 'clifton-road', name: 'Clifton Road', type: 'local', segments: [[[-7000, -7800], [-4200, -7200], [-1200, -6800], [1800, -6400], [4800, -5900]]], lengthM: 12500, center: [-1400, -6900] },
  { id: 'drigh-road', name: 'Drigh Road', type: 'arterial', segments: [[[2400, -5200], [2500, -3200], [2200, -900], [1800, 1400], [1400, 3600]], [[1400, 3600], [1800, 5200], [2600, 7000]]], lengthM: 12500, center: [2100, 600] },
];

export async function loadRoads(): Promise<Road[]> {
  return roads;
}

export function levelOf(score: number): RushLevel {
  if (score < 40) return 'light';
  if (score <= 70) return 'medium';
  return 'heavy';
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function predict(road: Road, time: SelectedTime, rain: boolean): Prediction {
  const seed = hashText(`${road.id}-${time.day}`);
  const weekdayFactor = time.day === 0 || time.day === 6 ? -8 : 4;
  const rainFactor = rain ? 12 : 0;
  const hourly = Array.from({ length: 24 }, (_, hour): Prediction['hourly'][number] => {
    const commutePeak = hour >= 7 && hour <= 10
      ? 24
      : hour >= 16 && hour <= 20
        ? 28
        : -8;
    const score = clamp(18 + ((seed + hour * 17 + time.day * 11) % 38) + commutePeak + weekdayFactor + rainFactor, 5, 100);
    return { hour, score, level: levelOf(score) };
  });

  const nowScore = hourly[time.hour]?.score ?? 0;
  const nextHour = hourly[(time.hour + 1) % 24]?.score ?? nowScore;
  const jamChanceNextHour = clamp(Math.round(nowScore * 0.55 + nextHour * 0.45), 0, 100);

  return {
    roadId: road.id,
    nowScore,
    nowLevel: levelOf(nowScore),
    jamChanceNextHour,
    hourly,
  };
}

export function findAltRoute(
  _roads: Road[],
  _roadId: string,
  _time: SelectedTime,
  _rain: boolean,
): RouteResult | null {
  return null;
}
