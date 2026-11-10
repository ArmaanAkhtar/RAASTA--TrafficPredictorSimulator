'use client';

// Every street / gali under the main roads, like the grey street grid of Google Maps.
// Data: public/data/streets.bin (scripts/fetch-osm.ts + scripts/build-streets.ts). Only drawn, never clicked.
// One draw call: each street segment is one instance of a small quad, widened in the shader so it is
// ~7 m wide up close and never thinner than ~1 pixel far away (no flicker when zoomed out).
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useDaylight } from './useDaylight';

const STREET_Y = 0.8; // above the ground and grid, below every road ribbon (local roads start at 2)
const HALF_WIDTH_M = 3.5;
const MIN_PIXELS = 1.1; // never thinner than this on screen
const WHITE = new THREE.Color('#ffffff');

/** streets.bin -> per-segment [x0, y0, x1, y1] (local metres) */
function decode(buffer: ArrayBuffer): Float32Array {
  const data = new Int16Array(buffer);
  let segments = 0;
  for (let i = 0; i < data.length; ) {
    const n = data[i];
    if (n < 2) break;
    segments += n - 1;
    i += 1 + n * 2;
  }
  const out = new Float32Array(segments * 4);
  let o = 0;
  for (let i = 0; i < data.length; ) {
    const n = data[i];
    if (n < 2) break;
    const base = i + 1;
    for (let k = 0; k < n - 1; k++) {
      out[o++] = data[base + k * 2];
      out[o++] = data[base + k * 2 + 1];
      out[o++] = data[base + k * 2 + 2];
      out[o++] = data[base + k * 2 + 3];
    }
    i += 1 + n * 2;
  }
  return out;
}

const VERTEX = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aSeg;      // x0, y0, x1, y1 (local metres, y = north)
  uniform float uY;
  uniform float uHalfWidth;
  uniform float uPixel;     // world size of one screen pixel at distance 1
  varying float vDist;
  void main() {
    vec2 a = aSeg.xy;
    vec2 b = aSeg.zw;
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 c = mix(a, b, position.x);
    vec3 centre = vec3(c.x, uY, -c.y);
    float dist = distance(cameraPosition, centre);
    float halfW = max(uHalfWidth, dist * uPixel);
    // across the street, and a little past each end so bends have no gaps
    vec2 off = nrm * position.y * halfW + dir * (position.x * 2.0 - 1.0) * halfW;
    vec3 world = vec3(c.x + off.x, uY, -(c.y + off.y));
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vDist = dist;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform vec3 uGround;
  varying float vDist;
  void main() {
    #include <logdepthbuf_fragment>
    // full contrast up close, calmer when looking at the whole city
    float far = smoothstep(6000.0, 30000.0, vDist);
    gl_FragColor = vec4(mix(uColor, uGround, far * 0.55), 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function Streets() {
  const [segments, setSegments] = useState<Float32Array | null>(null);
  const daylight = useDaylight();
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let alive = true;
    fetch('/data/streets.bin')
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buf) => {
        if (alive && buf && buf.byteLength > 4) setSegments(decode(buf));
      })
      .catch(() => {
        // no streets file yet: the map simply shows the main roads
      });
    return () => {
      alive = false;
    };
  }, []);

  const geometry = useMemo(() => {
    if (!segments || segments.length === 0) return null;
    const g = new THREE.InstancedBufferGeometry();
    // quad corners: x = along (0 start, 1 end), y = side (-1 / +1)
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(segments, 4));
    g.instanceCount = segments.length / 4;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
    return g;
  }, [segments]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        fog: true,
        side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uY: { value: STREET_Y },
            uHalfWidth: { value: HALF_WIDTH_M },
            uPixel: { value: 0.001 },
            uColor: { value: new THREE.Color('#263248') },
            uGround: { value: new THREE.Color('#0b1220') },
          },
        ]),
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }) => {
    const u = material.uniforms;
    // one screen pixel in world metres per metre of distance, times the minimum width (half on each side)
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
    const pxPerUnit = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, gl.domElement.height);
    u.uPixel.value = pxPerUnit * MIN_PIXELS * gl.getPixelRatio() * 0.5;
    // streets a little lighter than the ground, day and night
    (u.uGround.value as THREE.Color).copy(daylight.groundColor);
    (u.uColor.value as THREE.Color).copy(daylight.groundColor).lerp(WHITE, 0.06);
  });

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={-2} />;
}
