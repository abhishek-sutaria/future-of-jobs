import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    BufferGeometry,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LatheGeometry,
    type Mesh,
    ShaderMaterial,
    Sphere,
    Vector2,
    Vector3,
    Vector4,
} from 'three';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import { SCENE, SHADER, YEAR_MAX, YEAR_MIN } from '../../config/constants';
import {
    groundFragmentShader,
    groundVertexShader,
    MAX_FAMILIES,
    MAX_REGIONS,
    peakFragmentShader,
    peakVertexShader,
} from './worldShaders';
import { GROUND_Y, peakHeightAt, type ScenePeak, type WorldScene } from './worldScene';
import { worldPointer } from './worldPointer';
import { displayToWorld, layerOf, worldView } from './worldView';
import { rectDepth, rectWidth, WORLD_BOUNDS } from '../../utils/worldLayout';
import { isIdentityMap } from '../../utils/stageMap';
import { WORLD_LAYER } from '../../utils/stageTransition';
import { SCHOOL_SINK, sinkEase, sinkStep } from '../../utils/stageBake';
import { peakFilterTargets } from '../../utils/schoolLook';
import { prefersReducedMotion } from './worldCamera';

/** Opaque, the peaks draw first and write depth; fading, after a stage that is taking over. */
const PEAK_ORDER = { opaque: 1, fading: 2 } as const;

/** The view map every treemap material reads (sx, sz, tx, tz), written once a frame. */
const viewUniform = new Vector4(1, 1, 0, 0);

/** Unit bell (radius 1, height 1), the same Gaussian profile the old terrain summed. */
function makeBellGeometry(radial: number, rings: number): BufferGeometry {
    const decay = SHADER.BELL_CURVE_DECAY;
    const floor = Math.exp(-decay);
    const points: Vector2[] = [];
    for (let i = rings; i >= 0; i--) {
        const r = i / rings;
        points.push(new Vector2(r, (Math.exp(-decay * r * r) - floor) / (1 - floor)));
    }
    return new LatheGeometry(points, radial);
}

interface RegionMesh {
    code: string;
    peaks: ScenePeak[];
    geometry: InstancedBufferGeometry;
    material: ShaderMaterial;
    aPeak: InstancedBufferAttribute;
    aEmph: InstancedBufferAttribute;
    /** Eased 0 to 1 per peak: how far the IU school has greyed and sunk it. */
    aOut: InstancedBufferAttribute;
    /** Linear progress behind aOut, and where each peak is heading. */
    outProgress: Float32Array;
    outTarget: Float32Array;
    aColor: InstancedBufferAttribute;
    mesh: Mesh | null;
}

/**
 * The ground (22 regions drawn in its shader) and every peak: one instanced
 * draw call per region, 833 bells in all, no per-peak meshes.
 *
 * This is the world level only. A family or field stands on StageTerrain: on
 * the way in, all of this is drawn through the flight's map, so the block being
 * opened magnifies in place as its stage takes over on top and the rest fades;
 * on the way out the same steps run backwards. Once it has faded it leaves the
 * draw list.
 */
