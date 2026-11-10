import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector4, type DataTexture } from 'three';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import {
    bakeStage,
    bakeSunkHeights,
    rebakeStageColors,
    sinkEase,
    sinkStep,
    STAGE_BLEND,
    STAGE_BLEND_POWER,
    stageSegments,
    yearMix,
    type StageBake,
    type StageEmphasis,
} from '../../utils/stageBake';
import { highlightKey, highlightOn, isHighlighted, type Highlight, type SchoolFilter } from '../../utils/iuSchools';
import { buildStage, stageEdgeBand, stageKey, type Stage } from '../../utils/stageLayout';
import { composeMaps, invertMap, mapX, mapZ } from '../../utils/stageMap';
import { WORLD_LAYER } from '../../utils/stageTransition';
import { rectDepth, rectWidth } from '../../utils/worldLayout';
import { familyLevel, fieldLevel, type WorldLevel } from '../../utils/worldLevel';
import { GROUND_Y, type WorldScene } from './worldScene';
import { MAX_STAGE_TILES, STAGE_SEGMENTS, stageFragmentShader, stageVertexShader, TILE_LINE } from './stageShaders';
import { createHeightTexture, createStageTextures, stageTextureFormat, type StageTextureFormat, type StageTextures } from './stageTextures';
import { prefersReducedMotion } from './worldCamera';
import { worldPointer } from './worldPointer';
import { layerOf, stageToDisplay, worldView } from './worldView';

/** The Kelley or school filter's dimming fades in at this rate per second. */
const KELLEY_RATE = 9;
/** Most of a frame the school's sunk layers may take to bake, a few jobs at a time. */
const SINK_BAKE_BUDGET_MS = 3;
/** A layer this far in is fully drawn: labels and input move over to its stage. */
const DRAWN = 0.999;
/** Opaque layers draw first and write depth; a layer fading in or out draws after them, over what it hands over to. */
const ORDER = { opaque: 1, fading: 2 } as const;

interface Slot {
    stage: Stage;
    bake: StageBake;
    /** highlightKey() of the filter its colours were baked for. */
    baked: string;
    textures: StageTextures;
    material: ShaderMaterial;
    geometry: PlaneGeometry;
    /** Carries the stage's ground to the screen's: stageToDisplay, every frame. */
    holder: Group;
    /** The school-sunk height layers on the GPU, and the school they were baked for. */
    sunkTexture: DataTexture | null;
    sunkFor: string | null;
    /** Sunk layers for a newly picked school, baking a few jobs a frame. */
    sunkBaking: { school: string; step: (budgetMs: number) => Float32Array | null } | null;
    /** Linear progress of the sinking, 0 to 1 (eased into bake.sink). */
    sinkProgress: number;
}

const levelOfKey = (key: string): WorldLevel =>
    key.startsWith('field:') ? fieldLevel(key.slice(6)) : familyLevel(Number(key.slice(7)));

/** The jobs a filter keeps at full colour on a stage. */
const emphasisFor = (h: Highlight): StageEmphasis => (job) => isHighlighted(h, { kind: job.kelley ? 'kelley' : 'bls', soc: job.soc });
/** The jobs a school keeps standing; only the school sinks hills, never the Kelley filter. */
const schoolKeeps = (school: SchoolFilter): StageEmphasis => (job) => school.socs.has(job.soc);

function sunkBaker(stage: Stage, bake: StageBake, school: SchoolFilter) {
    return bakeSunkHeights(stage, bake, STAGE_BLEND, STAGE_BLEND_POWER, stageEdgeBand(stage), schoolKeeps(school));
}

function installSunk(slot: Slot, heights: Float32Array, school: string, format: StageTextureFormat): void {
    slot.sunkTexture?.dispose();
    slot.sunkTexture = createHeightTexture(heights, slot.bake.cols, slot.bake.rows, format);
    slot.material.uniforms.uSunk.value = slot.sunkTexture;
    slot.bake.sunk = heights;
    slot.sunkFor = school;
}

