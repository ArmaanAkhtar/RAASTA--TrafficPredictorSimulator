'use client';

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { viewDistance } from './usePerformance';
import { useRef } from 'react';
import * as THREE from 'three';
import { useLocationStore } from '@/lib/location';

const BLUE = '#7cc4ff';

/** Pulsing "you are here" dot with an accuracy halo. */
export function UserLocation() {
  const point = useLocationStore((s) => s.point);
  const accuracy = useLocationStore((s) => s.accuracyM);
  const ring = useRef<THREE.Mesh>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const dot = useRef<THREE.Group>(null);
  const controls = useThree((s) => s.controls);

  useFrame((state) => {
    // The dot keeps about the same size on screen: small when zoomed into the galiyan
    if (dot.current) {
      const zoom = THREE.MathUtils.clamp(viewDistance(state.camera, controls) / 9000, 0.06, 1.3);
      dot.current.scale.setScalar(zoom);
    }
    const t = (state.clock.elapsedTime % 1.8) / 1.8; // 0..1 pulse
    if (ring.current) ring.current.scale.setScalar(1 + t * 2.2);
    if (ringMaterial.current) ringMaterial.current.opacity = 0.55 * (1 - t);
  });

  if (!point) return null;
  // GPS accuracy circle in real metres, only when the fix is rough (faint, never bigger than 600 m)
  const halo = accuracy !== null && accuracy > 40 ? Math.min(accuracy, 600) : 0;

  return (
    <group position={[point[0], 12, -point[1]]} renderOrder={30}>
      {/* accuracy halo */}
      {halo > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[halo, 48]} />
          <meshBasicMaterial color={BLUE} transparent opacity={0.07} depthWrite={false} depthTest={false} toneMapped={false} />
        </mesh>
      )}
      <group ref={dot}>
      {/* pulse ring */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[90, 120, 48]} />
        <meshBasicMaterial ref={ringMaterial} color={BLUE} transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
      {/* white rim + blue dot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[95, 40]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1, 0]}>
        <circleGeometry args={[70, 40]} />
        <meshBasicMaterial color={BLUE} depthTest={false} toneMapped={false} />
      </mesh>
      </group>
      <Html center zIndexRange={[11, 0]} style={{ pointerEvents: 'none' }}>
        <div className="-translate-y-6 whitespace-nowrap rounded-md border border-[#1f2a44] bg-[#0f1729]/92 px-2 py-0.5 text-[11px] font-semibold text-[#7cc4ff]">
          You are here
        </div>
      </Html>
    </group>
  );
}
