import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    BufferGeometry,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LatheGeometry,
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
    MAX_REGIONS,
    peakFragmentShader,
    peakVertexShader,
} from './worldShaders';
import { FIELD_PEAK_MAX, fieldMaxEmploymentAt, fieldPeakHeightAt, GROUND_Y, peakHeightAt, type ScenePeak, type WorldScene } from './worldScene';
import { worldPointer } from './worldPointer';
import { rectDepth, rectWidth, WORLD_BOUNDS } from '../../utils/worldLayout';

/** How far a peak outside the highlight fades toward the ground colour. */
const DIM_EMPHASIS = 0.22;
/** Height kept by peaks outside the zoomed region. */
const FLATTENED_LIFT = 0.12;

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
    aFieldH: InstancedBufferAttribute;
}

/**
 * The ground (22 regions drawn in its shader) and every peak: one instanced
 * draw call per region, 833 bells in all, no per-peak meshes. Since the globe
 * this is the zoomed field view; it stays mounted (hidden) while the globe
 * shows, so entering a field never recompiles anything.
 */
export const WorldTerrain: React.FC<{ scene: WorldScene; isMobile: boolean; visible?: boolean }> = ({ scene, isMobile, visible = true }) => {
    const focused = useWorldStore((s) => s.focusedContinent);
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
        uHoverRegion: { value: -1 },
        uFocusRegion: { value: -1 },
        uFocusRect: { value: new Vector4(1e6, 1e6, 1e6, 1e6) },
        uBounds: { value: new Vector4(WORLD_BOUNDS.x0, WORLD_BOUNDS.z0, WORLD_BOUNDS.x1, WORLD_BOUNDS.z1) },
        uMouse: { value: new Vector2(1e6, 1e6) },
    }), [scene.layout.regions]);

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
            const fieldMax = fieldMaxEmploymentAt(peaks, year);
            const aFieldH = new InstancedBufferAttribute(new Float32Array(peaks.map((p) => fieldPeakHeightAt(p.entry, year, fieldMax))), 1);
            geometry.setAttribute('aFieldH', aFieldH);
            geometry.setAttribute('aPeak', aPeak);
            geometry.setAttribute('aColor', aColor);
            geometry.setAttribute('aEmph', aEmph);
            geometry.setAttribute('aIndex', new InstancedBufferAttribute(indexArr, 1));
            geometry.instanceCount = n;
            // Real bounds for frustum culling (the unit bell's own bounds would
            // be wrong): the region's rectangle, as tall as its tallest peak on
            // the 2025→2035 path. A zoomed-in view then skips off-screen regions.
            const tallest = Math.max(FIELD_PEAK_MAX, ...peaks.map((p) => Math.max(peakHeightAt(p.entry, YEAR_MIN), peakHeightAt(p.entry, YEAR_MAX))));
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
                    uRegionDim: { value: 1 },
                    uRegionLift: { value: 1 },
                    uFieldMix: { value: 0 },
                    uHover: { value: -1 },
                },
            });
            return { code: region.code, peaks, geometry, material, aPeak, aEmph, aColor, aFieldH };
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
    useFrame(() => {
        const year = useStore.getState().year;
        if (year !== lastYear.current) {
            lastYear.current = year;
            for (const m of regionMeshes) {
                const arr = m.aPeak.array as Float32Array;
                const field = m.aFieldH.array as Float32Array;
                const fieldMax = fieldMaxEmploymentAt(m.peaks, year);
                m.peaks.forEach((p, i) => {
                    arr[i * 4 + 3] = peakHeightAt(p.entry, year);
                    field[i] = fieldPeakHeightAt(p.entry, year, fieldMax);
                });
                m.aPeak.needsUpdate = true;
                m.aFieldH.needsUpdate = true;
            }
        }
        // Ease regions in and out of focus rather than snapping. Regions out
        // of focus also flatten, so their tall peaks never stand between the
        // camera and the region being explored.
        for (const m of regionMeshes) {
            const away = !!focused && m.code !== focused;
            const dim = m.material.uniforms.uRegionDim;
            dim.value += ((away ? 0.35 : 1) - dim.value) * 0.15;
            const lift = m.material.uniforms.uRegionLift;
            lift.value += ((away ? FLATTENED_LIFT : 1) - lift.value) * 0.15;
            // The zoomed field switches to its own height scale (see fieldPeakHeightAt).
            const mix = m.material.uniforms.uFieldMix;
            mix.value += ((focused === m.code ? 1 : 0) - mix.value) * 0.15;
            m.material.uniforms.uHover.value = worldPointer.hoverPeakContinent === m.code ? worldPointer.hoverPeakIndex : -1;
        }
        const focusIndex = focused ? regionIndex.get(focused) ?? -1 : -1;
        groundUniforms.uFocusRegion.value = focusIndex;
        const fr = focusIndex >= 0 ? scene.layout.regions[focusIndex].rect : null;
        if (fr) groundUniforms.uFocusRect.value.set(fr.x0, fr.z0, fr.x1, fr.z1);
        else groundUniforms.uFocusRect.value.set(1e6, 1e6, 1e6, 1e6);
        groundUniforms.uHoverRegion.value = worldPointer.hoverRegion ? regionIndex.get(worldPointer.hoverRegion) ?? -1 : -1;
        groundUniforms.uMouse.value.set(worldPointer.mouseX, worldPointer.mouseZ);
    });

    return (
        <group visible={visible}>
            {/* Flat ground: two triangles. The old terrain displaced ~37k vertices
                through a 50-peak loop every frame; the peaks are now instanced. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} renderOrder={-1}>
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
                <mesh key={m.code} geometry={m.geometry} material={m.material} />
            ))}
        </group>
    );
};
