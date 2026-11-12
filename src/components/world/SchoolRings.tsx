import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, type InstancedMesh } from 'three';
import { useWorldStore } from '../../worldStore';
import { isHighlighted } from '../../utils/iuSchools';
import { ringPulse } from '../../utils/schoolLook';
import { surfaceHeight } from '../../utils/stageBake';
import { mapX, mapZ } from '../../utils/stageMap';
import { WORLD_LAYER } from '../../utils/stageTransition';
import { GROUND_Y, type WorldScene } from './worldScene';
import { layerOf, stageToDisplay, toDisplayX, toDisplayZ, worldView } from './worldView';
import { prefersReducedMotion } from './worldCamera';

/** IU crimson. */
export const SCHOOL_RING_COLOR = '#990000';
/** A field pin's ring is 0.2 across its radius: the glow sits just outside it. */
const FIELD_RING_RADIUS = 0.8;
/** At the world, a ring is this much wider than its peak's footprint. */
const WORLD_RING_SCALE = 1.35;
/** Most rings at once: the largest school (College of Arts and Sciences) has about 125 jobs. */
const MAX_RINGS = 400;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

// A soft band of light round the middle of the quad, brightest at radius 0.72.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float band = exp(-pow((r - 0.66) / (0.16 + 0.06 * uPulse), 2.0));
    float core = exp(-pow((r - 0.66) / 0.05, 2.0));
    float a = (band * (0.8 + 0.6 * uPulse) + core * 1.4) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uColor * 1.6, vec3(1.0, 0.75, 0.75), core * 0.45), min(a, 1.0));
  }
`;

const matrix = new Matrix4();
const position = new Vector3();
const scale = new Vector3();
const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

/**
 * A glowing IU-crimson ring round every job the picked school leads to: round
 * its pin on a field, round its peak's foot at the world. One instanced quad,
 * one draw call, a gentle pulse (steady with reduced motion). Nothing without a
 * school. A family shows no job pins, so no rings either.
 */
export const SchoolRings: React.FC<{ scene: WorldScene }> = ({ scene }) => {
    const school = useWorldStore((s) => s.school);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const stage = useWorldStore((s) => s.drawnStage);
    const mesh = useRef<InstancedMesh>(null);

    const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
    const material = useMemo(() => new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uColor: { value: new Color(SCHOOL_RING_COLOR) }, uOpacity: { value: 1 }, uPulse: { value: 0.5 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    }), []);
    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

    // Exactly the jobs drawn at full colour (and counted on the school's chip).
    const worldPeaks = useMemo(() => (school ? scene.peaks.filter((p) => isHighlighted({ kelleyOnly, school }, p.entry)) : []), [scene, school, kelleyOnly]);
    const fieldJobs = useMemo(
        () => (school && stage?.kind === 'field' ? stage.jobs.filter((j) => isHighlighted({ kelleyOnly, school }, { kind: j.kelley ? 'kelley' : 'bls', soc: j.soc })) : []),
        [school, stage, kelleyOnly],
    );

    useFrame((state) => {
        const m = mesh.current;
        if (!m) return;
        const pulse = ringPulse(state.clock.elapsedTime, prefersReducedMotion());
        material.uniforms.uPulse.value = pulse;
        let n = 0;
        const put = (x: number, y: number, z: number, radius: number) => {
            if (n >= MAX_RINGS) return;
            position.set(x, y, z);
            const size = radius * 2 * (1 + 0.08 * pulse);
            scale.set(size, size, 1);
            m.setMatrixAt(n++, matrix.compose(position, flat, scale));
        };
        // On a field: round each pin, on the surface as drawn.
        const surface = stage ? worldView.surfaces.get(stage.key) : undefined;
        const fieldLayer = stage ? layerOf(stage.key) : null;
        if (stage && surface && fieldLayer && fieldLayer.alpha > 0 && fieldJobs.length > 0) {
            const toScreen = stageToDisplay(stage);
            for (const job of fieldJobs) {
                put(mapX(toScreen, job.x), GROUND_Y + surfaceHeight(surface.bake, job.x, job.z, worldView.yearMix) * fieldLayer.mult + 0.02, mapZ(toScreen, job.z), FIELD_RING_RADIUS);
            }
            material.uniforms.uOpacity.value = fieldLayer.alpha;
        }
        // At the world: round each peak's foot, as wide as its footprint on screen.
        else {
            const world = layerOf(WORLD_LAYER);
            if (world.alpha > 0) {
                const sx = Math.abs(worldView.map.sx);
                for (const p of worldPeaks) put(toDisplayX(p.x), GROUND_Y + 0.02, toDisplayZ(p.z), p.radius * WORLD_RING_SCALE * sx);
            }
            material.uniforms.uOpacity.value = world.alpha;
        }
        m.count = n;
        m.visible = n > 0;
        m.instanceMatrix.needsUpdate = true;
    });

    return <instancedMesh ref={mesh} args={[geometry, material, MAX_RINGS]} frustumCulled={false} visible={false} renderOrder={3} />;
};
