'use client';

import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadCameras } from '@/lib/api';
import type { CameraInfo } from '@/lib/cameras';
import { useAppStore } from '@/store/useAppStore';

const AMBER = '#ffb547';
const PIN_HEIGHT = 420; // big enough to see at city zoom
const CLICK_MAX_DRAG_PX = 5;
// Pins keep about the same size on screen: full size at city zoom, small when you zoom into the streets
const SIZE_AT_DISTANCE = 9000;
const MIN_SCALE = 0.1;
const MAX_SCALE = 1.3;

function Pin({ cam }: { cam: CameraInfo }) {
  const openCamera = useAppStore((state) => state.openCamera);
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const hoverScale = useRef(1);
  const [worldPos] = useState(() => new THREE.Vector3(cam.position[0], 0, -cam.position[1]));
  const [labelY, setLabelY] = useState(PIN_HEIGHT * 1.35);

  useFrame(({ camera }, delta) => {
    const g = groupRef.current;
    if (!g) return;
    hoverScale.current = THREE.MathUtils.damp(hoverScale.current, hovered ? 1.3 : 1, 10, delta);
    const zoomScale = THREE.MathUtils.clamp(camera.position.distanceTo(worldPos) / SIZE_AT_DISTANCE, MIN_SCALE, MAX_SCALE);
    g.scale.setScalar(zoomScale * hoverScale.current);
    if (hovered) {
      const y = PIN_HEIGHT * 1.35 * zoomScale;
      if (Math.abs(y - labelY) > 5) setLabelY(y);
    }
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'pointer';
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation(); // never select the road under the pin
    if (e.delta > CLICK_MAX_DRAG_PX) return; // it was a drag, not a click
    openCamera(cam.id);
  };

  return (
    <group position={[cam.position[0], 0, -cam.position[1]]}>
      <group ref={groupRef} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
        {/* Cone pointing down, sphere on top */}
        <mesh position={[0, PIN_HEIGHT * 0.45, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[80, PIN_HEIGHT * 0.7, 16]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>
        <mesh position={[0, PIN_HEIGHT * 0.9, 0]}>
          <sphereGeometry args={[110, 20, 14]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>
        <mesh position={[0, PIN_HEIGHT * 0.9, 0]}>
          <sphereGeometry args={[48, 16, 12]} />
          <meshBasicMaterial color="#0b1220" toneMapped={false} />
        </mesh>
      </group>
      {hovered && (
        <Html position={[0, labelY, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-lg border border-white/10 bg-[#0b1220]/90 px-2.5 py-1.5 text-xs text-slate-100 shadow-lg">
            <div className="font-semibold">{cam.name}</div>
            <div className="text-slate-400">{cam.roadName}</div>
            <div className="text-[#ffb547]">Traffic camera · click to view</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/** Amber camera pins from loadCameras(); click opens the CameraModal. */
export function CameraPins() {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);

  useEffect(() => {
    let alive = true;
    loadCameras()
      .then((list) => {
        if (alive) setCameras(list);
      })
      .catch(() => {
        // cameras.json missing: simply no pins
      });
    return () => {
      alive = false;
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <group>
      {cameras.map((cam) => (
        <Pin key={cam.id} cam={cam} />
      ))}
    </group>
  );
}
