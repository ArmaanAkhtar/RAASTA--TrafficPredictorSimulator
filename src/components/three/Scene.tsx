'use client';

import { useMemo, useRef, useSyncExternalStore } from 'react';
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
import * as THREE from 'three';

function GradientSky({ skyColor, horizonColor, horizonGlow, scale }: { skyColor: THREE.Color; horizonColor: THREE.Color; horizonGlow: number; scale: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.topColor.value.copy(skyColor);
    material.uniforms.bottomColor.value.copy(horizonColor);
    material.uniforms.glow.value = THREE.MathUtils.damp(material.uniforms.glow.value, horizonGlow, 5, 1 / 60);
  });
  return (
    <mesh scale={scale} renderOrder={-100}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        ref={materialRef}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={{
          topColor: { value: skyColor.clone() },
          bottomColor: { value: horizonColor.clone() },
          glow: { value: horizonGlow },
        }}
        vertexShader={`varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`}
        fragmentShader={`uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform float glow;
          varying vec3 vWorldPosition;
          void main() {
            float heightMix = smoothstep(-0.15, 0.7, normalize(vWorldPosition).y);
            // horizon colour near the ground, sky colour overhead (no dark band or hard colour boundary)
            vec3 gradient = mix(bottomColor, topColor, heightMix);
            float edge = 1.0 - smoothstep(-0.03, 0.12, normalize(vWorldPosition).y);
            gradient = mix(gradient, bottomColor, edge * (0.6 + glow));
            gl_FragColor = vec4(gradient, 1.0);
          }`}
      />
    </mesh>
  );
}

interface GroundBounds {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  margin: number;
  maxDistance: number;
  fogNear: number;
  fogFar: number;
  skyScale: number;
}

function DaylightRig({ ground }: { ground: GroundBounds }) {
  const daylight = useDaylight();
  const scene = useThree((state) => state.scene);
  const groundMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemisphere = useRef<THREE.HemisphereLight>(null);

  useFrame((_, delta) => {
    scene.background = daylight.skyColor;
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(daylight.fogColor);
    if (groundMaterial.current) groundMaterial.current.color.lerp(daylight.groundColor, Math.min(1, delta / 0.08));
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
      <GradientSky
        skyColor={daylight.skyColor}
        horizonColor={daylight.horizonColor}
        horizonGlow={daylight.horizonGlow}
        scale={ground.skyScale}
      />
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
        <meshStandardMaterial ref={groundMaterial} color={daylight.groundColor} roughness={1} metalness={0.05} />
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
      return { centerX: 0, centerZ: 0, width: 10000, depth: 10000, margin: 5000, maxDistance: 42000, fogNear: 35000, fogFar: 85000, skyScale: 90000 };
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
    const margin = 5000;
    const rawMinX = minX - margin;
    const rawMaxX = maxX + margin;
    const rawMinY = minY - margin;
    const rawMaxY = maxY + margin;
    const width = rawMaxX - rawMinX;
    const depth = rawMaxY - rawMinY;
    const extent = Math.max(width, depth);
    const maxDistance = Math.max(42000, extent * 2.5);
    return {
      centerX: (rawMinX + rawMaxX) * 0.5,
      centerZ: -(rawMinY + rawMaxY) * 0.5,
      width,
      depth,
      margin,
      maxDistance,
      fogNear: Math.max(35000, extent * 0.75),
      fogFar: Math.max(85000, extent * 3),
      skyScale: Math.max(90000, maxDistance * 2),
    };
  }, [roads]);

  return (
    <Canvas
      dpr={weak ? 1 : [1, 1.5]}
      camera={{
        position: [ground.centerX, Math.max(6000, Math.max(ground.width, ground.depth) * 0.3), ground.centerZ + Math.max(7000, Math.max(ground.width, ground.depth) * 0.35)],
        fov: 45,
        near: 10,
        far: Math.max(100000, ground.maxDistance * 2.5),
      }}
      gl={{ antialias: !weak, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
      shadows={false}
      frameloop={tabVisible ? 'always' : 'never'}
      style={{ background: '#05080f' }}
    >
      <fog attach="fog" args={['#05080f', ground.fogNear, ground.fogFar]} />
      <DaylightRig ground={ground} />

      <Streets />
      <Roads />
      <RouteLine />
      <CameraPins />
      <UserLocation />
      <PlaceLabels />
      <CameraRig />

      <MapControls
        makeDefault
        target={[ground.centerX, 0, ground.centerZ]}
        minDistance={1200}
        maxDistance={ground.maxDistance}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2 - 0.05}
        enableDamping
        dampingFactor={0.1}
        zoomSpeed={0.9}
        zoomToCursor
      />
    </Canvas>
  );
}
