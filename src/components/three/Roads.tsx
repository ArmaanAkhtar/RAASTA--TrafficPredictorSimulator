'use client';

import { Html } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { LEVEL_COLOR } from '@/lib/api';
import type { Road, RushLevel } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { usePredictions } from './usePredictions';
import { useDaylight, type DaylightState } from './useDaylight';
import { useSettledTime, viewDistance } from './usePerformance';

const VISUAL_WIDTH_SCALE = 4;
/** A click only selects a road if the pointer moved less than this between down and up. */
const CLICK_MAX_DRAG_PX = 5;
const DAY_ASPHALT = new THREE.Color('#4b5160');
const NIGHT_ASPHALT = new THREE.Color('#141b2d');

const ROAD_WIDTH: Record<Road['type'], number> = {
  highway: 40 * VISUAL_WIDTH_SCALE,
  arterial: 24 * VISUAL_WIDTH_SCALE,
  local: 14 * VISUAL_WIDTH_SCALE,
};

/**
 * Road width follows the zoom: full (wide, easy to see) for the whole city, down to ~real width when you
 * zoom into the streets, so the galiyan next to a road stay visible. One shared value for every road,
 * applied in the vertex shader (no geometry rebuild).
 */
const WIDTH_SCALE = { value: 1 };
const MIN_WIDTH_SCALE = 0.14;
const FULL_WIDTH_AT = 14000; // view distance (m) where roads get their full width

type CompileShader = Parameters<THREE.Material['onBeforeCompile']>[0];
function scaleWidthWithZoom(shader: CompileShader) {
  shader.uniforms.uWidthScale = WIDTH_SCALE;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aOffset;\nuniform float uWidthScale;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed.x -= aOffset.x * (1.0 - uWidthScale);\ntransformed.z -= aOffset.y * (1.0 - uWidthScale);',
    );
}

/** Distance (m) from a map point to a road's centre line. */
function distanceToRoad(road: Road, x: number, y: number): number {
  let best = Infinity;
  for (const seg of road.segments) {
    for (let i = 1; i < seg.length; i += 1) {
      const [ax, ay] = seg[i - 1];
      const [bx, by] = seg[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
  }
  return best;
}

const ROAD_HEIGHT: Record<Road['type'], number> = {
  local: 2,
  arterial: 3,
  highway: 4,
};

interface RibbonGeometry {
  geometry: THREE.BufferGeometry;
}

/**
 * Builds one ribbon per segment and merges them into ONE geometry per road,
 * so each road is 1 draw call per layer instead of 1 per segment (was ~7000 draw calls per frame).
 */
function buildMergedRibbon(segments: Road['segments'], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const offsets: number[] = [];
  const indices: number[] = [];
  segments.forEach((points) => {
    const { geometry } = buildRibbonGeometry(points, width);
    const attr = geometry.getAttribute('position');
    const off = geometry.getAttribute('aOffset');
    const index = geometry.getIndex();
    if (attr && off && index) {
      const offset = positions.length / 3;
      for (let i = 0; i < attr.count; i += 1) {
        positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
        offsets.push(off.getX(i), off.getY(i));
      }
      for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + offset);
    }
    geometry.dispose();
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 2));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}

function buildRibbonGeometry(points: Road['segments'][number], width: number): RibbonGeometry {
  const vertices: number[] = [];
  const offsets: number[] = []; // each vertex's offset from the centre line (x, z), for zoom-dependent width
  const indices: number[] = [];
  const cleaned: Road['segments'][number] = [];
  points.forEach((point) => {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 0.001) {
      cleaned.push([point[0], point[1]]);
    }
  });
  if (cleaned.length < 2) return { geometry: new THREE.BufferGeometry() };

  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) <= Math.max(width * 0.05, 0.01);
  if (closed) cleaned.pop();
  if (cleaned.length < 2) return { geometry: new THREE.BufferGeometry() };

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
    offsets.push(miterX * scale, -miterY * scale, -miterX * scale, miterY * scale);

    if (index < cleaned.length - 1 || closed) {
      const offset = index * 2;
      const nextOffset = closed && index === cleaned.length - 1 ? 0 : (index + 1) * 2;
      indices.push(offset, offset + 1, nextOffset, offset + 1, nextOffset + 1, nextOffset);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 2));
  geometry.setIndex(indices);
  return { geometry };
}

