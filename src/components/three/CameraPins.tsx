'use client';

import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { loadCameras, type CameraInfo } from '@/lib/cameras';
import type { Road } from '@/lib/types';
import { useAppStore } from '@/store/useAppStore';
import { CameraIcon } from '../ui/CameraIcon';
import { RestrictedCameraScreen } from '../ui/RestrictedCameraScreen';

export const CAMERA_PINS_ZOOM_RATIO = 0.45;

const PIN_HEIGHT = 420;
const PIN_COLLISION_PX = 36;
const MAX_VISIBLE_PINS = 30;
const PIN_FADE_MS = 260;
const VISIBILITY_RECHECK_MS = 200;

interface ControlsHandle {
  target: THREE.Vector3;
  addEventListener: (type: 'change', listener: () => void) => void;
  removeEventListener: (type: 'change', listener: () => void) => void;
}

function overviewDistanceFor(roads: Road[], fov: number, aspect: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const road of roads) {
    for (const segment of road.segments) {
      for (const [x, y] of segment) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return Infinity;
  const radius = Math.max(maxX - minX, maxY - minY, 1) * 0.72;
  const halfFov = THREE.MathUtils.degToRad(fov * 0.5);
  const limitingHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * Math.max(aspect, 0.1)));
  return Math.max(1200, radius / Math.max(Math.sin(limitingHalfFov), 0.1));
}

function Pin({ cam, visible }: { cam: CameraInfo; visible: boolean }) {
  const openCamera = useAppStore((state) => state.openCamera);
  const activeCameraId = useAppStore((state) => state.activeCameraId);
  const [hovered, setHovered] = useState(false);
  const skipClick = useRef(false);
  const selected = activeCameraId === cam.id;

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') return;
    event.stopPropagation();
    skipClick.current = true;
    if (hovered) {
      openCamera(cam.id);
      setHovered(false);
    } else {
      setHovered(true);
    }
  };

  return (
    <group position={[cam.position[0], 0, -cam.position[1]]}>
      <Html position={[0, PIN_HEIGHT * 0.9, 0]} center zIndexRange={[30, 0]}>
        <div
          className="relative transition-[opacity,transform] duration-[250ms] ease-out"
          style={{
            opacity: visible ? 1 : 0,
            transform: `scale(${visible ? 1 : 0.82})`,
            pointerEvents: visible ? 'auto' : 'none',
            animation: visible ? 'raasta-camera-pin-fade-in 250ms ease-out both' : undefined,
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') setHovered(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') setHovered(false);
          }}
        >
          <button
            type="button"
            onPointerUp={handlePointerUp}
            onClick={(event) => {
              event.stopPropagation();
              if (skipClick.current) {
                skipClick.current = false;
                return;
              }
              openCamera(cam.id);
            }}
            onPointerEnter={() => {
              document.body.style.cursor = 'pointer';
            }}
            onPointerLeave={() => {
              document.body.style.cursor = '';
            }}
            aria-label={`Open camera ${cam.name}`}
            title={cam.name}
            className="relative grid h-9 w-9 place-items-start rounded-full bg-transparent p-0 transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7cc4ff]"
          >
            <span
              className={`relative z-10 grid h-9 w-9 place-items-center rounded-full border text-[#f6f2ea] transition-[background-color,box-shadow,border-color] duration-150 ${
                selected
                  ? 'border-[#7cc4ff] bg-[#7cc4ff] text-[#0b1220] shadow-[0_0_16px_rgba(124,196,255,0.75)]'
                  : hovered
                    ? 'border-[#a4d8ff] bg-[#0f1729] shadow-[0_0_18px_rgba(124,196,255,0.8)]'
                    : 'border-[#7cc4ff] bg-[#0f1729] shadow-[0_0_12px_rgba(124,196,255,0.38)]'
              }`}
            >
              <CameraIcon className="h-[14px] w-[14px]" />
            </span>
            <span
              className="absolute bottom-0 left-1/2 z-0 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-[#7cc4ff] bg-[#0f1729]"
              aria-hidden
            />
          </button>
          {hovered && visible && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openCamera(cam.id);
              }}
              aria-label={`Open full-screen view for ${cam.name}`}
              className="absolute left-11 top-[-54px] z-20 w-60 overflow-hidden rounded-xl border border-[#1f2a44] bg-[#0f1729] p-2 text-left text-[#f6f2ea] shadow-[0_12px_32px_rgba(0,0,0,0.35)] animate-[camera-preview-in_120ms_ease-out]"
            >
              <span className="mb-1 block truncate text-xs font-semibold">{cam.name}</span>
              <span className="mb-1 block truncate text-[10px] text-[#8f9bb8]">{cam.roadName}</span>
              <RestrictedCameraScreen className="h-[104px] w-full rounded-md" />
            </button>
          )}
        </div>
      </Html>
    </group>
  );
}

