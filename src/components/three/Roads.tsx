'use client';

import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { LEVEL_COLOR } from '@/lib/api';
import type { Road, RushLevel } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { usePredictions } from './usePredictions';
import { useDaylight } from './useDaylight';

const VISUAL_WIDTH_SCALE = 4;
const DAY_ASPHALT = new THREE.Color('#5a5f6a');
const NIGHT_ASPHALT = new THREE.Color('#141b2d');

const ROAD_WIDTH: Record<Road['type'], number> = {
  highway: 40 * VISUAL_WIDTH_SCALE,
  arterial: 24 * VISUAL_WIDTH_SCALE,
  local: 14 * VISUAL_WIDTH_SCALE,
};

const ROAD_HEIGHT: Record<Road['type'], number> = {
  local: 2,
  arterial: 3,
  highway: 4,
};

interface RibbonGeometry {
  geometry: THREE.BufferGeometry;
  outlineGeometry: THREE.EdgesGeometry;
}

function LaneMarkings({ segments }: { segments: Road['segments'] }) {
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    segments.forEach((points) => {
      const cleaned = points.filter((point, index) => {
        if (index === 0) return true;
        const previous = points[index - 1];
        return Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 0.001;
      });
      for (let index = 0; index < cleaned.length - 1; index += 1) {
        const [ax, ay] = cleaned[index];
        const [bx, by] = cleaned[index + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;
        const dashLength = 90;
        const gapLength = 70;
        const nx = -dy / length;
        const ny = dx / length;
        const step = dashLength + gapLength;
        for (let distance = 0; distance < length; distance += step) {
          const start = THREE.MathUtils.clamp(distance, 0, length);
          const end = THREE.MathUtils.clamp(distance + dashLength, 0, length);
          const startX = ax + dx * (start / length);
          const startY = ay + dy * (start / length);
          const endX = ax + dx * (end / length);
          const endY = ay + dy * (end / length);
          [-1, 1].forEach((side) => {
            vertices.push(
              startX + nx * 18 * side, 1.1, -(startY + ny * 18 * side),
              endX + nx * 18 * side, 1.1, -(endY + ny * 18 * side),
            );
          });
        }
      }
    });
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return result;
  }, [segments]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} position={[0, 0.5, 0]}>
      <lineBasicMaterial color="#d7dde8" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