// memo: when the time changes only roads whose level actually changed re-render
const RoadRibbon = memo(function RoadRibbon({
  road,
  predictionLevel,
  daylight,
  hd,
}: {
  road: Road;
  predictionLevel?: RushLevel;
  daylight: DaylightState; // one shared, mutable daylight object for all roads (was one hook per road)
  hd: boolean; // high graphics: lane markings + pulsing glow
}) {
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const filter = useAppStore((state) => state.filter);
  const selectRoad = useAppStore((state) => state.selectRoad);
  const [hovered, setHovered] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<[number, number] | null>(null); // world x, z
  const groupRef = useRef<THREE.Group>(null);
  const baseMaterials = useRef<THREE.MeshBasicMaterial[]>([]);
  const coreMaterials = useRef<THREE.MeshBasicMaterial[]>([]);
  const selectionMaterials = useRef<THREE.MeshBasicMaterial[]>([]);
  const glowMesh = useRef<THREE.Mesh>(null);
  const selectionOpacity = useRef(1);

  const baseWidth = ROAD_WIDTH[road.type] * 1.2;
  const coreWidth = Math.max(14, ROAD_WIDTH[road.type] * 0.55); // rush colour strip: wide enough to read
  const ribbon = useMemo(
    () => ({
      base: buildMergedRibbon(road.segments, baseWidth),
      core: buildMergedRibbon(road.segments, coreWidth),
      glow: buildMergedRibbon(road.segments, baseWidth + 90), // selection glow, coloured by rush level
    }),
    [road, baseWidth, coreWidth],
  );

  useEffect(() => () => {
    ribbon.base.dispose();
    ribbon.core.dispose();
    ribbon.glow.dispose();
  }, [ribbon]);

  const selected = selectedRoadId === road.id;
  const level = predictionLevel ?? 'light';
  const visible = filter[level];
  const baseColor = LEVEL_COLOR[level];
  const roadHeight = ROAD_HEIGHT[road.type] + (selected ? 2 : 0);

  useEffect(() => {
    selectionOpacity.current = selectedRoadId === null ? 1 : selected ? 1 : 0.35;
  }, [selected, selectedRoadId]);

  useFrame((state, delta) => {
    // Other roads dim (not vanish) while one is selected, so the selected one pops
    const targetOpacity = selectedRoadId === null ? (visible ? 1 : 0.12) : selected ? (visible ? 1 : 0.12) : 0.4 * (visible ? 1 : 0.12);
    selectionOpacity.current = THREE.MathUtils.damp(selectionOpacity.current, targetOpacity, 4, delta);
    const darkness = daylight.darkness;
    const t = state.clock.elapsedTime + road.id.length;
    baseMaterials.current.forEach((material) => {
      material.opacity = THREE.MathUtils.damp(material.opacity, selectionOpacity.current * 0.9, 6, delta);
      material.color.copy(DAY_ASPHALT).lerp(NIGHT_ASPHALT, darkness);
    });
    // Rush strip: clearly visible by day, glowing (and pulsing when heavy) by night
    const pulse = !hd
      ? 1
      : level === 'heavy'
        ? 0.85 + Math.sin(t * 2.4) * 0.15
        : level === 'medium'
          ? 0.92 + Math.sin(t * 1.2) * 0.08
          : 1;
    const stripOpacity = (selected ? 1 : THREE.MathUtils.lerp(0.85, 0.95, darkness)) * pulse;
    coreMaterials.current.forEach((material) => {
      material.opacity = THREE.MathUtils.damp(material.opacity, selectionOpacity.current * stripOpacity, 7, delta);
    });
    // Selection glow in the road's rush colour (red heavy / medium / green light), breathing
    const glowTarget = selected && visible ? (level === 'heavy' ? 0.55 + Math.sin(t * 3) * 0.2 : 0.55) : 0;
    selectionMaterials.current.forEach((material) => {
      material.opacity = THREE.MathUtils.damp(material.opacity, glowTarget, 7, delta);
    });
    if (glowMesh.current) glowMesh.current.visible = (selectionMaterials.current[0]?.opacity ?? 0) > 0.01;
  });

  // The click/hover mesh is the full-width ribbon; when zoomed in the road is drawn narrower, so only
  // count the pointer if it is on the part that is actually visible (otherwise a gali next to it would pick it)
  const onVisibleRoad = (p: THREE.Vector3) => distanceToRoad(road, p.x, -p.z) <= (baseWidth / 2) * WIDTH_SCALE.value + 8;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!visible || !onVisibleRoad(event.point)) return; // filtered-out roads are not clickable
    event.stopPropagation();
    if (event.delta > CLICK_MAX_DRAG_PX) return; // the user was dragging the map
    selectRoad(road.id);
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (!visible || !onVisibleRoad(event.point)) return; // filtered-out roads are not hoverable
    event.stopPropagation();
    setHovered(true);
    setHoverPoint([event.point.x, event.point.z]);
    document.body.style.cursor = 'pointer';
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!visible) return;
    if (!onVisibleRoad(event.point)) {
      if (hovered) {
        setHovered(false);
        setHoverPoint(null);
        document.body.style.cursor = '';
      }
      return;
    }
    if (!hovered) {
      handlePointerOver(event);
      return;
    }
    event.stopPropagation();
    // Move the tooltip only when the pointer travelled a bit (avoids a re-render every pixel)
    const [px, pz] = hoverPoint ?? [0, 0];
    if (Math.hypot(event.point.x - px, event.point.z - pz) > 60) setHoverPoint([event.point.x, event.point.z]);
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHovered(false);
    setHoverPoint(null);
    document.body.style.cursor = '';
  };

  // If a hovered road gets filtered out, drop the hover state
  const showHover = hovered && visible;

  return (
    <group ref={groupRef} position={[0, roadHeight, 0]}>
      <group>
          <mesh geometry={ribbon.glow} ref={glowMesh} renderOrder={-1}>
            <meshBasicMaterial
              ref={(material: THREE.MeshBasicMaterial | null) => {
                if (material) selectionMaterials.current[0] = material;
              }}
              onBeforeCompile={scaleWidthWithZoom}
              color={baseColor}
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
            geometry={ribbon.base}
            position={[0, 0, 0]}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerMove={handlePointerMove}
            onPointerOut={handlePointerOut}
            renderOrder={2}
          >
            <meshBasicMaterial
              ref={(material: THREE.MeshBasicMaterial | null) => {
                if (material) baseMaterials.current[0] = material;
              }}
              onBeforeCompile={scaleWidthWithZoom}
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
            geometry={ribbon.core}
            position={[0, 0.5, 0]}
            raycast={() => null /* clicks/hover handled by the wider base ribbon underneath */}
            renderOrder={3}
          >
            <meshBasicMaterial
              ref={(material: THREE.MeshBasicMaterial | null) => {
                if (material) coreMaterials.current[0] = material;
              }}
              onBeforeCompile={scaleWidthWithZoom}
              color={showHover ? '#7cc4ff' : baseColor}
              fog={false}
              toneMapped={false}
              transparent
              opacity={visible ? 0.9 : 0.08}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-6}
              polygonOffsetUnits={-6}
            />
          </mesh>
        </group>
      {showHover && !selected && hoverPoint && (
        <Html
          position={[hoverPoint[0], 120 - roadHeight, hoverPoint[1]]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{ transform: 'translate(14px, 14px)', background: 'rgba(15,23,41,.92)', border: '1px solid #1f2a44', borderRadius: 8, color: '#f6f2ea', padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap', boxShadow: '0 12px 32px rgba(0,0,0,.24)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: baseColor, display: 'inline-block' }} />
              {road.name}
            </div>
            <div style={{ color: '#94a3b8', marginTop: 2 }}>Click for details</div>
          </div>
        </Html>
      )}
      {selected && (
        <Html
          position={[road.center[0], 180, -road.center[1]]}
          center
          distanceFactor={2200}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ background: 'rgba(15,23,41,.92)', border: '1px solid #1f2a44', borderRadius: 8, color: '#f6f2ea', padding: '4px 8px', fontSize: 12, fontWeight: 600 }}>
              {road.name}
            </span>
            <span style={{ background: '#7cc4ff', borderRadius: 8, color: '#0b1220', padding: '4px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
              {level}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
});

export function Roads() {
  const roads = useAppStore((state) => state.roads);
  // Short delay so colours follow the slider without re-rendering the city on every step
  const selectedTime = useSettledTime(120);
  const predictions = usePredictions(roads, selectedTime);
  const daylight = useDaylight();
  const hd = true; // single quality: pulsing rush glow for everyone
  const controls = useThree((s) => s.controls);
  useFrame(({ camera }, delta) => {
    const target = THREE.MathUtils.clamp(viewDistance(camera, controls) / FULL_WIDTH_AT, MIN_WIDTH_SCALE, 1);
    WIDTH_SCALE.value = THREE.MathUtils.damp(WIDTH_SCALE.value, target, 8, delta);
  });
  return (
    <group>
      {roads.map((road) => (
        <RoadRibbon
          key={road.id}
          road={road}
          predictionLevel={predictions.get(road.id)?.nowLevel}
          daylight={daylight}
          hd={hd}
        />
      ))}
    </group>
  );
}
