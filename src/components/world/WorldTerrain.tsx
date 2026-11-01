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
import { prefersReducedMotion } from './worldCamera';
import { worldPointer } from './worldPointer';
import { worldStage } from './worldStage';
import { rectDepth, rectWidth, WORLD_BOUNDS } from '../../utils/worldLayout';
import { levelKind } from '../../utils/worldLevel';

/** How far a peak outside the highlight fades toward the ground colour. */
const DIM_EMPHASIS = 0.22;
/** Height kept by peaks as the world fades out, so they sink out of the camera's way as they go. */
const FLATTENED_LIFT = 0.12;
/** How fast the world eases in and out, per second. */
const WORLD_FADE_RATE = 14;
/** Close enough to the end of a fade to call it finished, so a fade really does end. */
const FADE_SNAP = 0.004;

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
    aColor: InstancedBufferAttribute;
    mesh: Mesh | null;
}

/**
 * The ground (22 regions drawn in its shader) and every peak: one instanced
 * draw call per region, 833 bells in all, no per-peak meshes.
 *
 * This is the world level only. A family or field stands on StageTerrain, so
 * all of this fades out and leaves the draw list, and comes back once the
 * stage's hills have flattened.
 */
export const WorldTerrain: React.FC<{ scene: WorldScene; isMobile: boolean }> = ({ scene, isMobile }) => {
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);

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
                },
            });
            return { code: region.code, peaks, geometry, material, aPeak, aEmph, aColor, mesh: null };
        });
    }, [scene, bell]);

    useEffect(() => () => {
        for (const m of regionMeshes) {
            m.geometry.dispose();
            m.material.dispose();
        }
    }, [regionMeshes]);
    useEffect(() => () => bell.dispose(), [bell]);

    // Kelley filter: dim every other peak, keep the 50 at full colour.
    useEffect(() => {
        for (const m of regionMeshes) {
            const arr = m.aEmph.array as Float32Array;
            m.peaks.forEach((p, i) => {
                arr[i] = !kelleyOnly || p.entry.kind === 'kelley' ? 1 : DIM_EMPHASIS;
            });
            m.aEmph.needsUpdate = true;
        }
    }, [regionMeshes, kelleyOnly]);

    const lastYear = useRef<number | null>(null);
    const groundRef = useRef<Mesh>(null);
    useFrame((_, delta) => {
        const year = useStore.getState().year;
        // Nothing to rewrite while the treemap is out of the draw list: it catches up on its way back.
        if (year !== lastYear.current && worldStage.worldFade > 0) {
            lastYear.current = year;
            for (const m of regionMeshes) {
                const arr = m.aPeak.array as Float32Array;
                m.peaks.forEach((p, i) => {
                    arr[i * 4 + 3] = peakHeightAt(p.entry, year);
                });
                m.aPeak.needsUpdate = true;
            }
        }
        // The world only comes back once the stage has gone. By time, not by
        // frame, so a fade takes as long on a slow phone as on a fast laptop; a
        // long gap (the loop was paused) just finishes it.
        const level = useWorldStore.getState();
        const show = levelKind(level) === 'world' && !level.drawnStage;
        const k = prefersReducedMotion() ? 1 : 1 - Math.exp(-delta * WORLD_FADE_RATE);
        const next = worldStage.worldFade + ((show ? 1 : 0) - worldStage.worldFade) * k;
        const fade = Math.abs((show ? 1 : 0) - next) < FADE_SNAP ? (show ? 1 : 0) : next;
        worldStage.worldFade = fade;
        const lift = FLATTENED_LIFT + (1 - FLATTENED_LIFT) * fade;
        for (const m of regionMeshes) {
            m.material.uniforms.uFade.value = fade;
            m.material.uniforms.uRegionLift.value = lift;
            m.material.transparent = fade < 1;
            if (m.mesh) m.mesh.visible = fade > 0;
            m.material.uniforms.uHover.value = worldPointer.hoverPeakContinent === m.code ? worldPointer.hoverPeakIndex : -1;
        }
        groundUniforms.uFade.value = fade;
        if (groundRef.current) groundRef.current.visible = fade > 0;

        groundUniforms.uHoverRegion.value = worldPointer.hoverRegion ? regionIndex.get(worldPointer.hoverRegion) ?? -1 : -1;
        groundUniforms.uHoverFamily.value = scene.layout.families.findIndex((f) => f.family.id === worldPointer.hoverFamily);
        groundUniforms.uMouse.value.set(worldPointer.mouseX, worldPointer.mouseZ);
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
