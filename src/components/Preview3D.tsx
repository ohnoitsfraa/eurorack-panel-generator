'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { usePanelBuild } from '@/lib/usePanelBuild';
import type { Mesh as PanelMesh } from '@/lib/types';

/**
 * Three.js preview of the actual export geometry.
 *
 * This deliberately renders the same meshes that STL and 3MF are written
 * from, rather than a stylised stand-in, so anything wrong with the model is
 * visible here before a print is wasted on it.
 */
export function Preview3D() {
  const { result } = usePanelBuild();
  const thickness = useStore((s) => s.design.thicknessMm);

  const geometries = useMemo(
    () => result.meshes.map((m) => ({ mesh: m, geometry: toGeometry(m) })),
    [result],
  );

  const { widthMm, heightMm } = result.stats;

  return (
    <div className="relative h-full w-full bg-ink-950">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, Math.max(widthMm, heightMm) * 1.5], fov: 35, near: 1, far: 4000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#0c0d10']} />
        <hemisphereLight intensity={0.45} groundColor="#1a1c20" />
        <directionalLight position={[80, 120, 160]} intensity={1.5} castShadow={false} />
        <directionalLight position={[-120, -60, 80]} intensity={0.5} />
        <Environment preset="studio" environmentIntensity={0.35} />

        {/* Centre the panel on the origin: the model itself starts at a corner
            so that exported coordinates are all positive. */}
        <group position={[-widthMm / 2, -heightMm / 2, -thickness / 2]}>
          {geometries.map(({ mesh, geometry }, i) => (
            <mesh key={`${mesh.name}-${i}`} geometry={geometry}>
              <meshStandardMaterial
                color={safeColor(mesh.color)}
                roughness={0.55}
                metalness={0.08}
                side={THREE.FrontSide}
              />
            </mesh>
          ))}
        </group>

        <Grid
          position={[0, -heightMm / 2 - 6, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          args={[400, 400]}
          cellSize={5.08}
          cellColor="#22262c"
          sectionSize={50.8}
          sectionColor="#2e343d"
          fadeDistance={420}
          infiniteGrid
        />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.12}
          minDistance={30}
          maxDistance={900}
        />
      </Canvas>

      <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] tabular-nums text-ink-400">
        {result.stats.triangles.toLocaleString()} triangles · {result.meshes.length} object
        {result.meshes.length === 1 ? '' : 's'} · {result.stats.holes} cutouts
      </div>
    </div>
  );
}

function toGeometry(m: PanelMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.computeBoundingSphere();
  return g;
}

/** Three throws on a malformed colour, and the picker can be mid-edit. */
function safeColor(c: string): string {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : '#808080';
}
