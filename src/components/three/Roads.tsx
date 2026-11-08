'use client';

import { Html } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { LEVEL_COLOR } from '@/lib/api';
import type { Road, RushLevel } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { usePredictions } from './usePredictions';

const VISUAL_WIDTH_SCALE = 4;

const ROAD_WIDTH: Record<Road['type'], number> = {
  highway: 40 * VISUAL_WIDTH_SCALE,
  arterial: 24 * VISUAL_WIDTH_SCALE,
  local: 14 * VISUAL_WIDTH_SCALE,
};

interface RibbonGeometry {
  geometry: THREE.BufferGeometry;
  outlineGeometry: THREE.EdgesGeometry;
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
  const filter = useAppStore((state) => state.filter);
  const selectRoad = useAppStore((state) => state.selectRoad);
  const [hovered, setHovered] = useState(false);

  const ribbons = useMemo(
    () => road.segments.map((points) => buildRibbonGeometry(points, ROAD_WIDTH[road.type])),
    [road],
  );

  useEffect(() => () => {
    ribbons.forEach(({ geometry, outlineGeometry }) => {
      geometry.dispose();
      outlineGeometry.dispose();
    });
  }, [ribbons]);

  useEffect(() => {
    if (!hovered) return;
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered]);

  const selected = selectedRoadId === road.id;
  const level = predictionLevel ?? 'light';
  const visible = filter[level];
  const baseColor = LEVEL_COLOR[level];
  const displayColor = useMemo(() => {
    const color = new THREE.Color(baseColor);
    if (selected) return color;
    if (hovered) color.offsetHSL(0, -0.05, 0.16);
    else color.multiplyScalar(0.72);
    return `#${color.getHexString()}`;
  }, [baseColor, hovered, selected]);

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
    <group position={[0, 2, 0]}>
      {ribbons.map(({ geometry, outlineGeometry }, index) => (
        <group key={`${road.id}-${index}`}>
          <mesh
            geometry={geometry}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
          >
            <meshBasicMaterial
              color={displayColor}
              fog={false}
              toneMapped={false}
              transparent={!visible}
              opacity={visible ? 1 : 0.12}
              depthWrite
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </mesh>
          {selected && (
            <lineSegments geometry={outlineGeometry}>
              <lineBasicMaterial color="#ffb547" toneMapped={false} />
            </lineSegments>
          )}
        </group>
      ))}
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