/** Camera pins fade in after a small zoom-in; opening a pin brings up the shared camera overlay. */
export function CameraPins() {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [renderIds, setRenderIds] = useState<string[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const roads = useAppStore((state) => state.roads);
  const activeCameraId = useAppStore((state) => state.activeCameraId);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as ControlsHandle | null;
  const size = useThree((state) => state.size);
  const lastVisibleKey = useRef('');
  const aspect = size.width / Math.max(size.height, 1);
  const fov = camera.fov;
  const renderIdsRef = useRef<string[]>([]);
  const desiredIdsRef = useRef<Set<string>>(new Set());
  const unmountTimers = useRef(new Map<string, number>());
  const overviewDistance = useMemo(
    () => overviewDistanceFor(roads, fov, aspect),
    [aspect, fov, roads],
  );

  useEffect(() => () => {
    unmountTimers.current.forEach((timer) => window.clearTimeout(timer));
    unmountTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!controls) return;

    let lastCheck = 0;
    let checkTimer: number | null = null;
    const updateVisibility = () => {
      if (!Number.isFinite(overviewDistance)) return;
      const distance = camera.position.distanceTo(controls.target);
      const visible: string[] = [];

      if (distance < overviewDistance * CAMERA_PINS_ZOOM_RATIO) {
        camera.updateMatrixWorld();
        const centerX = size.width / 2;
        const centerY = size.height / 2;
        const candidates = cameras.flatMap((cam) => {
          const position = new THREE.Vector3(cam.position[0], PIN_HEIGHT * 0.9, -cam.position[1]).project(camera);
          if (position.z < -1 || position.z > 1) return [];
          const x = (position.x + 1) * centerX;
          const y = (1 - position.y) * centerY;
          if (x < -PIN_COLLISION_PX || x > size.width + PIN_COLLISION_PX ||
              y < -PIN_COLLISION_PX || y > size.height + PIN_COLLISION_PX) return [];
          return [{ id: cam.id, x, y, selected: cam.id === activeCameraId }];
        });
        candidates.sort((a, b) => Number(b.selected) - Number(a.selected) ||
          Math.hypot(a.x - centerX, a.y - centerY) - Math.hypot(b.x - centerX, b.y - centerY) ||
          a.id.localeCompare(b.id));

        const buckets = new Map<string, Array<{ x: number; y: number }>>();
        for (const candidate of candidates) {
          const cellX = Math.floor(candidate.x / PIN_COLLISION_PX);
          const cellY = Math.floor(candidate.y / PIN_COLLISION_PX);
          let overlaps = false;
          for (let x = cellX - 1; x <= cellX + 1 && !overlaps; x += 1) {
            for (let y = cellY - 1; y <= cellY + 1 && !overlaps; y += 1) {
              for (const point of buckets.get(`${x}:${y}`) ?? []) {
                if (Math.hypot(point.x - candidate.x, point.y - candidate.y) < PIN_COLLISION_PX) {
                  overlaps = true;
                  break;
                }
              }
            }
          }
          if (overlaps) continue;
          visible.push(candidate.id);
          const key = `${cellX}:${cellY}`;
          const points = buckets.get(key) ?? [];
          points.push(candidate);
          buckets.set(key, points);
          if (visible.length === MAX_VISIBLE_PINS) break;
        }
      }

      const key = visible.join('|');
      if (key === lastVisibleKey.current) return;
      lastVisibleKey.current = key;
      const desired = new Set(visible);
      desiredIdsRef.current = desired;
      setVisibleIds(desired);

      const nextRendered = visible.slice();
      for (const id of renderIdsRef.current) {
        if (nextRendered.length >= MAX_VISIBLE_PINS) break;
        if (!desired.has(id)) nextRendered.push(id);
      }
      renderIdsRef.current = nextRendered;
      setRenderIds(nextRendered);

      for (const id of nextRendered) {
        const pending = unmountTimers.current.get(id);
        if (desired.has(id) && pending !== undefined) {
          window.clearTimeout(pending);
          unmountTimers.current.delete(id);
        } else if (!desired.has(id) && pending === undefined) {
          const timer = window.setTimeout(() => {
            unmountTimers.current.delete(id);
            if (desiredIdsRef.current.has(id)) return;
            renderIdsRef.current = renderIdsRef.current.filter((item) => item !== id);
            setRenderIds((current) => current.filter((item) => item !== id));
          }, PIN_FADE_MS);
          unmountTimers.current.set(id, timer);
        }
      }
    };

    const scheduleCheck = () => {
      if (checkTimer !== null) return;
      const delay = Math.max(0, VISIBILITY_RECHECK_MS - (Date.now() - lastCheck));
      checkTimer = window.setTimeout(() => {
        checkTimer = null;
        lastCheck = Date.now();
        updateVisibility();
      }, delay);
    };

    controls.addEventListener('change', scheduleCheck);
    scheduleCheck();
    return () => {
      controls.removeEventListener('change', scheduleCheck);
      if (checkTimer !== null) window.clearTimeout(checkTimer);
    };
  }, [activeCameraId, camera, cameras, controls, overviewDistance, size.height, size.width]);

  useEffect(() => {
    let alive = true;
    loadCameras()
      .then((list) => {
        if (alive) setCameras(list);
      })
      .catch(() => {
        // The map remains usable if camera data is unavailable.
      });
    return () => {
      alive = false;
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <group>
      {renderIds.map((id) => {
        const cam = cameras.find((item) => item.id === id);
        return cam ? <Pin key={cam.id} cam={cam} visible={visibleIds.has(cam.id)} /> : null;
      })}
    </group>
  );
}
