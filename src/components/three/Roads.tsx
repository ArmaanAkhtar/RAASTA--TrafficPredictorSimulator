'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { LEVEL_COLOR, predict } from '@/lib/api';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';

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

  for (let index = 0; index < points.length; index += 1) {
    let tangentX: number;
    let tangentY: number;

    if (index === 0) {
      tangentX = points[1][0] - points[0][0];
      tangentY = points[1][1] - points[0][1];
    } else if (index === points.length - 1) {
      tangentX = points[index][0] - points[index - 1][0];
      tangentY = points[index][1] - points[index - 1][1];
    } else {
      tangentX = points[index + 1][0] - points[index - 1][0];
      tangentY = points[index + 1][1] - points[index - 1][1];
    }

    const tangentLength = Math.hypot(tangentX, tangentY) || 1;
    const normalX = -tangentY / tangentLength;
    const normalY = tangentX / tangentLength;

    const [pointX, pointY] = points[index];
    vertices.push(pointX + normalX * width * 0.5, 0, -pointY - normalY * width * 0.5);
    vertices.push(pointX - normalX * width * 0.5, 0, -pointY + normalY * width * 0.5);

    if (index < points.length - 1) {
      const offset = index * 2;
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const outlineGeometry = new THREE.EdgesGeometry(geometry, 20);
  return { geometry, outlineGeometry };
}

function RoadRibbon({ road }: { road: Road }) {
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const selectedTime = useAppStore((state) => state.selectedTime);
  const rain = useAppStore((state) => state.rain);
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
  const prediction = predict(road, selectedTime, rain);
  const baseColor = LEVEL_COLOR[prediction.nowLevel];
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
    </group>
  );
}

export function Roads() {
  const roads = useAppStore((state) => state.roads);
  return (
    <group>
      {roads.map((road) => (
        <RoadRibbon key={road.id} road={road} />
      ))}
    </group>
  );
}
