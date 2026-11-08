'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, MapControls } from '@react-three/drei';
import { Roads } from './Roads';
import { Vehicles } from './Vehicles';
import { useAppStore } from '@/store/useAppStore';
import { CameraRig } from './CameraRig';
import { Buildings } from './Buildings';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

export function Scene() {
  const selectRoad = useAppStore((state) => state.selectRoad);
  const roads = useAppStore((state) => state.roads);
  const lowGraphics = useAppStore((state) => state.lowGraphics);
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
      dpr={[1, 1.75]}
      camera={{ position: [0, 6000, 7000], fov: 45, near: 10, far: 100000 }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      style={{ background: '#05080f' }}
      onPointerMissed={() => selectRoad(null)}
    >
      <color attach="background" args={['#05080f']} />
      <fog attach="fog" args={['#05080f', 30000, 90000]} />
      <hemisphereLight args={['#7cc4ff', '#05080f', 0.28]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[5000, 12000, 5000]} intensity={0.75} color="#ffd6a1" />

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
        <meshStandardMaterial color="#070b16" roughness={1} metalness={0.05} />
      </mesh>
      <Grid
        position={[ground.centerX, -0.5, ground.centerZ]}
        args={[ground.width, ground.depth]}
        cellSize={500}
        cellThickness={0.35}
        cellColor="#101a2d"
        sectionSize={2000}
        sectionThickness={0.55}
        sectionColor="#16243a"
        fadeDistance={Math.max(ground.width, ground.depth) * 0.45}
        fadeStrength={1.5}
        infiniteGrid
      />

      <Roads />
      <Vehicles />
      <Buildings />
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
      {!lowGraphics && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.2} luminanceSmoothing={0.2} intensity={1} />
          <Vignette eskil={false} offset={0.12} darkness={0.55} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
