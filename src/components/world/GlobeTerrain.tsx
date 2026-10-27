import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    AdditiveBlending,
    BackSide,
    BufferAttribute,
    BufferGeometry,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LatheGeometry,
    Mesh,
    ShaderMaterial,
    Sphere,
    SphereGeometry,
    Vector2,
    Vector3,
    Vector4,
} from 'three';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import { SHADER, YEAR_MAX, YEAR_MIN } from '../../config/constants';
import { GLOBE_RADIUS, LAND_RADIUS, unitVector } from '../../utils/globeLayout';
import {
    atmosphereFragmentShader,
    atmosphereVertexShader,
    globePeakFragmentShader,
    globePeakVertexShader,
    landFragmentShader,
    landVertexShader,
    MAX_GLOBE_FAMILIES,
    oceanFragmentShader,
    oceanVertexShader,
} from './globeShaders';
import { GLOBE_PEAK_SCALE, type GlobePeak, type GlobeScene } from './globeScene';
import { peakHeightAt } from './worldScene';
import { worldPointer } from './worldPointer';
import { useWorldView } from './worldCamera';

/** How far a peak outside the highlight fades toward the ground colour (as on the flat map). */
const DIM_EMPHASIS = 0.22;
const ATMOSPHERE_RADIUS = GLOBE_RADIUS * 1.09;

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

interface ContinentPeaks {
    code: string;
    peaks: GlobePeak[];
    geometry: InstancedBufferGeometry;
    material: ShaderMaterial;
    aShape: InstancedBufferAttribute;
    aEmph: InstancedBufferAttribute;
    /** Unit normal at the continent's centre, and the angle out to its farthest peak footprint. */
    center: Vector3;
    reach: number;
}

const camDir = new Vector3();
const right = new Vector3();
const light = new Vector3();

/**
 * The globe: ocean, a faint atmosphere, the 22 continents in one draw call,
 * and every peak, one instanced draw call per continent (833 bells, no
 * per-peak meshes, as on the flat map). Continents wholly behind the globe
 * skip their draw call.
 */
