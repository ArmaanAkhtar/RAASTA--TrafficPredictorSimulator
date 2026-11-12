'use client';

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { loadCameras, type CameraInfo } from '@/lib/cameras';
import { useAppStore } from '@/store/useAppStore';
import { CameraIcon } from '../ui/CameraIcon';
import { RestrictedCameraScreen } from '../ui/RestrictedCameraScreen';

export const CAMERA_PINS_ZOOM_RATIO = 0.55;

const PIN_HEIGHT = 420;

interface ControlsHandle {
  target: THREE.Vector3;
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
  const [pinsVisible, setPinsVisible] = useState(false);
  const roads = useAppStore((state) => state.roads);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as ControlsHandle | null;
  const lastVisibility = useRef(false);

  const overviewDistance = useMemo(() => {
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
    const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const limitingHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * Math.max(camera.aspect, 0.1)));
    return Math.max(1200, radius / Math.max(Math.sin(limitingHalfFov), 0.1));
  }, [roads, camera, camera.aspect, camera.fov]);

  useFrame(() => {
    if (!Number.isFinite(overviewDistance) || !controls) return;
    const distance = camera.position.distanceTo(controls.target);
    const shouldShow = distance < overviewDistance * CAMERA_PINS_ZOOM_RATIO;
    if (lastVisibility.current !== shouldShow) {
      lastVisibility.current = shouldShow;
      setPinsVisible(shouldShow);
    }
  });

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
      {cameras.map((cam) => (
        <Pin key={cam.id} cam={cam} visible={pinsVisible} />
      ))}
    </group>
  );
}
