'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';

function hash01(seed: number): number {
  let value = seed | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function makeWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create building window texture.');

  context.fillStyle = '#080d18';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 91273;
  for (let y = 7; y < canvas.height; y += 12) {
    for (let x = 7; x < canvas.width; x += 12) {
      seed += 11;
      const lit = hash01(seed) < 0.2;
      context.fillStyle = lit ? '#f4c777' : '#101827';
      context.fillRect(x, y, 5, 7);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

interface PointDistance {
  distance: number;
  highwayNearby: boolean;
}

function nearestRoadDistance(
  x: number,
  z: number,
  grid: Map<string, Array<[number, number, Road['type']]>>,
  cellSize: number,
): PointDistance {
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);
  let distance = Infinity;
  let highwayNearby = false;

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const points = grid.get(`${gx + dx}:${gz + dz}`);
      if (!points) continue;
      for (const [roadX, roadZ, type] of points) {
        const current = Math.hypot(x - roadX, z - roadZ);
        if (current < distance) {
          distance = current;
          highwayNearby = type === 'highway';
        }
      }
    }
  }
  return { distance, highwayNearby };
}

export function Buildings() {
  const roads = useAppStore((state) => state.roads);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const lowGraphics = useAppStore((state) => state.lowGraphics);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const targetOpacity = useRef(1);

  const { positions, texture } = useMemo(() => {
    const windowTexture = makeWindowTexture();
    if (roads.length === 0) return { positions: [] as Array<THREE.Object3D & { userData: { height: number } }>, texture: windowTexture };

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

    const grid = new Map<string, Array<[number, number, Road['type']]>>();
    const cellSize = 500;
    roads.forEach((road) => {
      road.segments.forEach((segment) => {
        for (let index = 1; index < segment.length; index += 1) {
          const [ax, ay] = segment[index - 1];
          const [bx, by] = segment[index];
          const dx = bx - ax;
          const dy = by - ay;
          const length = Math.hypot(dx, dy);
          const steps = Math.max(1, Math.ceil(length / 180));
          for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            const x = ax + dx * t;
            const y = ay + dy * t;
            const z = -y;
            const gx = Math.floor(x / cellSize);
            const gz = Math.floor(z / cellSize);
            const key = `${gx}:${gz}`;
            const list = grid.get(key) ?? [];
            list.push([x, z, road.type]);
            grid.set(key, list);
          }
        }
      });
    });

    const centerX = (minX + maxX) * 0.5;
    const centerZ = -(minY + maxY) * 0.5;
    const citySize = Math.max(maxX - minX, maxY - minY);
    const result: Array<THREE.Object3D & { userData: { height: number } }> = [];
    let seed = 1337;
    let attempts = 0;

    while (result.length < 6500 && attempts < 90000) {
      attempts += 1;
      seed += 97;
      const x = minX + hash01(seed) * (maxX - minX);
      const z = -(minY + hash01(seed + 1) * (maxY - minY));
      const nearest = nearestRoadDistance(x, z, grid, cellSize);
      if (nearest.distance < 60 || nearest.distance > 300) continue;

      const roadWidthClearance = nearest.highwayNearby ? 80 : 55;
      if (nearest.distance < roadWidthClearance) continue;

      const cityDistance = Math.hypot(x - centerX, z - centerZ) / Math.max(citySize, 1);
      const centreBoost = 1 - THREE.MathUtils.clamp(cityDistance * 1.35, 0, 1);
      const highwayBoost = nearest.highwayNearby ? 0.25 : 0;
      const randomHeight = 15 + hash01(seed + 2) * 145;
      const height = THREE.MathUtils.clamp(
        randomHeight * (0.45 + centreBoost * 0.75 + highwayBoost),
        15,
        160,
      );
      const width = 24 + hash01(seed + 3) * 36;
      const depth = 24 + hash01(seed + 4) * 36;
      const dummy = new THREE.Object3D();
      dummy.position.set(x, height * 0.5, z);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      const entry = dummy as THREE.Object3D & { userData: { height: number } };
      entry.userData.height = height;
      result.push(entry);
    }
    return { positions: result, texture: windowTexture };
  }, [roads]);

  useEffect(() => () => {
    texture.dispose();
  }, [texture]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    positions.forEach((building, index) => {
      mesh.setMatrixAt(index, building.matrix);
    });
    mesh.count = positions.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);

  useEffect(() => {
    targetOpacity.current = selectedRoadId ? 0.35 : 1;
  }, [selectedRoadId]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity.current, 4, delta);
  });

  if (lowGraphics) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, 6500]} frustumCulled>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#0c1222"
        emissive="#182238"
        emissiveMap={texture}
        emissiveIntensity={0.55}
        roughness={0.9}
        metalness={0.05}
        transparent
        opacity={1}
      />
    </instancedMesh>
  );
}