export const GlobeTerrain: React.FC<{ globe: GlobeScene; isMobile: boolean }> = ({ globe, isMobile }) => {
    const view = useWorldView((s) => s.view);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const groupRef = useRef<Group>(null);
    const meshRefs = useRef<Map<string, Mesh>>(new Map());

    const bell = useMemo(() => (isMobile ? makeBellGeometry(12, 6) : makeBellGeometry(20, 10)), [isMobile]);
    const ocean = useMemo(() => (isMobile ? new SphereGeometry(GLOBE_RADIUS, 64, 40) : new SphereGeometry(GLOBE_RADIUS, 96, 64)), [isMobile]);
    const atmosphere = useMemo(() => new SphereGeometry(ATMOSPHERE_RADIUS, 48, 32), []);
    useEffect(() => () => {
        bell.dispose();
        ocean.dispose();
    }, [bell, ocean]);
    useEffect(() => () => atmosphere.dispose(), [atmosphere]);

    const lightUniform = useMemo(() => ({ value: new Vector3(0, 1, 0) }), []);

    const land = useMemo(() => {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(globe.mesh.positions, 3));
        g.setAttribute('aRegion', new BufferAttribute(globe.mesh.region, 1));
        g.setAttribute('aShore', new BufferAttribute(globe.mesh.shore, 1));
        g.setIndex(new BufferAttribute(globe.mesh.index, 1));
        g.boundingSphere = new Sphere(new Vector3(), LAND_RADIUS);
        return g;
    }, [globe.mesh]);
    useEffect(() => () => land.dispose(), [land]);

    const landUniforms = useMemo(() => ({
        uHoverRegion: { value: -1 },
        uFocusRegion: { value: -1 },
        uMouse: { value: new Vector3() },
        uLightDir: lightUniform,
        uRadius: { value: LAND_RADIUS },
    }), [lightUniform]);
    const oceanUniforms = useMemo(() => ({
        uLightDir: lightUniform,
        uFamilies: { value: Array.from({ length: MAX_GLOBE_FAMILIES }, (_, i) => {
            const r = globe.layout.families[i]?.rect;
            return r ? new Vector4(r.x0, r.z0, r.x1, r.z1) : new Vector4(9, 9, 9, 9);
        }) },
    }), [lightUniform, globe.layout.families]);
    const atmosphereUniforms = useMemo(() => ({
        uInner: { value: Math.sqrt(1 - (GLOBE_RADIUS / ATMOSPHERE_RADIUS) ** 2) },
    }), []);

    const continentPeaks = useMemo<ContinentPeaks[]>(() => {
        const year = useStore.getState().year;
        return globe.layout.continents.map((c) => {
            const peaks = globe.peaksByContinent.get(c.code) ?? [];
            const n = peaks.length;
            const geometry = new InstancedBufferGeometry();
            geometry.index = bell.index;
            geometry.setAttribute('position', bell.getAttribute('position'));
            const dir = new Float32Array(n * 3);
            const shape = new Float32Array(n * 2);
            const color = new Float32Array(n * 3);
            const index = new Float32Array(n);
            peaks.forEach((p, i) => {
                dir.set(p.dir, i * 3);
                shape.set([p.radius, peakHeightAt(p.peak.entry, year)], i * 2);
                color.set(p.peak.color, i * 3);
                index[i] = p.peak.index;
            });
            const aShape = new InstancedBufferAttribute(shape, 2);
            const aEmph = new InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
            geometry.setAttribute('aDir', new InstancedBufferAttribute(dir, 3));
            geometry.setAttribute('aShape', aShape);
            geometry.setAttribute('aColor', new InstancedBufferAttribute(color, 3));
            geometry.setAttribute('aEmph', aEmph);
            geometry.setAttribute('aIndex', new InstancedBufferAttribute(index, 1));
            geometry.instanceCount = n;
            const center = new Vector3(...unitVector(c.lon, c.sinLat));
            const footprint = Math.max(0, ...peaks.map((p) => p.radius)) / GLOBE_RADIUS;
            const tallest = Math.max(0, ...peaks.map((p) => Math.max(peakHeightAt(p.peak.entry, YEAR_MIN), peakHeightAt(p.peak.entry, YEAR_MAX)))) * GLOBE_PEAK_SCALE;
            // Real bounds, for frustum culling when zoomed in.
            geometry.boundingSphere = new Sphere(
                center.clone().multiplyScalar(LAND_RADIUS + tallest / 2),
                (c.reach + footprint) * LAND_RADIUS + tallest,
            );
            const material = new ShaderMaterial({
                vertexShader: globePeakVertexShader,
                fragmentShader: globePeakFragmentShader,
                uniforms: {
                    uRadius: { value: LAND_RADIUS },
                    uHeightScale: { value: GLOBE_PEAK_SCALE },
                    uHover: { value: -1 },
                    uLightDir: lightUniform,
                },
            });
            return {
                code: c.code,
                peaks,
                geometry,
                material,
                aShape,
                aEmph,
                center,
                // Angle from the centre to the farthest peak, plus how far past the horizon its top still shows.
                reach: c.reach + footprint + Math.acos(LAND_RADIUS / (LAND_RADIUS + tallest)),
            };
        });
    }, [globe, bell, lightUniform]);

    useEffect(() => () => {
        for (const m of continentPeaks) {
            m.geometry.dispose();
            m.material.dispose();
        }
    }, [continentPeaks]);

    // Kelley filter: dim every other peak, keep the 50 at full colour.
    useEffect(() => {
        for (const m of continentPeaks) {
            const arr = m.aEmph.array as Float32Array;
            m.peaks.forEach((p, i) => {
                arr[i] = !kelleyOnly || p.peak.entry.kind === 'kelley' ? 1 : DIM_EMPHASIS;
            });
            m.aEmph.needsUpdate = true;
        }
    }, [continentPeaks, kelleyOnly]);

    const lastYear = useRef<number | null>(null);
    useFrame(({ camera }) => {
        if (useWorldView.getState().view !== 'globe') return;
        const year = useStore.getState().year;
        if (year !== lastYear.current) {
            lastYear.current = year;
            for (const m of continentPeaks) {
                const arr = m.aShape.array as Float32Array;
                m.peaks.forEach((p, i) => {
                    arr[i * 2 + 1] = peakHeightAt(p.peak.entry, year);
                });
                m.aShape.needsUpdate = true;
            }
        }

        // A head-lamp from above and to the left of the camera, so the side
        // facing the viewer is always the lit one.
        camDir.copy(camera.position).normalize();
        right.crossVectors(camera.up, camDir).normalize();
        light.copy(camDir).addScaledVector(camera.up, 0.6).addScaledVector(right, -0.45).normalize();
        lightUniform.value.copy(light);

        // Skip continents wholly behind the globe.
        const dist = camera.position.length();
        const horizon = Math.acos(Math.min(1, LAND_RADIUS / Math.max(dist, LAND_RADIUS)));
        for (const m of continentPeaks) {
            const mesh = meshRefs.current.get(m.code);
            if (!mesh) continue;
            mesh.visible = Math.acos(Math.max(-1, Math.min(1, m.center.dot(camDir)))) < horizon + m.reach + 0.05;
            m.material.uniforms.uHover.value = worldPointer.hoverPeakContinent === m.code ? worldPointer.hoverPeakIndex : -1;
        }

        const focused = useWorldStore.getState().focusedContinent;
        landUniforms.uFocusRegion.value = focused ? globe.continentIndex.get(focused) ?? -1 : -1;
        landUniforms.uHoverRegion.value = worldPointer.hoverRegion ? globe.continentIndex.get(worldPointer.hoverRegion) ?? -1 : -1;
        landUniforms.uMouse.value.set(worldPointer.globeX, worldPointer.globeY, worldPointer.globeZ);
    });

    return (
        <group ref={groupRef} visible={view === 'globe'}>
            <mesh geometry={ocean} renderOrder={-2}>
                <shaderMaterial vertexShader={oceanVertexShader} fragmentShader={oceanFragmentShader} uniforms={oceanUniforms} />
            </mesh>
            <mesh geometry={land} renderOrder={-1}>
                <shaderMaterial vertexShader={landVertexShader} fragmentShader={landFragmentShader} uniforms={landUniforms} />
            </mesh>
            {continentPeaks.map((m) => (
                <mesh
                    key={m.code}
                    geometry={m.geometry}
                    material={m.material}
                    ref={(el) => {
                        if (el) meshRefs.current.set(m.code, el);
                        else meshRefs.current.delete(m.code);
                    }}
                />
            ))}
            <mesh geometry={atmosphere} renderOrder={1}>
                <shaderMaterial
                    vertexShader={atmosphereVertexShader}
                    fragmentShader={atmosphereFragmentShader}
                    uniforms={atmosphereUniforms}
                    side={BackSide}
                    blending={AdditiveBlending}
                    premultipliedAlpha
                    transparent
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};