function makeSlot(stage: Stage, longSide: number, format: StageTextureFormat, highlight: Highlight): Slot {
    const segments = stageSegments(stage.outline, longSide);
    const bake = bakeStage(stage, segments, STAGE_BLEND, STAGE_BLEND_POWER, stageEdgeBand(stage), emphasisFor(highlight));
    const textures = createStageTextures(bake, format);
    const { outline } = stage;
    const tiles = Array.from({ length: MAX_STAGE_TILES }, (_, i) => {
        const r = stage.tiles[i]?.rect;
        return r ? new Vector4(r.x0, r.z0, r.x1, r.z1) : new Vector4(1e6, 1e6, 1e6, 1e6);
    });
    const material = new ShaderMaterial({
        vertexShader: stageVertexShader,
        fragmentShader: stageFragmentShader,
        defines: format === 'packed' ? { STAGE_PACKED: 1 } : {},
        uniforms: {
            uHeights: { value: textures.heights },
            uColors: { value: textures.colors },
            uTexels: { value: new Vector2(bake.cols, bake.rows) },
            uCentre: { value: new Vector2((outline.x0 + outline.x1) / 2, (outline.z0 + outline.z1) / 2) },
            uSunk: { value: textures.heights },
            uSink: { value: 0 },
            uYearMix: { value: 0 },
            uRise: { value: 1 },
            uFade: { value: 0 },
            uKelley: { value: 0 },
            uSchool: { value: highlight.school ? 1 : 0 },
            uMouse: { value: new Vector2(1e6, 1e6) },
            uOutline: { value: new Vector4(outline.x0, outline.z0, outline.x1, outline.z1) },
            uTiles: { value: tiles },
            uTileLine: { value: TILE_LINE[stage.kind] },
        },
        transparent: true,
        side: DoubleSide,
    });
    const geometry = new PlaneGeometry(rectWidth(outline), rectDepth(outline), segments.x, segments.z);
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((outline.x0 + outline.x1) / 2, GROUND_Y, (outline.z0 + outline.z1) / 2);
    mesh.frustumCulled = false;
    const holder = new Group();
    holder.add(mesh);
    worldView.surfaces.set(stage.key, { stage, bake });
    const slot: Slot = { stage, bake, baked: highlightKey(highlight), textures, material, geometry, holder, sunkTexture: null, sunkFor: null, sunkBaking: null, sinkProgress: 0 };
    // A stage that arrives with a school already picked arrives sunk, as the world it opens from is.
    if (highlight.school) {
        installSunk(slot, sunkBaker(stage, bake, highlight.school).step(Infinity)!, highlight.school.id, format);
        slot.sinkProgress = 1;
        bake.sink = 1;
        material.uniforms.uSink.value = 1;
    }
    return slot;
}

function disposeSlot(slot: Slot): void {
    slot.holder.removeFromParent();
    slot.textures.dispose();
    slot.sunkTexture?.dispose();
    slot.material.dispose();
    slot.geometry.dispose();
    if (worldView.surfaces.get(slot.stage.key)?.stage === slot.stage) worldView.surfaces.delete(slot.stage.key);
}

/**
 * The surface a family or field stands on: the live landscape's hills, on the
 * stage's own rectangle, displaced from a baked texture so any number of jobs
 * goes down the same path. One mesh per stage on screen, normally one; two
 * while a flight hands one level over to the next. Each is drawn through
 * worldView's map, so it lines up with the treemap and with the other stage
 * exactly, and how much of it shows and how tall comes from the flight
 * (utils/stageTransition).
 *
 * Remounts with the Canvas after a WebGL context loss (Landscape's canvasKey),
 * which rebuilds the textures from the view's layers.
 */