export const WorldTerrain: React.FC<{ scene: WorldScene; isMobile: boolean }> = ({ scene, isMobile }) => {
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const school = useWorldStore((s) => s.school);

    const bell = useMemo(() => (isMobile ? makeBellGeometry(12, 6) : makeBellGeometry(20, 10)), [isMobile]);

    const regionIndex = useMemo(
        () => new Map(scene.layout.regions.map((r, i) => [r.code, i])),
        [scene.layout.regions],
    );

    const groundUniforms = useMemo(() => ({
        uRegions: { value: Array.from({ length: MAX_REGIONS }, (_, i) => {
            const r = scene.layout.regions[i]?.rect;
            return r ? new Vector4(r.x0, r.z0, r.x1, r.z1) : new Vector4(1e6, 1e6, 1e6, 1e6);
        }) },
        uFamilies: { value: Array.from({ length: MAX_FAMILIES }, (_, i) => {
            const r = scene.layout.families[i]?.rect;
            return r ? new Vector4(r.x0, r.z0, r.x1, r.z1) : new Vector4(1e6, 1e6, 1e6, 1e6);
        }) },
        uHoverRegion: { value: -1 },
        uHoverFamily: { value: -1 },
        uBounds: { value: new Vector4(WORLD_BOUNDS.x0, WORLD_BOUNDS.z0, WORLD_BOUNDS.x1, WORLD_BOUNDS.z1) },
        uFade: { value: 1 },
        uMouse: { value: new Vector2(1e6, 1e6) },
        uView: { value: viewUniform },
    }), [scene.layout.regions, scene.layout.families]);

    // One instanced geometry + material per region. Built once per layout and
    // jobs array; per-frame work only rewrites heights when the year moves.
    const regionMeshes = useMemo<RegionMesh[]>(() => {
        const year = useStore.getState().year;
        return scene.layout.regions.map((region) => {
            const peaks = scene.peaksByContinent.get(region.code) ?? [];
            const n = peaks.length;
            const geometry = new InstancedBufferGeometry();
            geometry.index = bell.index;
            geometry.setAttribute('position', bell.getAttribute('position'));
            const peakArr = new Float32Array(n * 4);
            const colorArr = new Float32Array(n * 3);
            const indexArr = new Float32Array(n);
            peaks.forEach((p, i) => {
                peakArr.set([p.x, p.z, p.radius, peakHeightAt(p.entry, year)], i * 4);
                colorArr.set(p.color, i * 3);
                indexArr[i] = i;
            });
            const aPeak = new InstancedBufferAttribute(peakArr, 4);
            const aColor = new InstancedBufferAttribute(colorArr, 3);
            const aEmph = new InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
            geometry.setAttribute('aPeak', aPeak);
            geometry.setAttribute('aColor', aColor);
            geometry.setAttribute('aEmph', aEmph);
            const aOut = new InstancedBufferAttribute(new Float32Array(n), 1);
            geometry.setAttribute('aOut', aOut);
            geometry.setAttribute('aIndex', new InstancedBufferAttribute(indexArr, 1));
            geometry.instanceCount = n;
            // Real bounds for frustum culling (the unit bell's own bounds would
            // be wrong): the region's rectangle, as tall as its tallest peak on
            // the 2025→2035 path. A zoomed-in view then skips off-screen regions.
            const tallest = Math.max(0, ...peaks.map((p) => Math.max(peakHeightAt(p.entry, YEAR_MIN), peakHeightAt(p.entry, YEAR_MAX))));
            const reach = Math.max(0, ...peaks.map((p) => p.radius));
            geometry.boundingSphere = new Sphere(
                new Vector3(region.cx, GROUND_Y + tallest / 2, region.cz),
                Math.hypot(rectWidth(region.rect) / 2 + reach, rectDepth(region.rect) / 2 + reach, tallest / 2),
            );
            const material = new ShaderMaterial({
                vertexShader: peakVertexShader,
                fragmentShader: peakFragmentShader,
                uniforms: {
                    uGroundY: { value: GROUND_Y },
                    uFade: { value: 1 },
                    uRegionLift: { value: 1 },
                    uHover: { value: -1 },
                    uView: { value: viewUniform },
                },
            });
            return { code: region.code, peaks, geometry, material, aPeak, aEmph, aOut, outProgress: new Float32Array(n), outTarget: new Float32Array(n), aColor, mesh: null };
        });
    }, [scene, bell]);

    useEffect(() => () => {
        for (const m of regionMeshes) {
            m.geometry.dispose();
            m.material.dispose();
        }
    }, [regionMeshes]);
    useEffect(() => () => bell.dispose(), [bell]);

    // The Kelley filter dims every peak it leaves out, as it always has. The IU
    // school instead greys and sinks what it leaves out, eased frame by frame below.
    const sinking = useRef(false);
    useEffect(() => {
        for (const m of regionMeshes) {
            const arr = m.aEmph.array as Float32Array;
            m.peaks.forEach((p, i) => {
                const t = peakFilterTargets({ kelleyOnly, school }, p.entry);
                arr[i] = t.emphasis;
                m.outTarget[i] = t.out;
            });
            m.aEmph.needsUpdate = true;
        }
        sinking.current = true;
    }, [regionMeshes, kelleyOnly, school]);

    const lastYear = useRef<number | null>(null);
    const groundRef = useRef<Mesh>(null);
    useFrame((_, delta) => {
        if (sinking.current) {
            // Only while some peak is still on its way: 833 floats, no re-bake.
            const reduced = prefersReducedMotion();
            let moving = false;
            for (const m of regionMeshes) {
                const out = m.aOut.array as Float32Array;
                let changed = false;
                m.peaks.forEach((p, i) => {
                    const from = m.outProgress[i];
                    const to = m.outTarget[i];
                    if (from === to) return;
                    const next = sinkStep(from, to, delta, reduced);
                    m.outProgress[i] = next;
                    out[i] = sinkEase(next);
                    if (out[i] > 0) worldView.peakSink.set(p.entry.key, 1 + (SCHOOL_SINK - 1) * out[i]);
                    else worldView.peakSink.delete(p.entry.key);
                    changed = true;
                    if (next !== to) moving = true;
                });
                if (changed) m.aOut.needsUpdate = true;
            }
            sinking.current = moving;
        }
        const year = useStore.getState().year;
        const { alpha: fade, mult: lift } = layerOf(WORLD_LAYER);
        // Nothing to rewrite while the treemap is out of the draw list: it catches up on its way back.
        if (year !== lastYear.current && fade > 0) {
            lastYear.current = year;
            for (const m of regionMeshes) {
                const arr = m.aPeak.array as Float32Array;
                m.peaks.forEach((p, i) => {
                    arr[i * 4 + 3] = peakHeightAt(p.entry, year);
                });
                m.aPeak.needsUpdate = true;
            }
        }
        // How much of the world shows, and through which map, is the flight's (utils/stageTransition).
        const { map } = worldView;
        viewUniform.set(map.sx, map.sz, map.tx, map.tz);
        const atRest = isIdentityMap(map);
        for (const m of regionMeshes) {
            m.material.uniforms.uFade.value = fade;
            m.material.uniforms.uRegionLift.value = lift;
            m.material.transparent = fade < 1;
            if (m.mesh) {
                m.mesh.visible = fade > 0;
                // Bounds are in world units, so they only hold while the map is the world's own.
                m.mesh.frustumCulled = atRest;
                m.mesh.renderOrder = fade < 1 ? PEAK_ORDER.fading : PEAK_ORDER.opaque;
            }
            m.material.uniforms.uHover.value = worldPointer.hoverPeakContinent === m.code ? worldPointer.hoverPeakIndex : -1;
        }
        groundUniforms.uFade.value = fade;
        if (groundRef.current) groundRef.current.visible = fade > 0;

        groundUniforms.uHoverRegion.value = worldPointer.hoverRegion ? regionIndex.get(worldPointer.hoverRegion) ?? -1 : -1;
        groundUniforms.uHoverFamily.value = scene.layout.families.findIndex((f) => f.family.id === worldPointer.hoverFamily);
        const mouse = worldPointer.mouseX < 1e5 ? displayToWorld(worldPointer.mouseX, worldPointer.mouseZ) : { x: 1e6, z: 1e6 };
        groundUniforms.uMouse.value.set(mouse.x, mouse.z);
    });

    return (
        <group>
            {/* Flat ground: two triangles. The old terrain displaced ~37k vertices
                through a 50-peak loop every frame; the peaks are now instanced. */}
            <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} renderOrder={-1}>
                <planeGeometry args={[SCENE.PLANE_SIZE + 24, SCENE.PLANE_SIZE + 24, 1, 1]} />
                <shaderMaterial
                    vertexShader={groundVertexShader}
                    fragmentShader={groundFragmentShader}
                    uniforms={groundUniforms}
                    transparent
                    depthWrite={false}
                />
            </mesh>
            {regionMeshes.map((m) => (
                <mesh key={m.code} ref={(mesh) => { m.mesh = mesh; }} geometry={m.geometry} material={m.material} />
            ))}
        </group>
    );
};
