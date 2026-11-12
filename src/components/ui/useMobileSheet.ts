'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type SnapPoint = 'peek' | 'half' | 'full';

const SNAP_POINTS: SnapPoint[] = ['peek', 'half', 'full'];
const SNAP_HEIGHT: Record<SnapPoint, string> = {
  peek: 'h-[150px]',
  half: 'h-[50dvh]',
  full: 'h-[88dvh]',
};

export function useMobileSheet() {
  const [snapPoint, setSnapPoint] = useState<SnapPoint>('peek');
  const pointerStart = useRef<number | null>(null);
  const dragged = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointerStart.current = event.clientY;
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current === null) return;
    const delta = pointerStart.current - event.clientY;
    pointerStart.current = null;
    if (Math.abs(delta) < 12) return;
    dragged.current = true;
    const currentIndex = SNAP_POINTS.indexOf(snapPoint);
    const step = Math.max(1, Math.round(Math.abs(delta) / (window.innerHeight * 0.18)));
    const nextIndex = Math.max(0, Math.min(SNAP_POINTS.length - 1, currentIndex + (delta > 0 ? step : -step)));
    setSnapPoint(SNAP_POINTS[nextIndex]);
  };

  const onClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setSnapPoint((current) => SNAP_POINTS[(SNAP_POINTS.indexOf(current) + 1) % SNAP_POINTS.length]);
  };

  return {
    snapPoint,
    setSnapPoint,
    snapHeightClass: SNAP_HEIGHT[snapPoint],
    handleProps: { onPointerDown, onPointerUp, onClick },
  };
}