function buildRibbonGeometry(points: Road['segments'][number], width: number): RibbonGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const cleaned: Road['segments'][number] = [];
  points.forEach((point) => {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 0.001) {
      cleaned.push([point[0], point[1]]);
    }
  });
  if (cleaned.length < 2) return { geometry: new THREE.BufferGeometry(), outlineGeometry: new THREE.EdgesGeometry() };

  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) <= Math.max(width * 0.05, 0.01);
  if (closed) cleaned.pop();
  if (cleaned.length < 2) return { geometry: new THREE.BufferGeometry(), outlineGeometry: new THREE.EdgesGeometry() };

  cleaned.forEach((point, index) => {
    const previousIndex = closed ? (index - 1 + cleaned.length) % cleaned.length : Math.max(index - 1, 0);
    const nextIndex = closed ? (index + 1) % cleaned.length : Math.min(index + 1, cleaned.length - 1);
    const previous = cleaned[previousIndex];
    const next = cleaned[nextIndex];

    const inX = point[0] - previous[0];
    const inY = point[1] - previous[1];
    const outX = next[0] - point[0];
    const outY = next[1] - point[1];
    const inLength = Math.hypot(inX, inY) || 1;
    const outLength = Math.hypot(outX, outY) || 1;
    const inNormal: [number, number] = [-inY / inLength, inX / inLength];
    const outNormal: [number, number] = [-outY / outLength, outX / outLength];

    let miterX = (inNormal[0] + outNormal[0]) * 0.5;
    let miterY = (inNormal[1] + outNormal[1]) * 0.5;
    const miterLength = Math.hypot(miterX, miterY);
    if (miterLength < 0.001) {
      miterX = inNormal[0];
      miterY = inNormal[1];
    } else {
      miterX /= miterLength;
      miterY /= miterLength;
    }
    const denominator = miterX * inNormal[0] + miterY * inNormal[1];
    const rawScale = width * 0.5 / Math.max(Math.abs(denominator), 0.2);
    const scale = denominator >= 0.25
      ? THREE.MathUtils.clamp(rawScale, width * 0.5, width * 1.8)
      : width * 0.5;

    vertices.push(point[0] + miterX * scale, 0, -point[1] - miterY * scale);
    vertices.push(point[0] - miterX * scale, 0, -point[1] + miterY * scale);

    if (index < cleaned.length - 1 || closed) {
      const offset = index * 2;
      const nextOffset = closed && index === cleaned.length - 1 ? 0 : (index + 1) * 2;
      indices.push(offset, offset + 1, nextOffset, offset + 1, nextOffset + 1, nextOffset);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const outlineGeometry = new THREE.EdgesGeometry(geometry, 20);
  return { geometry, outlineGeometry };
}

function RoadRibbon({
  road,
  predictionLevel,
}: {
  road: Road;
  predictionLevel?: RushLevel;
}) {
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const daylight = useDaylight();
  const filter = useAppStore((state) => state.filter);
  const selectRoad = useAppStore((state) => state.selectRoad);
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const baseMaterials = useRef<THREE.MeshBasicMaterial[]>([]);
  const coreMaterials = useRef<THREE.MeshBasicMaterial[]>([]);
  const amberMaterials = useRef<THREE.MeshBasicMaterial[]>([]);
  const selectionOpacity = useRef(1);

  const baseWidth = ROAD_WIDTH[road.type] * 1.2;
  const coreWidth = Math.max(9, ROAD_WIDTH[road.type] * 0.34);
  const ribbons = useMemo(
    () => road.segments.map((points) => ({
      base: buildRibbonGeometry(points, baseWidth),
      core: buildRibbonGeometry(points, coreWidth),
      amber: buildRibbonGeometry(points, baseWidth + 44),
    })),
    [road, baseWidth, coreWidth],
  );

  useEffect(() => () => {
    ribbons.forEach(({ base, core, amber }) => {
      base.geometry.dispose();
      base.outlineGeometry.dispose();
      core.geometry.dispose();
      core.outlineGeometry.dispose();
      amber.geometry.dispose();
      amber.outlineGeometry.dispose();
    });
  }, [ribbons]);

  const selected = selectedRoadId === road.id;
  const level = predictionLevel ?? 'light';
  const visible = filter[level];
  const baseColor = LEVEL_COLOR[level];
  const roadHeight = ROAD_HEIGHT[road.type] + (selected ? 2 : 0);

  useEffect(() => {
    selectionOpacity.current = selectedRoadId === null ? 1 : selected ? 1 : 0.35;
  }, [selected, selectedRoadId]);

  useFrame((state, delta) => {
    const targetOpacity = selectedRoadId === null ? (visible ? 1 : 0.12) : selected ? (visible ? 1 : 0.12) : 0.35 * (visible ? 1 : 0.12);
    selectionOpacity.current = THREE.MathUtils.damp(selectionOpacity.current, targetOpacity, 4, delta);
    const darkness = daylight.darkness;
    baseMaterials.current.forEach((material) => {
      material.opacity = THREE.MathUtils.damp(material.opacity, selectionOpacity.current * 0.82, 6, delta);
      material.color.copy(DAY_ASPHALT).lerp(NIGHT_ASPHALT, darkness);
    });
    coreMaterials.current.forEach((material) => {
      const pulse = level === 'heavy'
        ? 0.82 + Math.sin(state.clock.elapsedTime * 2.4 + road.id.length) * 0.18
        : level === 'medium'
          ? 0.7 + Math.sin(state.clock.elapsedTime * 1.2 + road.id.length) * 0.08
          : 0.58;
      material.opacity = THREE.MathUtils.damp(material.opacity, selectionOpacity.current * pulse, 7, delta);
      material.opacity = THREE.MathUtils.damp(
        material.opacity,
        selectionOpacity.current * (0.58 - darkness * 0.12 + (darkness > 0.15 ? pulse * 0.42 : 0)),
        7,
        delta,
      );
    });
    amberMaterials.current.forEach((material) => {
      material.opacity = THREE.MathUtils.damp(material.opacity, selected ? 0.7 : 0, 7, delta);
    });
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    selectRoad(road.id);
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHovered(false);
    document.body.style.cursor = '';
  };

  return (
    <group ref={groupRef} position={[0, roadHeight, 0]}>
      {ribbons.map(({ base, core, amber }, index) => (
        <group key={`${road.id}-${index}`}>
          <mesh geometry={amber.geometry} renderOrder={-1}>
            <meshBasicMaterial
              ref={(material: THREE.MeshBasicMaterial | null) => {
                if (material) amberMaterials.current[index] = material;
              }}
              color="#ffb547"
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              polygonOffset
              polygonOffsetFactor={-5}
              polygonOffsetUnits={-5}
            />
          </mesh>
          <mesh
            geometry={base.geometry}
            position={[0, 0, 0]}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={2}
          >
            <meshBasicMaterial
              ref={(material: THREE.MeshBasicMaterial | null) => {
                if (material) baseMaterials.current[index] = material;
              }}
              color="#141b2d"
              fog={false}
              transparent
              opacity={visible ? 0.82 : 0.12}
              depthWrite
              polygonOffset
              polygonOffsetFactor={-3}
              polygonOffsetUnits={-3}
            />
          </mesh>
          <mesh
            geometry={core.geometry}
            position={[0, 0.5, 0]}
            onClick={handleClick}
            renderOrder={3}
          >
            <meshBasicMaterial
              ref={(material: THREE.MeshBasicMaterial | null) => {
                if (material) coreMaterials.current[index] = material;
              }}
              color={hovered ? '#ffb547' : baseColor}
              fog={false}
              toneMapped={false}
              transparent
              opacity={visible ? 0.58 : 0.08}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-6}
              polygonOffsetUnits={-6}
            />
          </mesh>
        </group>
      ))}
      {(road.type === 'highway' || road.type === 'arterial') && (
        <LaneMarkings segments={road.segments} />
      )}
      {selected && (
        <Html
          position={[road.center[0], 180, -road.center[1]]}
          center
          distanceFactor={2200}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ background: 'rgba(11,18,32,.92)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, color: 'white', padding: '4px 8px', fontSize: 12, fontWeight: 600 }}>
              {road.name}
            </span>
            <span style={{ background: LEVEL_COLOR[level], borderRadius: 999, color: '#0b1220', padding: '4px 8px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
              {level}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

export function Roads() {
  const roads = useAppStore((state) => state.roads);
  const selectedTime = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
  const predictions = usePredictions(roads, selectedTime, rain);
  return (
    <group>
      {roads.map((road) => (
        <RoadRibbon
          key={road.id}
          road={road}
          predictionLevel={predictions.get(road.id)?.nowLevel}
        />
      ))}
    </group>
  );
}
