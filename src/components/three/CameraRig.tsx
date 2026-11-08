'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';

interface ControlsHandle {
  target: THREE.Vector3;
  update: () => void;
}

interface AnimationState {
  elapsed: number;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
}

function roadBoundingBox(roads: Road[]): { center: THREE.Vector3; size: THREE.Vector3 } {
  const min = new THREE.Vector3(Infinity, 0, Infinity);
  const max = new THREE.Vector3(-Infinity, 0, -Infinity);
  roads.forEach((road) => {
    road.segments.forEach((segment) => {
      segment.forEach(([x, y]) => {
        min.x = Math.min(min.x, x);
        min.z = Math.min(min.z, -y);
        max.x = Math.max(max.x, x);
        max.z = Math.max(max.z, -y);
      });
    });
  });
  if (!Number.isFinite(min.x)) {
    min.set(-1, 0, -1);
    max.set(1, 0, 1);
  }
  const center = min.clone().add(max).multiplyScalar(0.5);
  return { center, size: max.clone().sub(min) };
}

function framedView(
  camera: THREE.PerspectiveCamera,
  center: THREE.Vector3,
  size: THREE.Vector3,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const radius = Math.max(size.x, size.z, 1) * 0.72;
  const fovHalfRadians = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const aspect = Math.max(camera.aspect, 0.1);
  const limitingHalfFov = Math.min(fovHalfRadians, Math.atan(Math.tan(fovHalfRadians) * aspect));
  const distance = Math.max(radius / Math.max(Math.sin(limitingHalfFov), 0.1), 1200);
  const direction = new THREE.Vector3(0.707, 0.707, -0.707).normalize();
  return { position: center.clone().add(direction.multiplyScalar(distance)), target: center };
}

export function CameraRig() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as ControlsHandle | null;
  const roads = useAppStore((state) => state.roads);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const flyToken = useAppStore((state) => state.flyToken);
  const animation = useRef<AnimationState | null>(null);
  const initialFrameDone = useRef(false);
  const lastToken = useRef(flyToken);

  useEffect(() => {
    if (roads.length === 0) return;
    const selectedRoad = selectedRoadId
      ? roads.find((road) => road.id === selectedRoadId)
      : undefined;

    if (!initialFrameDone.current) {
      const box = roadBoundingBox(roads);
      const view = framedView(camera, box.center, box.size);
      camera.position.copy(view.position);
      camera.lookAt(view.target);
      if (controls) {
        controls.target.copy(view.target);
        controls.update();
      }
      initialFrameDone.current = true;
      lastToken.current = flyToken;
      return;
    }

    if (!selectedRoad || lastToken.current === flyToken) return;
    lastToken.current = flyToken;
    const box = roadBoundingBox([selectedRoad]);
    const view = framedView(camera, box.center, box.size);
    animation.current = {
      elapsed: 0,
      fromPosition: camera.position.clone(),
      fromTarget: controls?.target.clone() ?? new THREE.Vector3(),
      toPosition: view.position,
      toTarget: view.target,
    };
  }, [camera, controls, flyToken, roads, selectedRoadId]);

  useFrame((_, delta) => {
    const current = animation.current;
    if (!current) return;
    current.elapsed += Math.min(delta, 0.05);
    const t = THREE.MathUtils.clamp(current.elapsed / 1, 0, 1);
    const eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(current.fromPosition, current.toPosition, eased);
    if (controls) {
      controls.target.lerpVectors(current.fromTarget, current.toTarget, eased);
      controls.update();
      camera.lookAt(controls.target);
    } else {
      camera.lookAt(current.toTarget);
    }
    if (t >= 1) animation.current = null;
  });

  return null;
}
