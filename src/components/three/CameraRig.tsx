'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { useLocationStore } from '@/lib/location';
import { useAreaStore } from '@/lib/area';

interface ControlsHandle {
  target: THREE.Vector3;
  enabled: boolean;
  update: () => void;
}

/**
 * A camera flight. Instead of moving in a straight line (which looked jumpy), the camera
 * swings around the target in spherical coordinates and rises a little in the middle of
 * long trips, with a duration that grows with distance (0.9 s .. 2 s).
 */
interface AnimationState {
  elapsed: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromSph: THREE.Spherical;
  toSph: THREE.Spherical;
  lift: number; // extra height factor at mid-flight
}

const TMP_OFFSET = new THREE.Vector3();

function makeFlight(
  fromPosition: THREE.Vector3,
  fromTarget: THREE.Vector3,
  toPosition: THREE.Vector3,
  toTarget: THREE.Vector3,
): AnimationState {
  const fromSph = new THREE.Spherical().setFromVector3(fromPosition.clone().sub(fromTarget));
  const toSph = new THREE.Spherical().setFromVector3(toPosition.clone().sub(toTarget));
  const travel = fromTarget.distanceTo(toTarget);
  const scale = Math.max(fromSph.radius, toSph.radius, 1);
  const ratio = travel / scale;
  // Take the short way round
  let dTheta = toSph.theta - fromSph.theta;
  while (dTheta > Math.PI) dTheta -= Math.PI * 2;
  while (dTheta < -Math.PI) dTheta += Math.PI * 2;
  toSph.theta = fromSph.theta + dTheta;
  return {
    elapsed: 0,
    duration: THREE.MathUtils.clamp(0.9 + ratio * 0.6 + Math.abs(Math.log(toSph.radius / Math.max(fromSph.radius, 1))) * 0.3, 0.9, 2),
    fromTarget: fromTarget.clone(),
    toTarget: toTarget.clone(),
    fromSph,
    toSph,
    lift: THREE.MathUtils.clamp(ratio * 0.25, 0, 0.35),
  };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
  // Stay inside MapControls' maxDistance (42000), otherwise the controls snap the camera to an odd angle
  const distance = THREE.MathUtils.clamp(radius / Math.max(Math.sin(limitingHalfFov), 0.1), 1200, 38000);
  const direction = new THREE.Vector3(0.707, 0.707, -0.707).normalize();
  return { position: center.clone().add(direction.multiplyScalar(distance)), target: center };
}

/** Box around a list of [x, y] points (in 3D: x, -y). */
function pointsBoundingBox(points: Array<[number, number]>): { center: THREE.Vector3; size: THREE.Vector3 } {
  const min = new THREE.Vector3(Infinity, 0, Infinity);
  const max = new THREE.Vector3(-Infinity, 0, -Infinity);
  points.forEach(([x, y]) => {
    min.x = Math.min(min.x, x);
    min.z = Math.min(min.z, -y);
    max.x = Math.max(max.x, x);
    max.z = Math.max(max.z, -y);
  });
  if (!Number.isFinite(min.x)) {
    min.set(-1, 0, -1);
    max.set(1, 0, 1);
  }
  return { center: min.clone().add(max).multiplyScalar(0.5), size: max.clone().sub(min) };
}

/** Shift the view so the framed object is not hidden behind the SidePanel (right on desktop, bottom on mobile). */
function offsetForPanel(view: { position: THREE.Vector3; target: THREE.Vector3 }, size: THREE.Vector3): void {
  if (typeof window === 'undefined') return;
  const amount = Math.max(size.x, size.z) * 0.12;
  const offset = window.innerWidth >= 768
    ? new THREE.Vector3(amount, 0, 0)
    : new THREE.Vector3(0, 0, -amount);
  view.target.add(offset);
  view.position.add(offset);
}

