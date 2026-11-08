'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, MapControls } from '@react-three/drei';
import { Roads } from './Roads';
import { Vehicles } from './Vehicles';
import { useAppStore } from '@/store/useAppStore';
import { CameraRig } from './CameraRig';

export function Scene() {
  const selectRoad = useAppStore((state) => state.selectRoad);
  const roads = useAppStore((state) => state.roads);
  const ground = useMemo(() => {
    if (roads.length === 0) return { centerX: 0, centerZ: 0, width: 50000, depth: 50000, margin: 5000 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    roads.forEach((road) => {
      road.segments.forEach((segment) => {
        segment.forEach(([x, y]) => {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        });
      });
    });
    const margin = 5000;
    const rawMinX = minX - margin;
    const rawMaxX = maxX + margin;
    const rawMinY = minY - margin;
    const rawMaxY = maxY + margin;
    return {
      centerX: (rawMinX + rawMaxX) * 0.5,
      centerZ: -(rawMinY + rawMaxY) * 0.5,
      width: rawMaxX - rawMinX,
      depth: rawMaxY - rawMinY,
      margin,
    };
  }, [roads]);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 6000, 7000], fov: 45, near: 10, far: 100000 }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      style={{ background: '#0b1220' }}
      onPointerMissed={() => selectRoad(null)}
    >
      <color attach="background" args={['#0b1220']} />
      <fog attach="fog" args={['#0b1220', 20000, 80000]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[5000, 12000, 5000]} intensity={1.2} />

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[ground.centerX, -1, ground.centerZ]}
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          selectRoad(null);
        }}
      >
        <planeGeometry args={[ground.width, ground.depth]} />
        <meshStandardMaterial color="#101a2d" roughness={1} />
      </mesh>
      <Grid
        position={[ground.centerX, -0.5, ground.centerZ]}
        args={[ground.width, ground.depth]}
        cellSize={500}
        cellThickness={0.6}
        cellColor="#1d3150"
        sectionSize={2000}
        sectionThickness={1.2}
        sectionColor="#294469"
        fadeDistance={Math.max(ground.width, ground.depth) * 0.45}
        fadeStrength={1.5}
        infiniteGrid
      />

      <Roads />
      <Vehicles />
      <CameraRig />

      <MapControls
        makeDefault
        target={[0, 0, 0]}
        minDistance={1200}
        maxDistance={30000}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2 - 0.05}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
