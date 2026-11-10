'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/store/useAppStore';

export interface DaylightState {
  skyColor: THREE.Color;
  horizonColor: THREE.Color;
  groundColor: THREE.Color;
  fogColor: THREE.Color;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  ambientIntensity: number;
  darkness: number;
  horizonGlow: number;
}

// Clearly different day and night (the old "day" sky was almost as dark as night)
const NIGHT_SKY = '#04070e';
const DAY_SKY = '#7fa9cf'; // hazy Karachi afternoon blue
const NIGHT_HORIZON = '#0c1424';
const DAY_HORIZON = '#d4dde6';
const GOLDEN_HORIZON = '#ffa95e';
const NIGHT_GROUND = '#050912';
const DAY_GROUND = '#3a4252'; // dusty grey-blue land, so roads and colours read in daylight
const NIGHT_FOG = '#04070e';
const DAY_FOG = '#c3cfdb';

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
    skyColor: new THREE.Color('#05080f'),
    horizonColor: new THREE.Color('#05080f'),
    groundColor: new THREE.Color('#070b16'),
    fogColor: new THREE.Color('#05080f'),
    sunDirection: sunDirectionFor(16),
    sunColor: new THREE.Color('#fff2d2'),
    sunIntensity: 2.2,
    ambientIntensity: 0.72,
    darkness: 0,
    horizonGlow: 0,
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

    const dawn = 1 - THREE.MathUtils.smoothstep(Math.abs(targetHour - 6), 0, 0.7);
    const golden = 1 - THREE.MathUtils.smoothstep(Math.abs(targetHour - 17.75), 0, 0.75);
    const horizonGlow = Math.max(dawn * 0.35, golden * 0.55);
    const day = 1 - darkness;
    const sky = new THREE.Color(NIGHT_SKY).lerp(new THREE.Color(DAY_SKY), day);
    const ground = new THREE.Color(NIGHT_GROUND).lerp(new THREE.Color(DAY_GROUND), day);
    const fog = new THREE.Color(NIGHT_FOG).lerp(new THREE.Color(DAY_FOG), day);
    // Horizon: day haze / night navy, warmed to amber at dawn and sunset
    const horizon = new THREE.Color(NIGHT_HORIZON)
      .lerp(new THREE.Color(DAY_HORIZON), day)
      .lerp(new THREE.Color(GOLDEN_HORIZON), Math.min(1, horizonGlow * 1.4));
    // Fog uses the horizon colour so the far ground melts into the sky (no hard edge)
    fog.lerp(horizon, 0.6);
    const sun = darkness > 0.6
      ? new THREE.Color('#8790a8')
      : targetHour >= 17 && targetHour <= 18.5
        ? new THREE.Color('#ffb36b')
        : new THREE.Color('#bcd3e6');
    const sunIntensity = darkness >= 0.95 ? 0 : THREE.MathUtils.lerp(0.25, 1.7, day);
    target.current = {
      skyColor: sky,
      horizonColor: horizon,
      groundColor: ground,
      fogColor: fog,
      sunDirection: sunDirectionFor(targetHour),
      sunColor: sun,
      sunIntensity,
      ambientIntensity: THREE.MathUtils.lerp(0.25, 1.05, day),
      darkness,
      horizonGlow,
    };
  }, [targetHour]);

  useFrame((_, delta) => {
    const destination = target.current;
    if (!destination) return;
    const value = current.current;
    const lambda = Math.min(1, delta / 0.8);
    value.skyColor.lerp(destination.skyColor, lambda);
    value.horizonColor.lerp(destination.horizonColor, lambda);
    value.groundColor.lerp(destination.groundColor, lambda);
    value.fogColor.lerp(destination.fogColor, lambda);
    value.sunColor.lerp(destination.sunColor, lambda);
    value.sunDirection.lerp(destination.sunDirection, lambda).normalize();
    value.sunIntensity = THREE.MathUtils.damp(value.sunIntensity, destination.sunIntensity, 5, delta);
    value.ambientIntensity = THREE.MathUtils.damp(value.ambientIntensity, destination.ambientIntensity, 5, delta);
    value.darkness = THREE.MathUtils.damp(value.darkness, destination.darkness, 5, delta);
    value.horizonGlow = THREE.MathUtils.damp(value.horizonGlow, destination.horizonGlow, 5, delta);
  });

  return current.current;
}