export function CameraRig() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as ControlsHandle | null;
  const roads = useAppStore((state) => state.roads);
  const selectedRoadId = useAppStore((state) => state.selectedRoadId);
  const flyToken = useAppStore((state) => state.flyToken);
  const altRoute = useAppStore((state) => state.altRoute);
  const showRoute = useAppStore((state) => state.showRoute);
  const animation = useRef<AnimationState | null>(null);
  const initialFrameDone = useRef(false);
  const lastToken = useRef(flyToken);
  const gl = useThree((state) => state.gl);
  const lastDoubleClick = useRef(0);
  const lastFramedRoute = useRef('');
  const locationFlyToken = useLocationStore((state) => state.flyToken);
  const userPoint = useLocationStore((state) => state.point);
  const lastLocationToken = useRef(locationFlyToken);
  const areaFlyToken = useAreaStore((state) => state.flyToken);
  const areaPlace = useAreaStore((state) => state.place);
  const lastAreaToken = useRef(areaFlyToken);

  // A place picked in search: glide there, wide enough to see the cameras around it
  useEffect(() => {
    if (areaFlyToken === lastAreaToken.current || !areaPlace) return;
    lastAreaToken.current = areaFlyToken;
    const target = new THREE.Vector3(areaPlace.point[0], 0, -areaPlace.point[1]);
    const fromTarget = controls?.target ?? new THREE.Vector3();
    const offset = camera.position.clone().sub(fromTarget).setLength(7000);
    animation.current = makeFlight(camera.position, fromTarget, target.clone().add(offset), target);
  }, [areaFlyToken, areaPlace, camera, controls]);

  // "My location": glide to the blue dot, close enough to see the nearby roads
  useEffect(() => {
    if (locationFlyToken === lastLocationToken.current || !userPoint) return;
    lastLocationToken.current = locationFlyToken;
    const target = new THREE.Vector3(userPoint[0], 0, -userPoint[1]);
    const fromTarget = controls?.target ?? new THREE.Vector3();
    const offset = camera.position.clone().sub(fromTarget).setLength(5500);
    animation.current = makeFlight(camera.position, fromTarget, target.clone().add(offset), target);
  }, [locationFlyToken, userPoint, camera, controls]);

  // Double-click / double-tap anywhere: glide in to that spot (2.5x closer), keeping the view angle
  useEffect(() => {
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    const zoomTo = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
      const fromTarget = controls?.target ?? new THREE.Vector3();
      const offset = camera.position.clone().sub(fromTarget);
      const newRadius = THREE.MathUtils.clamp(offset.length() / 2.5, 1300, 40000);
      const toPosition = hit.clone().add(offset.setLength(newRadius));
      lastDoubleClick.current = performance.now();
      animation.current = makeFlight(camera.position, fromTarget, toPosition, hit);
    };

    const onDoubleClick = (event: MouseEvent) => zoomTo(event.clientX, event.clientY);

    // Touch: two taps within 300 ms and 30 px
    let lastTap = { time: 0, x: 0, y: 0 };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.changedTouches.length !== 1 || event.touches.length > 0) return;
      const touch = event.changedTouches[0];
      const now = performance.now();
      if (now - lastTap.time < 300 && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 30) {
        zoomTo(touch.clientX, touch.clientY);
        lastTap = { time: 0, x: 0, y: 0 };
      } else {
        lastTap = { time: now, x: touch.clientX, y: touch.clientY };
      }
    };

    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('touchend', onTouchEnd);
    return () => {
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('touchend', onTouchEnd);
    };
  }, [camera, controls, gl]);

  useEffect(() => {
    // Wait for both the roads and the MapControls, so the first framing is not overwritten
    if (roads.length === 0 || !controls) return;
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
    // A double-click on a road also fires clicks: let the double-click zoom win
    if (performance.now() - lastDoubleClick.current < 600) return;
    const box = roadBoundingBox([selectedRoad]);
    const view = framedView(camera, box.center, box.size);
    offsetForPanel(view, box.size);
    animation.current = makeFlight(
      camera.position,
      controls?.target ?? new THREE.Vector3(),
      view.position,
      view.target,
    );
  }, [camera, controls, flyToken, roads, selectedRoadId]);

  // When the better route is shown, frame the selected road AND the route together
  useEffect(() => {
    if (!showRoute || !altRoute || altRoute.path.length < 2) {
      if (!showRoute) lastFramedRoute.current = '';
      return;
    }
    // Re-frame only for a NEW trip (different ends / road), not when the time slider tweaks the same route
    const a = altRoute.path[0];
    const b = altRoute.path[altRoute.path.length - 1];
    const key = `${selectedRoadId ?? ''}|${Math.round(a[0])},${Math.round(a[1])}|${Math.round(b[0])},${Math.round(b[1])}`;
    if (key === lastFramedRoute.current) return;
    lastFramedRoute.current = key;
    const points: Array<[number, number]> = [...altRoute.path];
    const selectedRoad = selectedRoadId ? roads.find((road) => road.id === selectedRoadId) : undefined;
    selectedRoad?.segments.forEach((segment) => segment.forEach((p) => points.push(p)));
    const box = pointsBoundingBox(points);
    const view = framedView(camera, box.center, box.size);
    offsetForPanel(view, box.size);
    animation.current = makeFlight(
      camera.position,
      controls?.target ?? new THREE.Vector3(),
      view.position,
      view.target,
    );
    // Only re-frame when the route is turned on or changes, not on every road/time update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoute, altRoute]);

  useFrame((_, delta) => {
    const flight = animation.current;
    if (!flight) return;
    // Controls off while flying, so their damping does not fight the animation
    if (controls) controls.enabled = false;
    flight.elapsed += Math.min(delta, 1 / 30);
    const t = THREE.MathUtils.clamp(flight.elapsed / flight.duration, 0, 1);
    const e = easeInOutCubic(t);

    const target = TMP_OFFSET.lerpVectors(flight.fromTarget, flight.toTarget, e).clone();
    const radius = THREE.MathUtils.lerp(flight.fromSph.radius, flight.toSph.radius, e) * (1 + flight.lift * Math.sin(Math.PI * e));
    const phi = THREE.MathUtils.lerp(flight.fromSph.phi, flight.toSph.phi, e);
    const theta = THREE.MathUtils.lerp(flight.fromSph.theta, flight.toSph.theta, e);
    camera.position.setFromSphericalCoords(radius, phi, theta).add(target);

    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    camera.lookAt(target);

    if (t >= 1) {
      animation.current = null;
      if (controls) controls.enabled = true;
    }
  });

  return null;
}
