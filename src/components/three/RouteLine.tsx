'use client';

import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { viewDistance } from './usePerformance';
import { useMemo, useRef } from 'react';
import type { Line2 } from 'three-stdlib';
import { useAppStore } from '@/store/useAppStore';

const ROUTE_BLUE = '#7cc4ff';
const ROUTE_Y = 8;
/** How fast the dashes travel along the line (world units per second). */
const DASH_SPEED = 260;

/** Blue dashed "better route" line, shown when showRoute && altRoute. */
export function RouteLine() {
  const altRoute = useAppStore((state) => state.altRoute);
  const showRoute = useAppStore((state) => state.showRoute);
  const dashRef = useRef<Line2>(null);
  const markers = useRef<Array<THREE.Mesh | null>>([]);
  const controls = useThree((s) => s.controls);

  const points = useMemo(
    () => (altRoute ? altRoute.path.map(([x, y]) => [x, ROUTE_Y, -y] as [number, number, number]) : []),
    [altRoute],
  );

  useFrame(({ camera }, delta) => {
    const line = dashRef.current;
    if (!line) return;
    // Dashes and end markers keep about the same size on screen at every zoom
    const zoom = THREE.MathUtils.clamp(viewDistance(camera, controls) / 9000, 0.1, 1.3);
    line.material.dashSize = 180 * zoom;
    line.material.gapSize = 110 * zoom;
    // Negative offset makes the dashes move from start to end of the route
    line.material.dashOffset -= delta * DASH_SPEED * zoom;
    markers.current.forEach((m) => m?.scale.setScalar(zoom));
  });

  if (!showRoute || points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <group renderOrder={20}>
      {/* Soft glow under the dashes */}
      <Line
        points={points}
        color={ROUTE_BLUE}
        lineWidth={16}
        transparent
        opacity={0.35}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        renderOrder={20}
      />
      {/* Animated dashed line */}
      <Line
        ref={dashRef}
        points={points}
        color={ROUTE_BLUE}
        lineWidth={6}
        dashed
        dashSize={180}
        gapSize={110}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        renderOrder={21}
      />
      {/* Start and end markers */}
      {[first, last].map((p, i) => (
        <mesh
          key={i}
          position={p}
          renderOrder={22}
          ref={(m) => {
            markers.current[i] = m;
          }}
        >
          <sphereGeometry args={[70, 20, 14]} />
          <meshBasicMaterial color={ROUTE_BLUE} depthTest={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
