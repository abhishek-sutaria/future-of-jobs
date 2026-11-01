import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, type Mesh, ShaderMaterial, Vector2 } from 'three';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import { SCENE } from '../../config/constants';
import { bakeStage, STAGE_BLEND, STAGE_BLEND_POWER, yearMix, type StageBake } from '../../utils/stageBake';
import { buildStage, stageKey, type Stage } from '../../utils/stageLayout';
import { GROUND_Y, type WorldScene } from './worldScene';
import { STAGE_SEGMENTS, stageFragmentShader, stageVertexShader } from './stageShaders';
import { createStageTextures, stageTextureFormat, type StageTextures } from './stageTextures';
import { prefersReducedMotion } from './worldCamera';
import { worldPointer } from './worldPointer';
import { worldStage } from './worldStage';

/** Seconds for hills to rise from flat, and to flatten on the way out. */
const RISE_SECONDS = 0.85;
const FLATTEN_SECONDS = 0.4;
/** The disc itself comes in over this first share of the rise. */
const DISC_FADE_SHARE = 0.2;
/** Hills start to rise once the world is this far gone, so there is never an empty moment. */
const WORLD_GONE = 0.08;
/** The Kelley filter's dimming fades in at this rate per second. */
const KELLEY_RATE = 9;

const smooth = (t: number) => t * t * (3 - 2 * t);

interface OnStage {
    stage: Stage;
    bake: StageBake;
    textures: StageTextures;
}

function showTextures(material: ShaderMaterial, textures: StageTextures | null): void {
    material.uniforms.uHeights.value = textures?.heights ?? null;
    material.uniforms.uColors.value = textures?.colors ?? null;
}

/** One frame's numbers. `kelleyStep` is how far the Kelley dimming moves towards `kelleyGoal`. */
function writeFrame(material: ShaderMaterial, rise: number, fade: number, mix: number, kelleyGoal: number, kelleyStep: number): void {
    const { uniforms } = material;
    uniforms.uRise.value = rise;
    uniforms.uFade.value = fade;
    uniforms.uYearMix.value = mix;
    uniforms.uKelley.value += (kelleyGoal - uniforms.uKelley.value) * kelleyStep;
    // As the live mesh's raycast does: the cursor glow lands on the flat plane.
    uniforms.uMouse.value.set(worldPointer.mouseX, -worldPointer.mouseZ);
}

/**
 * The one terrain a family or field stands on: the live landscape's surface at
 * the live landscape's place, displaced from a baked texture, so any number of
 * jobs goes down the same path. Stands apart from the treemap, which is gone
 * from the draw list by the time this rises.
 *
 * Remounts with the Canvas after a WebGL context loss (Landscape's canvasKey),
 * which rebuilds the textures from the store's level.
 */
export const StageTerrain: React.FC<{ scene: WorldScene; isMobile: boolean }> = ({ scene, isMobile }) => {
    const [segments] = useState<number>(isMobile ? STAGE_SEGMENTS.mobile : STAGE_SEGMENTS.desktop);
    const [format] = useState(stageTextureFormat);
    const meshRef = useRef<Mesh>(null);
    const onStage = useRef<OnStage | null>(null);
    const riseProgress = useRef(0);
    const staleScene = useRef(false);

    // Held by a material made here, not by JSX, so each frame can write to its
    // uniforms and the textures can swap without a re-render.
    const material = useMemo(() => new ShaderMaterial({
        vertexShader: stageVertexShader,
        fragmentShader: stageFragmentShader,
        defines: format === 'packed' ? { STAGE_PACKED: 1 } : {},
        uniforms: {
            uHeights: { value: null },
            uColors: { value: null },
            uTexels: { value: segments + 1 },
            uYearMix: { value: 0 },
            uRise: { value: 0 },
            uFade: { value: 0 },
            uKelley: { value: 0 },
            uMouse: { value: new Vector2(1e6, 1e6) },
        },
        transparent: true,
        side: DoubleSide,
    }), [segments, format]);

    const take = (stage: Stage) => {
        const bake = bakeStage(stage, segments, STAGE_BLEND, STAGE_BLEND_POWER);
        const textures = createStageTextures(bake, format);
        onStage.current?.textures.dispose();
        onStage.current = { stage, bake, textures };
        showTextures(material, textures);
        worldStage.bake = bake;
        useWorldStore.setState({ drawnStage: stage });
    };

    const clear = () => {
        onStage.current?.textures.dispose();
        onStage.current = null;
        showTextures(material, null);
        worldStage.bake = null;
        worldStage.rise = 0;
        riseProgress.current = 0;
        useWorldStore.setState({ drawnStage: null });
    };

    // New jobs data can change a job's colour, never where it stands.
    useEffect(() => {
        staleScene.current = !!onStage.current;
    }, [scene]);

    useEffect(() => () => {
        clear();
        material.dispose();
    }, [material]); // eslint-disable-line react-hooks/exhaustive-deps

    useFrame((_, delta) => {
        const level = useWorldStore.getState();
        const wanted = stageKey(level);
        const reduced = prefersReducedMotion();
        const shown = onStage.current;

        if (shown && shown.stage.key !== wanted) {
            // The old hills flatten first, whatever comes next.
            riseProgress.current = reduced ? 0 : Math.max(0, riseProgress.current - delta / FLATTEN_SECONDS);
            if (riseProgress.current === 0) clear();
        }
        else if (shown) {
            if (staleScene.current) take(buildStage(level, scene.peaksByContinent)!);
            riseProgress.current = reduced ? 1 : Math.min(1, riseProgress.current + delta / RISE_SECONDS);
        }
        else if (wanted && worldStage.worldFade <= WORLD_GONE) {
            take(buildStage(level, scene.peaksByContinent)!);
        }
        staleScene.current = false;

        const mesh = meshRef.current;
        if (!mesh) return;
        const progress = riseProgress.current;
        const up = !!onStage.current;
        mesh.visible = up;
        worldStage.rise = up ? smooth(progress) : 0;
        worldStage.yearMix = yearMix(useStore.getState().year);
        writeFrame(
            material,
            worldStage.rise,
            Math.min(1, progress / DISC_FADE_SHARE),
            worldStage.yearMix,
            level.kelleyOnly ? 1 : 0,
            reduced ? 1 : Math.min(1, delta * KELLEY_RATE),
        );
    });

    return (
        <mesh ref={meshRef} material={material} visible={false} frustumCulled={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]}>
            <planeGeometry args={[SCENE.PLANE_SIZE, SCENE.PLANE_SIZE, segments, segments]} />
        </mesh>
    );
};
