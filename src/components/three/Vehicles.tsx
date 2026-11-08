'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { usePredictions } from './usePredictions';

interface SegmentMotion {
  start: THREE.Vector3;
  end: THREE.Vector3;
  length: number;
}

interface RoadRuntime {
  road: Road;
  segments: SegmentMotion[];
  cumulativeLengths: number[];
  totalLength: number;
  score: number;
}

interface CarState {
  roadId: string;
  segmentIndex: number;
  distance: number;
  speed: number;
  direction: 1 | -1;
  laneOffset: number;
}

function hashUnit(seedText: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

const CAR_COLOURS = [
  '#f7f7f2', '#b9c1c8', '#17191c', '#c83232',
  '#376da8', '#2e9e57', '#f2c230',
];

function laneOffsets(type: Road['type']): readonly [number, number] {
  if (type === 'highway') return [14, 30];
  if (type === 'arterial') return [10, 21];
  return [7, 14];
}

export function Vehicles() {
  const roads = useAppStore((state) => state.roads);
  const selectedTime = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
  const filter = useAppStore((state) => state.filter);
  const predictions = usePredictions(roads, selectedTime, rain);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const runtime = useMemo<RoadRuntime[]>(() => roads.map((road) => {
    const segments: SegmentMotion[] = [];
    const cumulativeLengths: number[] = [];
    let totalLength = 0;

    road.segments.forEach((polyline) => {
      for (let pointIndex = 1; pointIndex < polyline.length; pointIndex += 1) {
        const startPoint = polyline[pointIndex - 1];
        const endPoint = polyline[pointIndex];
        const start = new THREE.Vector3(startPoint[0], 0, -startPoint[1]);
        const end = new THREE.Vector3(endPoint[0], 0, -endPoint[1]);
        const length = start.distanceTo(end);
        if (length <= 0.001) continue;
        totalLength += length;
        cumulativeLengths.push(totalLength);
        segments.push({ start, end, length });
      }
    });

    return {
      road,
      segments,
      cumulativeLengths,
      totalLength,
      score: predictions.get(road.id)?.nowScore ?? 0,
    };
  }), [roads, predictions]);

  const weighted = useMemo(() => runtime.map((item) => {
    const level = predictions.get(item.road.id)?.nowLevel ?? 'light';
    if (!filter[level]) return { roadId: item.road.id, weight: 0 };

    const typeWeight = item.road.type === 'highway' ? 3.0 : item.road.type === 'arterial' ? 2.0 : 0.7;
    const congestionWeight = 1 + item.score / 100 * 1.25;
    return {
      roadId: item.road.id,
      weight: Math.max(0, item.totalLength * typeWeight * congestionWeight),
    };
  }), [runtime, predictions, filter]);

  const cars = useMemo<CarState[]>(() => {
    if (weighted.length === 0) return [];
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return [];

    const counts = weighted.map((item) => Math.floor(item.weight / totalWeight * 4000));
    const assigned = counts.reduce((sum, count) => sum + count, 0);
    const remainders = weighted.map((item, index) => ({
      index,
      remainder: item.weight / totalWeight * 4000 - counts[index],
    })).sort((a, b) => b.remainder - a.remainder);
    for (let index = 0; index < 4000 - assigned; index += 1) {
      counts[remainders[index % remainders.length].index] += 1;
    }

    const roadRuntimeLookup = new Map(runtime.map((item) => [item.road.id, item]));
    const result: CarState[] = [];
    weighted.forEach((item, roadIndex) => {
      const roadRuntime = roadRuntimeLookup.get(item.roadId);
      if (!roadRuntime || counts[roadIndex] === 0) return;
      for (let index = 0; index < counts[roadIndex]; index += 1) {
        const seed = `${item.roadId}-${index}-${selectedTime.day}-${selectedTime.hour}-${selectedTime.minute}-${rain}`;
        const pick = hashUnit(`${seed}-pick`) * roadRuntime.totalLength;
        let segmentIndex = 0;
        for (; segmentIndex < roadRuntime.cumulativeLengths.length; segmentIndex += 1) {
          if (pick <= roadRuntime.cumulativeLengths[segmentIndex]) break;
        }
        segmentIndex = Math.min(segmentIndex, roadRuntime.segments.length - 1);
        if (segmentIndex < 0) continue;

        const segment = roadRuntime.segments[segmentIndex];
        const segmentStart = segmentIndex === 0
          ? 0
          : roadRuntime.cumulativeLengths[segmentIndex - 1];
        const distanceFraction = THREE.MathUtils.clamp(
          (pick - segmentStart) / Math.max(segment.length, 1),
          0,
          1,
        );
        const direction: 1 | -1 = hashUnit(`${seed}-direction`) > 0.5 ? 1 : -1;
        const offsets = laneOffsets(roadRuntime.road.type);
        const laneIndex = hashUnit(`${seed}-lane`) > 0.5 ? 1 : 0;
        const laneJitter = (hashUnit(`${seed}-lane-jitter`) - 0.5) * 4;
        const speedFactor = 1 - Math.min(0.65, roadRuntime.score / 150);
        const randomSpeed = 9 + hashUnit(`${seed}-speed`) * 8;
        const rainPenalty = rain ? 0.82 : 1;

        result.push({
          roadId: item.roadId,
          segmentIndex,
          distance: distanceFraction * segment.length,
          speed: randomSpeed * speedFactor * rainPenalty,
          direction,
          laneOffset: direction * offsets[laneIndex] + laneJitter,
        });
      }
    });
    return result;
  }, [runtime, weighted, selectedTime, rain]);

  const roadRuntimeLookup = useMemo(
    () => new Map(runtime.map((item) => [item.road.id, item])),
    [runtime],
  );

  const updateInstance = (
    mesh: THREE.InstancedMesh,
    dummy: THREE.Object3D,
    state: CarState,
    index: number,
  ) => {
    const roadRuntime = roadRuntimeLookup.get(state.roadId);
    if (!roadRuntime || roadRuntime.segments.length === 0) return;

    let segmentIndex = THREE.MathUtils.clamp(state.segmentIndex, 0, roadRuntime.segments.length - 1);
    let segment = roadRuntime.segments[segmentIndex];
    if (state.direction === 1 && state.distance >= segment.length) {
      state.distance -= segment.length;
      segmentIndex = (segmentIndex + 1) % roadRuntime.segments.length;
      segment = roadRuntime.segments[segmentIndex];
    } else if (state.direction === -1 && state.distance < 0) {
      segmentIndex = (segmentIndex - 1 + roadRuntime.segments.length) % roadRuntime.segments.length;
      segment = roadRuntime.segments[segmentIndex];
      state.distance += segment.length;
    }
    state.segmentIndex = segmentIndex;

    const fraction = segment.length > 0
      ? THREE.MathUtils.clamp(state.distance / segment.length, 0, 1)
      : 0;
    const start = state.direction === 1 ? segment.start : segment.end;
    const end = state.direction === 1 ? segment.end : segment.start;
    const position = start.clone().lerp(end, fraction);
    const tangent = end.clone().sub(start).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    position.add(normal.multiplyScalar(state.laneOffset));
    position.y = 8;

    dummy.position.copy(position);
    dummy.rotation.set(0, Math.atan2(-tangent.z, tangent.x), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = cars.length;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    cars.forEach((car, index) => updateInstance(mesh, dummy, car, index));
    mesh.instanceMatrix.needsUpdate = true;

    cars.forEach((car, index) => {
      const seed = `${car.roadId}-${index}-${selectedTime.day}-${selectedTime.hour}-${rain}`;
      const colourIndex = Math.floor(hashUnit(`${seed}-colour`) * CAR_COLOURS.length);
      mesh.setColorAt(index, new THREE.Color(CAR_COLOURS[colourIndex]));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cars, selectedTime, rain, roadRuntimeLookup]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const safeDelta = Math.min(delta, 0.05);
    const dummy = new THREE.Object3D();
    cars.forEach((car, index) => {
      car.distance += car.speed * car.direction * safeDelta;
      updateInstance(mesh, dummy, car, index);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, 4000]} castShadow>
      <boxGeometry args={[34, 12, 15]} />
      <meshStandardMaterial roughness={0.72} metalness={0.08} />
    </instancedMesh>
  );
}
