'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, MapControls } from '@react-three/drei';
import { Roads } from './Roads';
import { Vehicles } from './Vehicles';
import { useAppStore } from '@/store/useAppStore';
import { CameraRig } from './CameraRig';
import { Buildings } from './Buildings';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useDaylight } from './useDaylight';
import * as THREE from 'three';
import type { BloomEffect } from 'postprocessing';

function GradientSky({ skyColor, horizonColor, horizonGlow }: { skyColor: THREE.Color; horizonColor: THREE.Color; horizonGlow: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.topColor.value.copy(skyColor);
    material.uniforms.bottomColor.value.copy(horizonColor);
    material.uniforms.glow.value = THREE.MathUtils.damp(material.uniforms.glow.value, horizonGlow, 5, 1 / 60);
  });
  return (
    <mesh scale={90000} renderOrder={-100}>
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
            vec3 gradient = mix(bottomColor * 0.18, topColor, heightMix);
            float edge = 1.0 - smoothstep(-0.03, 0.12, normalize(vWorldPosition).y);
            gradient = mix(gradient, bottomColor, edge * glow);
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
}

function DaylightRig({ ground, lowGraphics }: { ground: GroundBounds; lowGraphics: boolean }) {
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
      <GradientSky skyColor={daylight.skyColor} horizonColor={daylight.horizonColor} horizonGlow={daylight.horizonGlow} />
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

function DynamicBloom({ lowGraphics }: { lowGraphics: boolean }) {
  const daylight = useDaylight();
  const bloomRef = useRef<BloomEffect>(null);
  useFrame(() => {
    if (!bloomRef.current) return;
    const bloom = bloomRef.current;
    bloom.intensity = THREE.MathUtils.lerp(0.5, 1.1, daylight.darkness);
  });
  if (lowGraphics) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={0.28} luminanceSmoothing={0.25} intensity={0.12} />
      <Vignette eskil={false} offset={0.12} darkness={0.55} />
    </EffectComposer>
  );
}

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
      shadows={false}
      style={{ background: '#05080f' }}
      onPointerMissed={() => selectRoad(null)}
    >
      <fog attach="fog" args={['#05080f', 30000, 90000]} />
      <DaylightRig ground={ground} lowGraphics={lowGraphics} />

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
      <DynamicBloom lowGraphics={lowGraphics} />
    </Canvas>
  );
}
