'use client';

import { useMemo } from 'react';
import { predict } from '@/lib/api';
import type { Prediction, Road, SelectedTime } from '@/lib/types';

export function usePredictions(
  roads: Road[],
  selectedTime: SelectedTime,
  rain: boolean,
): Map<string, Prediction> {
  return useMemo(() => {
    const predictions = new Map<string, Prediction>();
    roads.forEach((road) => {
      predictions.set(road.id, predict(road, selectedTime, rain));
    });
    return predictions;
  }, [roads, selectedTime.day, selectedTime.hour, selectedTime.minute, rain]);
}
