'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { usePredictions } from './usePredictions';

const VEHICLE_SCALE = 3;

type VehicleType = 'car' | 'bike' | 'rickshaw' | 'bus' | 'tanker';

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

interface VehicleState {
  roadId: string;
  type: VehicleType;
  segmentIndex: number;
  distance: number;
  speed: number;
  direction: 1 | -1;
  laneIndex: 0 | 1;
  laneOffset: number;
  wobble: number;
  colorSeed: number;
  yaw: number;
}

function hashUnit(seedText: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function addVertexGeometry(
  target: {
    positions: number[];
    normals: number[];
    colors: number[];
  },
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  color: THREE.Color,
) {
  const transformed = geometry.toNonIndexed().clone().applyMatrix4(matrix);
  const positions = transformed.getAttribute('position');
  const normals = transformed.getAttribute('normal');
  for (let index = 0; index < positions.count; index += 1) {
    target.positions.push(positions.getX(index), positions.getY(index), positions.getZ(index));
    target.normals.push(normals?.getX(index) ?? 0, normals?.getY(index) ?? 1, normals?.getZ(index) ?? 0);
    target.colors.push(color.r, color.g, color.b);
  }
  transformed.dispose();
}

function finishMergedGeometry(source: {
  positions: number[];
  normals: number[];
  colors: number[];
}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(source.colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildVehicleGeometries(): Record<VehicleType, THREE.BufferGeometry> {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const wheel = new THREE.CylinderGeometry(1, 1, 1, 12);
  const models: Record<VehicleType, { positions: number[]; normals: number[]; colors: number[] }> = {
    car: { positions: [], normals: [], colors: [] },
    bike: { positions: [], normals: [], colors: [] },
    rickshaw: { positions: [], normals: [], colors: [] },
    bus: { positions: [], normals: [], colors: [] },
    tanker: { positions: [], normals: [], colors: [] },
  };
  const white = new THREE.Color('#f7f7f2');
  const silver = new THREE.Color('#b9c1c8');
  const black = new THREE.Color('#17191c');
  const darkGlass = new THREE.Color('#1b2a3a');
  const green = new THREE.Color('#2e9e57');
  const yellow = new THREE.Color('#f2c230');
  const red = new THREE.Color('#e84d3d');
  const blue = new THREE.Color('#2b7de9');
  const riderShirts = [new THREE.Color('#e84d3d'), new THREE.Color('#2b7de9'), new THREE.Color('#f7f7f2')];
  const matrix = new THREE.Matrix4();

  const addBox = (target: VehicleType, size: [number, number, number], position: [number, number, number], color: THREE.Color, rotationY = 0) => {
    matrix.compose(
      new THREE.Vector3(position[0], position[1], position[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
      new THREE.Vector3(size[0], size[1], size[2]),
    );
    addVertexGeometry(models[target], box, matrix, color);
  };

  const addCylinder = (target: VehicleType, scale: [number, number, number], position: [number, number, number], color: THREE.Color, rotation: [number, number, number] = [0, 0, 0]) => {
    matrix.compose(
      new THREE.Vector3(position[0], position[1], position[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
      new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
    addVertexGeometry(models[target], cylinder, matrix, color);
  };

  const s = VEHICLE_SCALE;
  // Car, 4.5 m long at VEHICLE_SCALE.
  addBox('car', [4.5 * s, 0.8 * s, 2.1 * s], [0, 0.65 * s, 0], white);
  addBox('car', [3.0 * s, 0.65 * s, 1.8 * s], [0, 1.35 * s, -0.15 * s], darkGlass);
  [-1, 1].forEach((side) => {
    [-1.35, 1.35].forEach((long) => {
      matrix.compose(
        new THREE.Vector3(long * s, 0.45 * s, side * 1.08 * s),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
        new THREE.Vector3(0.44 * s, 0.28 * s, 0.44 * s),
      );
      addVertexGeometry(models.car, wheel, matrix, black);
    });
  });

  // Motorbike and rider.
  addBox('bike', [0.32 * s, 0.18 * s, 2.0 * s], [0, 0.55 * s, 0], black);
  [-1, 1].forEach((sideZ) => {
    matrix.compose(
      new THREE.Vector3(0, 0.45 * s, sideZ * 0.72 * s),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
      new THREE.Vector3(0.38 * s, 0.14 * s, 0.38 * s),
    );
    addVertexGeometry(models.bike, wheel, matrix, black);
  });
  addBox('bike', [0.44 * s, 0.8 * s, 0.5 * s], [0, 1.15 * s, -0.2 * s], riderShirts[1]);
  addCylinder('bike', [0.38 * s, 0.38 * s, 0.38 * s], [0, 1.8 * s, -0.2 * s], silver);

  // Karachi CNG rickshaw.
  addBox('rickshaw', [2.8 * s, 0.55 * s, 1.55 * s], [0, 0.7 * s, 0], green);
  addBox('rickshaw', [2.8 * s, 0.12 * s, 1.55 * s], [0, 2.05 * s, 0], yellow);
  [-1, 1].forEach((side) => {
    matrix.compose(
      new THREE.Vector3(0, 0.45 * s, side * 0.78 * s),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
      new THREE.Vector3(0.42 * s, 0.22 * s, 0.42 * s),
    );
    addVertexGeometry(models.rickshaw, wheel, matrix, black);
  });
  matrix.compose(
    new THREE.Vector3(-0.88 * s, 0.45 * s, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
    new THREE.Vector3(0.42 * s, 0.22 * s, 0.42 * s),
  );
  addVertexGeometry(models.rickshaw, wheel, matrix, black);

  // Decorated Karachi bus/minibus.
  addBox('bus', [11 * s, 1.6 * s, 2.6 * s], [0, 1.05 * s, 0], red);
  addBox('bus', [9.8 * s, 0.55 * s, 2.64 * s], [-0.1 * s, 2.15 * s, 0], blue);
  addBox('bus', [10.4 * s, 0.08 * s, 2.68 * s], [0, 1.55 * s, 0], yellow);
  [-4.0, -1.5, 1.5, 4.0].forEach((x) => {
    [-1.31, 1.31].forEach((z) => addBox('bus', [1.05 * s, 0.5 * s, 0.06 * s], [x * s, 1.75 * s, z * s], darkGlass));
  });
  [-4.2, 4.2].forEach((x) => {
    [-1, 1].forEach((side) => {
      matrix.compose(
        new THREE.Vector3(x * s, 0.45 * s, side * 1.32 * s),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
        new THREE.Vector3(0.7 * s, 0.38 * s, 0.7 * s),
      );
      addVertexGeometry(models.bus, wheel, matrix, black);
    });
  });

  // Water tanker truck.
  addBox('tanker', [2.8 * s, 1.05 * s, 2.4 * s], [3.0 * s, 0.85 * s, 0], white);
  addCylinder('tanker', [2.3 * s, 6.4 * s, 2.3 * s], [-1.4 * s, 1.45 * s, 0], blue, [Math.PI / 2, 0, 0]);
  [-3.6, 3.7].forEach((x) => {
    [-1, 1].forEach((side) => {
      matrix.compose(
        new THREE.Vector3(x * s, 0.45 * s, side * 1.25 * s),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
        new THREE.Vector3(0.68 * s, 0.38 * s, 0.68 * s),
      );
      addVertexGeometry(models.tanker, wheel, matrix, black);
    });
  });

  box.dispose();
  cylinder.dispose();
  wheel.dispose();
  return {
    car: finishMergedGeometry(models.car),
    bike: finishMergedGeometry(models.bike),
    rickshaw: finishMergedGeometry(models.rickshaw),
    bus: finishMergedGeometry(models.bus),
    tanker: finishMergedGeometry(models.tanker),
  };
}

function laneOffsets(type: Road['type']): readonly [number, number] {
  if (type === 'highway') return [18, 38];
  if (type === 'arterial') return [12, 28];
  return [7, 16];
}

export function Vehicles() {
  const roads = useAppStore((state) => state.roads);
  const selectedTime = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
  const filter = useAppStore((state) => state.filter);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const predictions = usePredictions(roads, selectedTime, rain);
  const { camera } = useThree();
  const bodyRefs = useRef<Record<VehicleType, THREE.InstancedMesh | null>>({
    car: null, bike: null, rickshaw: null, bus: null, tanker: null,
  });
  const headRef = useRef<THREE.InstancedMesh>(null);
  const tailRef = useRef<THREE.InstancedMesh>(null);
  const headCountRef = useRef(0);
  const tailCountRef = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lightMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const headlights = useMemo(() => new THREE.Color('#fff4d6'), []);
  const taillights = useMemo(() => new THREE.Color('#ff3b3b'), []);
  const currentBodyOpacity = useRef(1);
  const currentOverviewOpacity = useRef(0);

  const geometries = useMemo(() => buildVehicleGeometries(), []);
  useLayoutEffect(() => () => {
    Object.values(geometries).forEach((geometry) => geometry.dispose());
  }, [geometries]);

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
    const typeWeight = item.road.type === 'highway' ? 3 : item.road.type === 'arterial' ? 2 : 0.7;
    const congestionWeight = 1 + item.score / 100 * 1.25;
    return { roadId: item.road.id, weight: item.totalLength * typeWeight * congestionWeight };
  }), [runtime, predictions, filter]);

  const vehicles = useMemo<VehicleState[]>(() => {
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

    const runtimeLookup = new Map(runtime.map((item) => [item.road.id, item]));
    const result: VehicleState[] = [];
    weighted.forEach((item, roadIndex) => {
      const roadRuntime = runtimeLookup.get(item.roadId);
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
        const segmentStart = segmentIndex === 0 ? 0 : roadRuntime.cumulativeLengths[segmentIndex - 1];
        const fraction = THREE.MathUtils.clamp((pick - segmentStart) / Math.max(segment.length, 1), 0, 1);
        const direction: 1 | -1 = hashUnit(`${seed}-direction`) > 0.5 ? 1 : -1;
        const laneIndex = (hashUnit(`${seed}-lane`) > 0.5 ? 1 : 0) as 0 | 1;
        const mix = hashUnit(`${seed}-type`);
        const type: VehicleType = mix < 0.45
          ? 'car'
          : mix < 0.73
            ? 'bike'
            : mix < 0.88
              ? 'rickshaw'
              : mix < 0.96
                ? 'bus'
                : 'tanker';
        const offsets = laneOffsets(roadRuntime.road.type);
        const laneJitter = type === 'bike'
          ? (hashUnit(`${seed}-jitter`) - 0.5) * 10
          : (hashUnit(`${seed}-jitter`) - 0.5) * 2.5;
        const speedFactor = 1 - Math.min(0.65, roadRuntime.score / 150);
        const typeSpeed = type === 'bus' || type === 'tanker' ? 0.72 : type === 'bike' ? 1.12 : 1;
        const randomSpeed = 9 + hashUnit(`${seed}-speed`) * 8;
        const tangent = segment.end.clone().sub(segment.start).normalize();
        const directedTangent = direction === 1 ? tangent : tangent.negate();
        const yaw = Math.atan2(directedTangent.x, directedTangent.z);
        result.push({
          roadId: item.roadId,
          type,
          segmentIndex,
          distance: fraction * segment.length,
          speed: randomSpeed * speedFactor * typeSpeed * (rain ? 0.82 : 1),
          direction,
          laneIndex,
          laneOffset: offsets[laneIndex] + laneJitter,
          wobble: hashUnit(`${seed}-wobble`) * Math.PI * 2,
          colorSeed: hashUnit(`${seed}-colour`),
          yaw,
        });
      }
    });
    const laneGroups = new Map<string, VehicleState[]>();
    result.forEach((vehicle) => {
      const key = `${vehicle.roadId}:${vehicle.segmentIndex}:${vehicle.direction}:${vehicle.laneIndex}`;
      const group = laneGroups.get(key) ?? [];
      group.push(vehicle);
      laneGroups.set(key, group);
    });
    laneGroups.forEach((group) => {
      group.sort((a, b) => a.distance - b.distance);
      let previousDistance = -Infinity;
      group.forEach((vehicle) => {
        const minimumGap = vehicle.type === 'bus' || vehicle.type === 'tanker' ? 42 : vehicle.type === 'rickshaw' ? 18 : vehicle.type === 'car' ? 16 : 10;
        vehicle.distance = Math.max(vehicle.distance, previousDistance + minimumGap);
        previousDistance = vehicle.distance;
      });
    });
    return result;
  }, [runtime, weighted, selectedTime, rain]);

  const runtimeLookup = useMemo(
    () => new Map(runtime.map((item) => [item.road.id, item])),
    [runtime],
  );

  useLayoutEffect(() => {
    vehicles.forEach((vehicle) => {
      const roadRuntime = runtimeLookup.get(vehicle.roadId);
      if (!roadRuntime) return;
      const segment = roadRuntime.segments[vehicle.segmentIndex];
      if (!segment) return;
      const mesh = bodyRefs.current[vehicle.type];
      if (!mesh) return;
    });

    const typeCounts: Record<VehicleType, number> = { car: 0, bike: 0, rickshaw: 0, bus: 0, tanker: 0 };
    vehicles.forEach((vehicle) => typeCounts[vehicle.type] += 1);
    (Object.keys(typeCounts) as VehicleType[]).forEach((type) => {
      const mesh = bodyRefs.current[type];
      if (mesh) {
        mesh.count = typeCounts[type];
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
  }, [vehicles, runtimeLookup]);

  function getVehiclePosition(vehicle: VehicleState) {
    const roadRuntime = runtimeLookup.get(vehicle.roadId);
    if (!roadRuntime || roadRuntime.segments.length === 0) return null;
    let segmentIndex = THREE.MathUtils.clamp(vehicle.segmentIndex, 0, roadRuntime.segments.length - 1);
    let segment = roadRuntime.segments[segmentIndex];
    if (vehicle.direction === 1 && vehicle.distance >= segment.length) {
      vehicle.distance -= segment.length;
      segmentIndex = (segmentIndex + 1) % roadRuntime.segments.length;
      segment = roadRuntime.segments[segmentIndex];
    } else if (vehicle.direction === -1 && vehicle.distance < 0) {
      segmentIndex = (segmentIndex - 1 + roadRuntime.segments.length) % roadRuntime.segments.length;
      segment = roadRuntime.segments[segmentIndex];
      vehicle.distance += segment.length;
    }
    vehicle.segmentIndex = segmentIndex;
    const fraction = segment.length > 0 ? THREE.MathUtils.clamp(vehicle.distance / segment.length, 0, 1) : 0;
    const start = vehicle.direction === 1 ? segment.start : segment.end;
    const end = vehicle.direction === 1 ? segment.end : segment.start;
    const tangent = end.clone().sub(start).normalize();
    const yawTarget = Math.atan2(tangent.x, tangent.z);
    let yawDelta = yawTarget - vehicle.yaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    vehicle.yaw += yawDelta * 0.16;

    const position = start.clone().lerp(end, fraction);
    const leftNormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    position.add(leftNormal.multiplyScalar(vehicle.laneOffset));
    if (vehicle.type === 'bike') {
      const wobbleNormal = leftNormal.clone().multiplyScalar(Math.sin(vehicle.wobble) * 1.5);
      position.add(wobbleNormal);
    }
    position.y = 10 + (vehicle.type === 'bus' || vehicle.type === 'tanker' ? 6 : 0);
    return { position, tangent, roadHeight: ROAD_HEIGHTFor(roadRuntime.road.type) };
  }

  function ROAD_HEIGHTFor(type: Road['type']): number {
    return type === 'highway' ? 4 : type === 'arterial' ? 3 : 2;
  }

  useFrame((state, delta) => {
    const safeDelta = Math.min(delta, 0.05);
    const cameraHeight = camera.position.y;
    const bodyFade = THREE.MathUtils.clamp((2500 - cameraHeight) / 700, 0, 1);
    const lightFade = THREE.MathUtils.clamp((cameraHeight - 1800) / 700, 0, 1);
    currentBodyOpacity.current = THREE.MathUtils.damp(currentBodyOpacity.current, bodyFade, 5, delta);
    currentOverviewOpacity.current = THREE.MathUtils.damp(currentOverviewOpacity.current, lightFade, 5, delta);

    const typeOffsets: Record<VehicleType, number> = { car: 0, bike: 0, rickshaw: 0, bus: 0, tanker: 0 };
    let headIndex = 0;
    let tailIndex = 0;

    vehicles.forEach((vehicle) => {
      vehicle.distance += vehicle.speed * vehicle.direction * safeDelta;
      vehicle.wobble += safeDelta * 2.2;
      const computed = getVehiclePosition(vehicle);
      if (!computed) return;
      const { position, tangent, roadHeight } = computed;
      dummy.position.copy(position);
      dummy.position.y = roadHeight + 10 + (vehicle.type === 'bus' || vehicle.type === 'tanker' ? 6 : 0);
      dummy.rotation.set(0, vehicle.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lightMatrix.copy(dummy.matrix);

      const mesh = bodyRefs.current[vehicle.type];
      if (mesh) {
        const instanceIndex = typeOffsets[vehicle.type]++;
        mesh.setMatrixAt(instanceIndex, dummy.matrix);
        const selected = selectedRoadId === null || selectedRoadId === vehicle.roadId;
        const colour = getVehicleColor(vehicle);
        if (!selected) colour.multiplyScalar(0.35);
        mesh.setColorAt(instanceIndex, colour);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }

      const frontDistance = vehicle.type === 'bus' ? 5.8 * VEHICLE_SCALE : vehicle.type === 'tanker' ? 5.1 * VEHICLE_SCALE : vehicle.type === 'bike' ? 0.8 * VEHICLE_SCALE : vehicle.type === 'rickshaw' ? 1.4 * VEHICLE_SCALE : 2.25 * VEHICLE_SCALE;
      const rearDistance = -frontDistance;
      const sideWidth = vehicle.type === 'bus' ? 0.75 * VEHICLE_SCALE : vehicle.type === 'tanker' ? 0.75 * VEHICLE_SCALE : vehicle.type === 'rickshaw' ? 0.55 * VEHICLE_SCALE : 0.48 * VEHICLE_SCALE;
      const forwardX = vehicle.direction === 1 ? tangent.x : -tangent.x;
      const forwardZ = vehicle.direction === 1 ? tangent.z : -tangent.z;
      const forwardLength = Math.hypot(forwardX, forwardZ) || 1;
      const directedForwardX = forwardX / forwardLength;
      const directedForwardZ = forwardZ / forwardLength;
      const leftX = -directedForwardZ;
      const leftZ = directedForwardX;

      [-1, 1].forEach((side) => {
        const headPosition = position.clone();
        headPosition.x += directedForwardX * frontDistance + leftX * sideWidth * side;
        headPosition.z += directedForwardZ * frontDistance + leftZ * sideWidth * side;
        headPosition.y = roadHeight + 14;
        dummy.position.copy(headPosition);
        dummy.rotation.set(0, vehicle.yaw, 0);
        const overviewScale = 1 + currentOverviewOpacity.current * 1.8;
        dummy.scale.set(overviewScale, overviewScale, overviewScale);
        dummy.updateMatrix();
        if (headRef.current) {
          headRef.current.setMatrixAt(headIndex++, dummy.matrix);
        }

        const tailPosition = position.clone();
        tailPosition.x += directedForwardX * rearDistance + leftX * sideWidth * side;
        tailPosition.z += directedForwardZ * rearDistance + leftZ * sideWidth * side;
        tailPosition.y = roadHeight + 14;
        dummy.position.copy(tailPosition);
        dummy.rotation.set(0, vehicle.yaw, 0);
        dummy.scale.set(overviewScale, overviewScale, overviewScale);
        dummy.updateMatrix();
        if (tailRef.current) {
          tailRef.current.setMatrixAt(tailIndex++, dummy.matrix);
        }
      });
    });

    headCountRef.current = headIndex;
    tailCountRef.current = tailIndex;
    if (headRef.current) {
      headRef.current.count = headIndex;
      headRef.current.instanceMatrix.needsUpdate = true;
    }
    if (tailRef.current) {
      tailRef.current.count = tailIndex;
      tailRef.current.instanceMatrix.needsUpdate = true;
    }

    (Object.keys(bodyRefs.current) as VehicleType[]).forEach((type) => {
      const mesh = bodyRefs.current[type];
      if (!mesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.opacity = currentBodyOpacity.current;
    });
  });

  function getVehicleColor(vehicle: VehicleState): THREE.Color {
    if (vehicle.type === 'rickshaw') return tempColor.set('#2e9e57');
    if (vehicle.type === 'bus') {
      return tempColor.set(vehicle.colorSeed < 0.34 ? '#e84d3d' : vehicle.colorSeed < 0.67 ? '#2b7de9' : '#f2c230');
    }
    if (vehicle.type === 'tanker') return tempColor.set(vehicle.colorSeed < 0.5 ? '#2b7de9' : '#f7f7f2');
    if (vehicle.type === 'bike') return tempColor.set('#17191c');
    const colors = ['#f7f7f2', '#b9c1c8', '#17191c', '#c83232', '#376da8', '#7a1f1f'];
    return tempColor.set(colors[Math.min(colors.length - 1, Math.floor(vehicle.colorSeed * colors.length))]);
  }

  return (
    <group>
      {(Object.keys(geometries) as VehicleType[]).map((type) => (
        <instancedMesh
          key={type}
          ref={(mesh) => { bodyRefs.current[type] = mesh; }}
          args={[geometries[type], undefined, 4000]}
          castShadow
          frustumCulled={false}
        >
          <meshStandardMaterial
            vertexColors
            roughness={0.72}
            metalness={0.08}
            transparent
            opacity={1}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </instancedMesh>
      ))}
      <instancedMesh ref={headRef} args={[undefined, undefined, 8000]} frustumCulled={false}>
        <sphereGeometry args={[5, 6, 4]} />
        <meshBasicMaterial
          color={headlights}
          toneMapped={false}
          transparent
        />
      </instancedMesh>
      <instancedMesh ref={tailRef} args={[undefined, undefined, 8000]} frustumCulled={false}>
        <sphereGeometry args={[4.5, 6, 4]} />
        <meshBasicMaterial
          color={taillights}
          toneMapped={false}
          transparent
        />
      </instancedMesh>
    </group>
  );
}
