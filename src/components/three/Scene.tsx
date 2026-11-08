'use client';

import { Canvas } from '@react-three/fiber';
import { Grid, MapControls } from '@react-three/drei';
import { Roads } from './Roads';
import { Vehicles } from './Vehicles';
import { useAppStore } from '@/store/useAppStore';

export function Scene() {
  const selectRoad = useAppStore((state) => state.selectRoad);

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
        position={[0, -1, 0]}
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          selectRoad(null);
        }}
      >
        <planeGeometry args={[50000, 50000]} />
        <meshStandardMaterial color="#101a2d" roughness={1} />
      </mesh>
      <Grid
        position={[0, -0.5, 0]}
        args={[20000, 20000]}
        cellSize={500}
        cellThickness={0.6}
        cellColor="#1d3150"
        sectionSize={2000}
        sectionThickness={1.2}
        sectionColor="#294469"
        fadeDistance={18000}
        fadeStrength={1.5}
        infiniteGrid
      />

      <Roads />
      <Vehicles />
      {/* CameraRig will be rendered here. */}

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
