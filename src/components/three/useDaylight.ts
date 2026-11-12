'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/store/useAppStore';

export interface DaylightState {
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  ambientIntensity: number;
  darkness: number;
}

const MAP_NAVY = '#0b1220';

function sunDirectionFor(hour: number): THREE.Vector3 {
  const arc = THREE.MathUtils.clamp((hour - 5) / 15, 0, 1) * Math.PI;
  const height = hour >= 5 && hour <= 20 ? Math.sin(arc) : -0.15;
  return new THREE.Vector3(Math.cos(arc), height, 0.35).normalize();
}

export function useDaylight(): DaylightState {
  const selectedTime = useAppStore((state) => state.selectedTime);
  const targetHour = useMemo(
    () => selectedTime.hour + selectedTime.minute / 60,
    [selectedTime.hour, selectedTime.minute],
  );
  const target = useRef<DaylightState | null>(null);
  const current = useRef<DaylightState>({
    skyColor: new THREE.Color(MAP_NAVY),
    groundColor: new THREE.Color(MAP_NAVY),
    sunDirection: sunDirectionFor(16),
    sunColor: new THREE.Color('#f6f2ea'),
    sunIntensity: 2.2,
    ambientIntensity: 0.72,
    darkness: 0,
  });

  useEffect(() => {
    let darkness: number;
    if (targetHour < 5.5) {
      darkness = 1;
    } else if (targetHour < 7) {
      const t = (targetHour - 5.5) / 1.5;
      darkness = 1 - t * t * (3 - 2 * t);
    } else if (targetHour < 17) {
      darkness = 0;
    } else if (targetHour < 19.5) {
      const t = (targetHour - 17) / 2.5;
      darkness = t * t * (3 - 2 * t);
    } else {
      darkness = 1;
    }

    const day = 1 - darkness;
    const sun = darkness > 0.6
      ? new THREE.Color('#8790a8')
      : targetHour >= 17 && targetHour <= 18.5
        ? new THREE.Color('#f6f2ea')
        : new THREE.Color('#bcd3e6');
    const sunIntensity = darkness >= 0.95 ? 0 : THREE.MathUtils.lerp(0.25, 1.7, day);
    target.current = {
      skyColor: new THREE.Color(MAP_NAVY),
      groundColor: new THREE.Color(MAP_NAVY),
      sunDirection: sunDirectionFor(targetHour),
      sunColor: sun,
      sunIntensity,
      ambientIntensity: THREE.MathUtils.lerp(0.25, 1.05, day),
      darkness,
    };
  }, [targetHour]);

  useFrame((_, delta) => {
    const destination = target.current;
    if (!destination) return;
    const value = current.current;
    const lambda = Math.min(1, delta / 0.8);
    value.sunColor.lerp(destination.sunColor, lambda);
    value.sunDirection.lerp(destination.sunDirection, lambda).normalize();
    value.sunIntensity = THREE.MathUtils.damp(value.sunIntensity, destination.sunIntensity, 5, delta);
    value.ambientIntensity = THREE.MathUtils.damp(value.ambientIntensity, destination.ambientIntensity, 5, delta);
    value.darkness = THREE.MathUtils.damp(value.darkness, destination.darkness, 5, delta);
  });

  // The frame loop updates this stable object without triggering React renders.
  // eslint-disable-next-line react-hooks/refs
  return current.current;
}