export const StageTerrain: React.FC<{ scene: WorldScene; isMobile: boolean }> = ({ scene, isMobile }) => {
    const [longSide] = useState<number>(isMobile ? STAGE_SEGMENTS.mobile : STAGE_SEGMENTS.desktop);
    const [format] = useState(stageTextureFormat);
    const groupRef = useRef<Group>(null);
    const slots = useRef(new Map<string, Slot>());
    const staleScene = useRef(false);

    // New jobs data can change a job's colour, never where it stands.
    useEffect(() => {
        staleScene.current = slots.current.size > 0;
    }, [scene]);

    useEffect(() => {
        const live = slots.current;
        return () => {
            for (const slot of live.values()) disposeSlot(slot);
            live.clear();
            useWorldStore.setState({ drawnStage: null });
        };
    }, []);

    useFrame((_, delta) => {
        const group = groupRef.current;
        if (!group) return;
        const level = useWorldStore.getState();
        const wanted = stageKey(level);
        const live = slots.current;
        worldView.yearMix = yearMix(useStore.getState().year);

        const highlight: Highlight = { kelleyOnly: level.kelleyOnly, school: level.school };
        const wantedKey = highlightKey(highlight);
        const take = (key: string) => {
            const slot = makeSlot(buildStage(levelOfKey(key), scene)!, longSide, format, highlight);
            live.set(key, slot);
            group.add(slot.holder);
            return slot;
        };
        if (staleScene.current) {
            for (const [key, slot] of [...live]) {
                disposeSlot(slot);
                take(key);
            }
            staleScene.current = false;
        }
        // The level's own stage is baked as soon as it is asked for, so it is ready the moment it starts to show.
        if (wanted && !live.has(wanted)) take(wanted);
        for (const [key, layer] of worldView.layers) {
            if (key !== WORLD_LAYER && layer.alpha > 0 && !live.has(key)) take(key);
        }

        const reduced = prefersReducedMotion();
        const kelleyStep = reduced ? 1 : Math.min(1, delta * KELLEY_RATE);
        for (const [key, slot] of [...live]) {
            const layer = layerOf(key);
            if (layer.alpha <= 0 && key !== wanted) {
                disposeSlot(slot);
                live.delete(key);
                continue;
            }
            const toScreen = stageToDisplay(slot.stage);
            slot.holder.position.set(toScreen.tx, 0, toScreen.tz);
            slot.holder.scale.set(toScreen.sx, 1, toScreen.sz);
            slot.holder.visible = layer.alpha > 0;
            const { uniforms } = slot.material;
            uniforms.uFade.value = layer.alpha;
            uniforms.uRise.value = layer.mult;
            uniforms.uYearMix.value = worldView.yearMix;
            // A filter changed while this stage is up: re-colour it in place (heights stay).
            // Turning every filter off keeps the old emphasis, so the dimming fades out rather than snapping.
            if (slot.baked !== wantedKey && highlightOn(highlight)) {
                rebakeStageColors(slot.stage, slot.bake, emphasisFor(highlight));
                slot.textures.colors.needsUpdate = true;
                slot.baked = wantedKey;
            }
            uniforms.uKelley.value += ((highlightOn(highlight) ? 1 : 0) - uniforms.uKelley.value) * kelleyStep;
            uniforms.uSchool.value += ((highlight.school ? 1 : 0) - uniforms.uSchool.value) * kelleyStep;
            // The school's hills: bake its sunk layers a slice a frame, swap them in
            // only once the old school's have risen back, then sink smoothly.
            const school = highlight.school;
            if (school && slot.sunkFor !== school.id && slot.sunkBaking?.school !== school.id) {
                slot.sunkBaking = { school: school.id, step: sunkBaker(slot.stage, slot.bake, school).step };
            }
            if (slot.sunkBaking) {
                const heights = slot.sunkBaking.step(SINK_BAKE_BUDGET_MS);
                if (heights && slot.sinkProgress <= 0) {
                    installSunk(slot, heights, slot.sunkBaking.school, format);
                    slot.sunkBaking = null;
                }
            }
            const sinkTo = school && slot.sunkFor === school.id ? 1 : 0;
            slot.sinkProgress = sinkStep(slot.sinkProgress, sinkTo, delta, reduced);
            slot.bake.sink = sinkEase(slot.sinkProgress);
            uniforms.uSink.value = slot.bake.sink;
            // The cursor glow, from the screen's ground back to the stage's.
            const fromScreen = composeMaps(slot.stage.map, invertMap(worldView.map));
            uniforms.uMouse.value.set(mapX(fromScreen, worldPointer.mouseX), mapZ(fromScreen, worldPointer.mouseZ));
            const opaque = layer.alpha >= 1;
            slot.material.depthWrite = opaque;
            slot.holder.children[0].renderOrder = opaque ? ORDER.opaque : ORDER.fading;
        }

        // Labels and input follow what is drawn: the level's stage once it is fully in, the world once it is back.
        const drawn = level.drawnStage;
        if (wanted) {
            const slot = live.get(wanted);
            if (slot && layerOf(wanted).alpha >= DRAWN && drawn !== slot.stage) useWorldStore.setState({ drawnStage: slot.stage });
        }
        else if (drawn && layerOf(WORLD_LAYER).alpha >= DRAWN) useWorldStore.setState({ drawnStage: null });
    });

    return <group ref={groupRef} />;
};
