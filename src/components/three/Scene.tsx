'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, MapControls } from '@react-three/drei';
import { Roads } from './Roads';
import { Streets } from './Streets';
import { PlaceLabels } from './PlaceLabels';
import { useAppStore } from '@/store/useAppStore';
import { CameraRig } from './CameraRig';
import { RouteLine } from './RouteLine';
import { CameraPins } from './CameraPins';
import { UserLocation } from './UserLocation';
import { isWeakDevice } from './usePerformance';
import { useDaylight } from './useDaylight';
import { projectLatLon } from '@/lib/projection';
import * as THREE from 'three';

function SceneReadiness() {
  const gl = useThree((state) => state.gl);
  const roadsReady = useAppStore((state) => state.roads.length > 0);
  const setSceneReady = useAppStore((state) => state.setSceneReady);

  useEffect(() => {
    if (roadsReady && gl.domElement) setSceneReady(true);
  }, [gl, roadsReady, setSceneReady]);

  return null;
}

const MAP_NAVY = new THREE.Color('#0b1220');
const COASTLINE_LAT_LON = [
  [24.84, 66.8],
  [24.835, 66.86],
  [24.825, 66.92],
  [24.815, 66.98],
  [24.805, 67.03],
  [24.795, 67.08],
  [24.785, 67.14],
  [24.78, 67.2],
  [24.785, 67.27],
  [24.79, 67.34],
  [24.78, 67.4],
] as const;

function configureMapBackground(scene: THREE.Scene): () => void {
  scene.background = MAP_NAVY;
  return () => {
    scene.background = null;
  };
}

interface GroundBounds {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  maxDistance: number;
  fogNear: number;
  fogFar: number;
}

function DaylightRig({ ground }: { ground: GroundBounds }) {
  const daylight = useDaylight();
  const scene = useThree((state) => state.scene);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemisphere = useRef<THREE.HemisphereLight>(null);
  const seaGeometry = useMemo(() => {
    const coastline = COASTLINE_LAT_LON.map(([lat, lon]) => projectLatLon(lat, lon));
    const west = ground.centerX - ground.width * 2;
    const east = ground.centerX + ground.width * 2;
    const south = -ground.centerZ - ground.depth * 2;
    const shape = new THREE.Shape();
    shape.moveTo(west, coastline[0][1]);
    coastline.forEach(([x, y]) => shape.lineTo(x, y));
    shape.lineTo(east, coastline[coastline.length - 1][1]);
    shape.lineTo(east, south);
    shape.lineTo(west, south);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [ground]);

  useEffect(() => {
    return configureMapBackground(scene);
  }, [scene]);

  useEffect(() => () => seaGeometry.dispose(), [seaGeometry]);

  useFrame(() => {
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(MAP_NAVY);
    if (sun.current) {
      sun.current.position.copy(daylight.sunDirection).multiplyScalar(12000);
      sun.current.color.copy(daylight.sunColor);
      sun.current.intensity = daylight.sunIntensity;
    }
    if (hemisphere.current) {
      hemisphere.current.intensity = daylight.ambientIntensity;
      hemisphere.current.color.copy(daylight.skyColor);
      hemisphere.current.groundColor.copy(daylight.groundColor);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemisphere} args={[daylight.skyColor, daylight.groundColor, daylight.ambientIntensity]} />
      <directionalLight
        ref={sun}
        position={[daylight.sunDirection.x * 12000, daylight.sunDirection.y * 12000, daylight.sunDirection.z * 12000]}
        intensity={daylight.sunIntensity}
        color={daylight.sunColor}
        castShadow={false}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-14000}
        shadow-camera-right={14000}
        shadow-camera-top={14000}
        shadow-camera-bottom={-14000}
        shadow-camera-near={100}
        shadow-camera-far={40000}
        shadow-bias={-0.00015}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ground.centerX, -1, ground.centerZ]} receiveShadow={false}>
        <planeGeometry args={[ground.width, ground.depth]} />
        <meshBasicMaterial color="#0b1220" />
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
      <mesh geometry={seaGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]} renderOrder={1}>
        <meshBasicMaterial color="#0d1a30" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}


// Tab visibility as an external store: pause rendering while the tab is hidden
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
const getVisible = () => document.visibilityState !== 'hidden';
const getVisibleOnServer = () => true;

export function Scene() {
  const tabVisible = useSyncExternalStore(subscribeVisibility, getVisible, getVisibleOnServer);
  const roads = useAppStore((state) => state.roads);
  // One fixed quality for everyone (no HD/Lite switch); phones just render at 1x resolution
  const weak = useMemo(() => isWeakDevice(), []);

  const ground = useMemo(() => {
    if (roads.length === 0) {
      return { centerX: 0, centerZ: 0, width: 30000, depth: 30000, maxDistance: 42000, fogNear: 35000, fogFar: 85000 };
    }
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
    const sizeX = Math.max(maxX - minX, 10000);
    const sizeZ = Math.max(maxY - minY, 10000);
    const extent = Math.max(sizeX, sizeZ);
    const maxDistance = Math.max(42000, extent * 2.5);
    return {
      centerX: (minX + maxX) * 0.5,
      centerZ: -(minY + maxY) * 0.5,
      width: sizeX * 3,
      depth: sizeZ * 3,
      maxDistance,
      fogNear: Math.max(35000, extent * 0.75),
      fogFar: Math.max(85000, extent * 3),
    };
  }, [roads]);

  return (
    <Canvas
      dpr={weak ? [1, 1.25] : [1, 1.5]}
      camera={{
        position: [ground.centerX, Math.max(6000, Math.max(ground.width, ground.depth) * 0.3), ground.centerZ + Math.max(7000, Math.max(ground.width, ground.depth) * 0.35)],
        fov: 45,
        near: 10,
        far: Math.max(100000, ground.maxDistance * 2.5),
      }}
      gl={{ antialias: !weak, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
      shadows={false}
      frameloop={tabVisible ? 'always' : 'never'}
      style={{ background: '#0b1220' }}
    >
      <fog attach="fog" args={['#0b1220', ground.fogNear, ground.fogFar]} />
      <DaylightRig ground={ground} />

      <Streets />
      <Roads />
      <RouteLine />
      <CameraPins />
      <UserLocation />
      <PlaceLabels />
      <CameraRig />
      <SceneReadiness />

      <MapControls
        makeDefault
        target={[ground.centerX, 0, ground.centerZ]}
        minDistance={1200}
        maxDistance={ground.maxDistance}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2 - 0.05}
        enableDamping
        dampingFactor={0.08}
        zoomSpeed={0.9}
        zoomToCursor
      />
    </Canvas>
  );
}
