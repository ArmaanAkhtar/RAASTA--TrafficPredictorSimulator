'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useAppStore } from '@/store/useAppStore';

/**
 * Returns `value`, but only after it has stopped changing for `ms` milliseconds.
 * Used so that dragging the time slider does not rebuild the whole city on every 15-minute step:
 * the slider stays smooth and the 3D catches up a moment after you let go.
 */
export function useSettledValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Selected time + rain, settled. Used so the 3D only rebuilds once the slider stops. */
export function useSettledTimeAndRain(ms: number) {
  const selectedTime = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
  return {
    time: useSettledValue(selectedTime, ms),
    rain: useSettledValue(rain, ms),
  };
}

/** True on phones/tablets or machines with few CPU cores. Client-only (the Scene is never server-rendered). */
export function isWeakDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse || cores <= 4 || window.innerWidth < 768;
}

/**
 * How far the camera is from the point it looks at (metres): ~1500 zoomed into the streets, ~40000 for the
 * whole city. Things that should keep their size on screen (pins, the location dot, road width) scale with it.
 */
export function viewDistance(camera: THREE.Camera, controls: unknown): number {
  const target = (controls as { target?: unknown } | null)?.target;
  return target instanceof THREE.Vector3 ? camera.position.distanceTo(target) : camera.position.y;
}
