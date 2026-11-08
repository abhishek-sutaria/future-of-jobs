/**
 * A family or field is its rectangle on the world map, magnified: one map per
 * stage sends every job, tile and edge there, and a flight blends between maps,
 * so a level change is a zoom. Layout, heights, the bake and the flight are
 * pure, so all of it is checked here against the real 833 peaks. What the GPU
 * does with them is measured on the preview.
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { useStore } from '../store';
import { SCENE, SHADER, YEAR_MAX, YEAR_MIN } from '../config/constants';
import { RISK_UNSCORED_RGB } from '../config/theme';
import { SOC_FAMILIES } from '../config/socFamilies';
import { buildWorldScene, GROUND_Y, peakEmploymentAt } from '../components/world/worldScene';
import { applyStageView, framingDistance, stageFitView, stageFraming, stageGroundY, stageViewOffset, type StageView } from '../components/world/framing';
import { MAX_STAGE_TILES, STAGE_SEGMENTS, stageFragmentShader, stageVertexShader } from '../components/world/stageShaders';
import { INDEX_CONTINENTS, INDEX_OCCUPATION_BY_SOC } from '../utils/occupationIndex';
import {
    bakeStage, packHeights, rayToSurface, STAGE_BLEND, STAGE_BLEND_POWER, STAGE_HEIGHT_RANGE, STAGE_MIN_HEIGHT, STAGE_PEAK_HEIGHT,
    stageEdgeTaper, stageJobHeight, stageMaxEmployment, stageSegments, surfaceHeight, yearMix,
} from '../utils/stageBake';
import { buildStage, stageEdgeBand, stageKey, STAGE_SIGMA_MAX, STAGE_SIGMA_MIN, type Stage, type StageJob } from '../utils/stageLayout';
import {
    blendMaps, composeMaps, FIELD_MAX_ASPECT, fieldStretch, IDENTITY_MAP, invertMap, mapPoint, mapRect, mapX, mapZ, STAGE_FIT, stageMapFor, type PlaneMap,
} from '../utils/stageMap';
import { beginTransition, INNER_FADE, levelViewOf, OUTER_FADE, restState, viewAt, WORLD_LAYER, type ViewState } from '../utils/stageTransition';
import { rectDepth, rectWidth, regionAt, WORLD_BOUNDS, type Rect } from '../utils/worldLayout';
import { familyLevel, fieldLevel, WORLD_LEVEL, ZOOM_OUT_RATIO, type WorldLevel } from '../utils/worldLevel';

const scene = buildWorldScene(useStore.getState().jobs);
const LEVELS: WorldLevel[] = [...SOC_FAMILIES.map((f) => familyLevel(f.id)), ...INDEX_CONTINENTS.map((c) => fieldLevel(c.code))];
const stageOf = (level: WorldLevel) => buildStage(level, scene)!;
const STAGES = LEVELS.map(stageOf);
const named = STAGES.map((s) => [s.key, s] as const);
const bakeOf = (stage: Stage, longSide = 128) => bakeStage(stage, stageSegments(stage.outline, longSide), STAGE_BLEND, STAGE_BLEND_POWER, stageEdgeBand(stage));
const top = (heights: Float32Array, layer: 0 | 1) => {
    let max = 0;
    for (let i = layer; i < heights.length; i += 2) max = Math.max(max, heights[i]);
    return max;
};
const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
const expectRect = (a: Rect, b: Rect, what: string) => {
    for (const k of ['x0', 'z0', 'x1', 'z1'] as const) expect(Math.abs(a[k] - b[k]), `${what} ${k}`).toBeLessThan(1e-6);
};
const world = (key: string) => scene.peakByKey.get(key)!;

describe('the counts', () => {
    it('stay at 830 jobs (833 peaks: three Kelley SOCs carry two titles) and 22 fields', () => {
        expect(INDEX_CONTINENTS).toHaveLength(22);
        expect(scene.layout.regions).toHaveLength(22);
        expect(scene.peaks).toHaveLength(833);
        expect(new Set(scene.peaks.map((p) => p.entry.soc)).size).toBe(830);
        expect(STAGES).toHaveLength(27);
    });

    it('put every job on its field\'s stage once and its family\'s stage once', () => {
        const fields = STAGES.filter((s) => s.kind === 'field');
        const families = STAGES.filter((s) => s.kind === 'family');
        expect(fields.reduce((n, s) => n + s.jobs.length, 0)).toBe(833);
        expect(families.reduce((n, s) => n + s.jobs.length, 0)).toBe(833);
        for (const s of STAGES) expect(new Set(s.jobs.map((j) => j.key)).size, s.key).toBe(s.jobs.length);
    });
});

describe('one map per stage', () => {
    it.each(named)('%s: one map sends every job\'s world position to its stage position', (_key, stage) => {
        const { map } = stage;
        expect(map.sx).toBeGreaterThan(0);
        expect(map.sz).toBeGreaterThan(0);
        // A family is a uniform scale and a translation; only a field may stretch, and only past FIELD_MAX_ASPECT.
        if (stage.kind === 'family') expect(Math.abs(map.sx / map.sz - 1)).toBeLessThan(1e-12);
        for (const j of stage.jobs) {
            const p = world(j.key);
            expect(Math.abs(mapX(map, p.x) - j.x), j.key).toBeLessThan(1e-6);
            expect(Math.abs(mapZ(map, p.z) - j.z), j.key).toBeLessThan(1e-6);
        }
    });

    it.each(named)('%s: its edge and every tile are the images of their world rectangles under the same map', (_key, stage) => {
        const worldRect = stage.kind === 'family'
            ? scene.layout.families.find((f) => `family:${f.family.id}` === stage.key)!.rect
            : scene.layout.regionByCode.get(stage.key.slice(6))!.rect;
        expectRect(stage.worldOutline, worldRect, 'world outline');
        expectRect(stage.outline, mapRect(stage.map, worldRect), 'outline');
        const expected = stage.kind === 'family'
            ? scene.layout.regions.filter((r) => stage.jobs.some((j) => j.code === r.code)).map((r) => r.rect)
            : scene.layout.minorGroupsByContinent.get(stage.key.slice(6))!.map((g) => g.rect);
        expect(stage.tiles).toHaveLength(expected.length);
        stage.tiles.forEach((t, i) => {
            expectRect(t.worldRect, expected[i], `tile ${i}`);
            expectRect(t.rect, mapRect(stage.map, expected[i]), `tile ${i}`);
        });
        expect(stage.tiles.length).toBeLessThanOrEqual(MAX_STAGE_TILES);
    });

    it('stretches only fields too thin to read, toward a square, and never past FIELD_MAX_ASPECT', () => {
        const stretched: string[] = [];
        for (const r of scene.layout.regions) {
            const s = fieldStretch(r.rect);
            const stage = stageOf(fieldLevel(r.code));
            const aspect = rectWidth(stage.outline) / rectDepth(stage.outline);
            expect(aspect, r.code).toBeGreaterThanOrEqual(1 / FIELD_MAX_ASPECT - 1e-9);
            expect(aspect, r.code).toBeLessThanOrEqual(FIELD_MAX_ASPECT + 1e-9);
            if (s.x !== 1 || s.z !== 1) stretched.push(r.code);
            else expect(Math.abs(stage.map.sx / stage.map.sz - 1), r.code).toBeLessThan(1e-12);
        }
        // At 1.2 every field but the two already near square (Personal Care 1.05, Production 0.92):
        // the deep ones (Business & Finance 1:1.77, Farming, Fishing & Forestry 1:4) and the wide ones (Construction 1.83).
        expect(stretched).toEqual(['11', '13', '15', '17', '19', '21', '23', '25', '27', '29', '31', '33', '35', '37', '41', '43', '45', '47', '49', '53']);
        expect(FIELD_MAX_ASPECT).toBe(1.2);
    });

    it('fills the fit box: every stage touches it on one side and stays inside it', () => {
        for (const stage of STAGES) {
            const w = rectWidth(stage.outline);
            const d = rectDepth(stage.outline);
            expect(w, stage.key).toBeLessThanOrEqual(STAGE_FIT.width + 1e-9);
            expect(d, stage.key).toBeLessThanOrEqual(STAGE_FIT.depth + 1e-9);
            expect(Math.max(w / STAGE_FIT.width, d / STAGE_FIT.depth), stage.key).toBeCloseTo(1, 9);
        }
    });

    it('never changes a job\'s neighbours: left of, in front of, is the same at every level', () => {
        for (const stage of STAGES) {
            const jobs = stage.jobs;
            for (let i = 0; i < jobs.length; i++) {
                const a = world(jobs[i].key);
                for (let k = i + 1; k < jobs.length; k++) {
                    const b = world(jobs[k].key);
                    if (Math.abs(a.x - b.x) > 1e-9) expect(Math.sign(jobs[i].x - jobs[k].x)).toBe(Math.sign(a.x - b.x));
                    if (Math.abs(a.z - b.z) > 1e-9) expect(Math.sign(jobs[i].z - jobs[k].z)).toBe(Math.sign(a.z - b.z));
                }
            }
        }
    });

    it('lands the same job in the same place every time, whatever the year or the jobs array', () => {
        for (const level of LEVELS) {
            const a = stageOf(level);
            const b = buildStage(level, buildWorldScene([...useStore.getState().jobs]))!;
            expect(b.jobs.map((j) => [j.key, j.x, j.z])).toEqual(a.jobs.map((j) => [j.key, j.x, j.z]));
        }
        expect(buildStage.length).toBe(2); // takes no year
    });

    it('has no stage at the world', () => {
        expect(buildStage(WORLD_LEVEL, scene)).toBeNull();
        expect(stageKey(WORLD_LEVEL)).toBeNull();
    });

    it('a field inside its family\'s stage is the same block: the family map, then the field map', () => {
        for (const c of INDEX_CONTINENTS) {
            const field = stageOf(fieldLevel(c.code));
            const family = stageOf(familyLevel(fieldLevel(c.code).focusedFamily!));
            const familyToField = composeMaps(field.map, invertMap(family.map));
            for (const j of field.jobs) {
                const onFamily = family.byKey.get(j.key)!;
                expect(Math.abs(mapX(familyToField, onFamily.x) - j.x)).toBeLessThan(1e-6);
                expect(Math.abs(mapZ(familyToField, onFamily.z) - j.z)).toBeLessThan(1e-6);
            }
        }
    });

    it('sizes each hill from its own world footprint, inside what the mesh can draw', () => {
        for (const stage of STAGES) {
            for (const j of stage.jobs) {
                expect(j.sigma).toBeGreaterThanOrEqual(STAGE_SIGMA_MIN);
                expect(j.sigma).toBeLessThanOrEqual(STAGE_SIGMA_MAX);
            }
        }
    });
});

describe('related jobs grouped', () => {
    it('gives every SOC minor group its own block in its field, sized by its job count, with its jobs inside it in SOC order', () => {
        for (const c of INDEX_CONTINENTS) {
            const groups = scene.layout.minorGroupsByContinent.get(c.code)!;
            const peaks = scene.layout.peaksByContinent.get(c.code)!;
            expect(groups.reduce((n, g) => n + g.keys.length, 0), c.code).toBe(peaks.length);
            const region = scene.layout.regionByCode.get(c.code)!.rect;
            const inner = rectWidth(region) * rectDepth(region);
            const area = groups.reduce((a, g) => a + rectWidth(g.rect) * rectDepth(g.rect), 0);
            for (const g of groups) {
                const share = (rectWidth(g.rect) * rectDepth(g.rect)) / area;
                expect(share, `${g.minor}`).toBeCloseTo(g.keys.length / peaks.length, 9);
                for (const key of g.keys) {
                    expect(INDEX_OCCUPATION_BY_SOC.get(world(key).entry.soc)!.minor).toBe(g.minor);
                    const p = world(key);
                    expect(p.x > g.rect.x0 && p.x < g.rect.x1 && p.z > g.rect.z0 && p.z < g.rect.z1, key).toBe(true);
                }
                const socs = g.keys.map((k) => world(k).entry.soc);
                expect([...socs].sort()).toEqual(socs);
            }
            expect(area).toBeLessThan(inner);
            // Blocks follow SOC order.
            expect(groups.map((g) => g.minor)).toEqual([...groups.map((g) => g.minor)].sort());
        }
    });

    it('keeps every minor group contiguous: its block holds its jobs and no one else\'s', () => {
        for (const c of INDEX_CONTINENTS) {
            const groups = scene.layout.minorGroupsByContinent.get(c.code)!;
            for (const g of groups) {
                const inside = scene.layout.peaksByContinent.get(c.code)!.filter((p) => p.x > g.rect.x0 && p.x < g.rect.x1 && p.z > g.rect.z0 && p.z < g.rect.z1);
                expect(new Set(inside.map((p) => p.key))).toEqual(new Set(g.keys));
            }
            for (let i = 0; i < groups.length; i++) {
                for (let k = i + 1; k < groups.length; k++) {
                    const a = groups[i].rect;
                    const b = groups[k].rect;
                    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 1e-9;
                    expect(overlap, `${groups[i].minor} / ${groups[k].minor}`).toBe(false);
                }
            }
        }
    });

    it('is the same layout at world, family and field level: one map carries each block and its jobs', () => {
        for (const c of INDEX_CONTINENTS) {
            const groups = scene.layout.minorGroupsByContinent.get(c.code)!;
            const field = stageOf(fieldLevel(c.code));
            const family = stageOf(familyLevel(fieldLevel(c.code).focusedFamily!));
            for (const stage of [field, family]) {
                for (const g of groups) {
                    const block = mapRect(stage.map, g.rect);
                    for (const key of g.keys) {
                        const j = stage.byKey.get(key)!;
                        expect(j.x > block.x0 && j.x < block.x1 && j.z > block.z0 && j.z < block.z1, `${stage.key} ${key}`).toBe(true);
                    }
                    // No other job of the stage inside the block.
                    const inside = stage.jobs.filter((j) => j.x > block.x0 && j.x < block.x1 && j.z > block.z0 && j.z < block.z1).map((j) => j.key);
                    expect(new Set(inside)).toEqual(new Set(g.keys));
                }
            }
            field.tiles.forEach((t, i) => expect(t.minor).toBe(groups[i].minor));
        }
    });

    it('finds the field under any point of a family\'s stage from the world map itself', () => {
        for (const family of SOC_FAMILIES) {
            const stage = stageOf(familyLevel(family.id));
            const back = invertMap(stage.map);
            for (const j of stage.jobs) {
                const p = mapPoint(back, j.x, j.z);
                expect(regionAt(scene.layout.regions, p.x, p.z)?.code).toBe(j.code);
            }
        }
    });
});

describe('the camera', () => {
    it('is the live view\'s camera angle, read from the same constants', () => {
        expect(SCENE.CAMERA_INITIAL_POSITION).toEqual([0, 35, 55]);
        expect(SCENE.CAMERA_FOV).toBe(45);
        expect((Math.atan2(35, 55) * 180) / Math.PI).toBeCloseTo(32.47, 2);
        expect(SCENE.CAMERA_PORTRAIT_POSITION).toEqual([0, 74, 58]);
        expect(SCENE.CAMERA_PORTRAIT_FOV).toBe(70);
        expect(stageFraming(45)).toEqual({ target: [0, 0, 0], position: [0, 35, 55] });
        expect(stageFraming(70)).toEqual({ target: [0, 0, 0], position: [0, 74, 58] });
    });

    it('orbits about the centre of the focused rectangle, on all 27 stages', () => {
        for (const stage of STAGES) {
            const c = centre(stage.worldOutline);
            const onStage = mapPoint(stage.map, c.x, c.z);
            for (const fov of [45, 70]) {
                const { target } = stageFraming(fov);
                expect(Math.abs(target[0] - onStage.x), stage.key).toBeLessThan(1e-9);
                expect(Math.abs(target[2] - onStage.z), stage.key).toBeLessThan(1e-9);
            }
            const sc = centre(stage.outline);
            expect(Math.hypot(sc.x, sc.z), stage.key).toBeLessThan(1e-9);
        }
    });

    it('leaves the hand zoom-out threshold inside the orbit limit, on both', () => {
        for (const fov of [45, 70]) expect(framingDistance(stageFraming(fov)) * ZOOM_OUT_RATIO).toBeLessThan(SCENE.MAX_CAMERA_DISTANCE);
    });
});

describe('what the camera sees', () => {
    const cameraAt = (width: number, height: number, fov: number, offset = 0) => {
        const camera = new PerspectiveCamera(fov, width / height, 0.1, 2000);
        const { position, target } = stageFraming(fov);
        camera.position.set(...position);
        camera.lookAt(new Vector3(...target));
        camera.updateMatrixWorld();
        if (offset) camera.setViewOffset(width, height, 0, offset, width, height);
        else camera.updateProjectionMatrix();
        return camera;
    };
    const screen = (camera: PerspectiveCamera, width: number, height: number, p: Vector3) => {
        const v = p.clone().project(camera);
        return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
    };
    const corners = (r: Rect) => [new Vector3(r.x0, GROUND_Y, r.z0), new Vector3(r.x1, GROUND_Y, r.z0), new Vector3(r.x0, GROUND_Y, r.z1), new Vector3(r.x1, GROUND_Y, r.z1)];

    it('knows where a point of the stage\'s ground lands from the home camera', () => {
        for (const z of [-19, 0, 19]) {
            expect(stageGroundY(70, 844, z)).toBeCloseTo(screen(cameraAt(390, 844, 70), 390, 844, new Vector3(0, GROUND_Y, z)).y, 6);
        }
    });

    // The free band at a family or field on a 390x844 phone, as WorldMarkers measures it (chrome to 312, slider from 642).
    it('fits every stage\'s rectangle in a 390x844 phone\'s free band, with the camera unmoved', () => {
        for (const stage of STAGES) {
            const offset = stageViewOffset(70, 844, 312, 642, stage.outline);
            const camera = cameraAt(390, 844, 70, offset);
            expect(camera.position.toArray()).toEqual([0, 74, 58]);
            for (const c of corners(stage.outline)) {
                const s = screen(camera, 390, 844, c);
                expect(s.x, stage.key).toBeGreaterThanOrEqual(8);
                expect(s.x, stage.key).toBeLessThanOrEqual(390 - 8);
                expect(s.y, stage.key).toBeGreaterThanOrEqual(312);
                expect(s.y, stage.key).toBeLessThanOrEqual(642);
            }
        }
    });

    it('slides everything the same distance, so labels and pins follow it exactly', () => {
        const offset = stageViewOffset(70, 844, 312, 642, stageOf(familyLevel(1)).outline);
        for (const point of [new Vector3(10, 5, -20), new Vector3(-20, -3, 8)]) {
            expect(screen(cameraAt(390, 844, 70, offset), 390, 844, point).y - screen(cameraAt(390, 844, 70), 390, 844, point).y).toBeCloseTo(-offset, 6);
        }
    });

    it('keeps hit testing true: a ray through a point on screen lands back on that point', () => {
        const camera = cameraAt(390, 844, 70, stageViewOffset(70, 844, 312, 642, stageOf(fieldLevel('51')).outline));
        const point = new Vector3(12, GROUND_Y, -9);
        const ndc = point.clone().project(camera);
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
        const hit = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -GROUND_Y), new Vector3())!;
        expect(hit.x).toBeCloseTo(point.x, 4);
        expect(hit.z).toBeCloseTo(point.z, 4);
    });

    // Desktop chrome at a stage, measured in Chrome on this branch: the fields bar and its info line end at 220px
    // at every width; the year slider starts 156.75px above the bottom of the window.
    const DESKTOP_BAND_TOP = 220;
    const sliderTop = (height: number) => height - 156.75;
    const DESKTOPS = [[1280, 680], [1470, 723], [1470, 746], [1920, 958]] as const;
    const cameraWith = (width: number, height: number, view: StageView) => {
        const camera = cameraAt(width, height, 45);
        applyStageView(camera, width, height, view);
        return camera;
    };

    it('used to hide the near edge of deep stages under the slider on a short laptop window', () => {
        const hidden = STAGES.filter((stage) => screen(cameraAt(1470, 723, 45), 1470, 723, new Vector3(0, GROUND_Y, stage.outline.z1)).y > sliderTop(723));
        expect(hidden.map((s) => s.key)).toContain('family:2');
        expect(hidden.map((s) => s.key)).toContain('field:35');
    });

    it('shows every stage\'s whole rectangle between the chrome and the slider on desktops down to 1280x680, by a slide alone', () => {
        for (const [width, height] of DESKTOPS) {
            for (const stage of STAGES) {
                const view = stageFitView(45, height, DESKTOP_BAND_TOP, sliderTop(height), stage.outline);
                expect(view.scale, `${stage.key} ${width}x${height}`).toBe(1);
                const camera = cameraWith(width, height, view);
                expect(camera.position.toArray()).toEqual([0, 35, 55]);
                for (const c of corners(stage.outline)) {
                    const s = screen(camera, width, height, c);
                    const what = `${stage.key} ${width}x${height}`;
                    expect(s.x, what).toBeGreaterThanOrEqual(8);
                    expect(s.x, what).toBeLessThanOrEqual(width - 8);
                    expect(s.y, what).toBeGreaterThanOrEqual(DESKTOP_BAND_TOP);
                    expect(s.y, what).toBeLessThanOrEqual(sliderTop(height));
                }
            }
        }
    });

    it('slides only as far as it must: nothing on 1920x958, about 30px on 1280x680', () => {
        const deepest = (height: number) => Math.max(...STAGES.map((stage) => stageFitView(45, height, DESKTOP_BAND_TOP, sliderTop(height), stage.outline).offsetY));
        expect(deepest(958)).toBe(0);
        expect(deepest(680)).toBeGreaterThan(25);
        expect(deepest(680)).toBeLessThan(35);
    });

    it('shows a little more of the scene, centred, only on a window too short for a slide, and still fits', () => {
        const [width, height] = [1280, 600];
        for (const stage of STAGES) {
            const view = stageFitView(45, height, DESKTOP_BAND_TOP, sliderTop(height), stage.outline);
            const camera = cameraWith(width, height, view);
            if (rectDepth(stage.outline) > 37) expect(view.scale, stage.key).toBeGreaterThan(1);
            expect(camera.position.toArray()).toEqual([0, 35, 55]);
            for (const c of corners(stage.outline)) {
                const s = screen(camera, width, height, c);
                expect(s.x, stage.key).toBeGreaterThanOrEqual(8);
                expect(s.x, stage.key).toBeLessThanOrEqual(width - 8);
                expect(s.y, stage.key).toBeGreaterThanOrEqual(DESKTOP_BAND_TOP - 1e-6);
                expect(s.y, stage.key).toBeLessThanOrEqual(sliderTop(height) + 1e-6);
            }
        }
    });

    it('keeps hit testing true through a desktop slide and zoom-out alike', () => {
        for (const [width, height] of [[1280, 680], [1280, 600]] as const) {
            const view = stageFitView(45, height, DESKTOP_BAND_TOP, sliderTop(height), stageOf(fieldLevel('35')).outline);
            const camera = cameraWith(width, height, view);
            const point = new Vector3(7, GROUND_Y, 16);
            const ndc = point.clone().project(camera);
            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
            const hit = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -GROUND_Y), new Vector3())!;
            expect(hit.x).toBeCloseTo(point.x, 4);
            expect(hit.z).toBeCloseTo(point.z, 4);
        }
    });

    // With no view at all, as a 1920x958 window keeps it: header to 144px, slider from 801px.
    it('shows every stage\'s rectangle whole on a 1920x958 desktop, clear of the header and the slider', () => {
        const camera = cameraAt(1920, 958, 45);
        for (const stage of STAGES) {
            for (const c of corners(stage.outline)) {
                const s = screen(camera, 1920, 958, c);
                expect(s.x, stage.key).toBeGreaterThan(0);
                expect(s.x, stage.key).toBeLessThan(1920);
                expect(s.y, stage.key).toBeGreaterThan(144);
                expect(s.y, stage.key).toBeLessThan(801);
            }
        }
    });
});

describe('heights', () => {
    it('uses one fixed scale per stage: the largest employment on the path, as the whole map does', () => {
        for (const stage of STAGES) {
            const peak = Math.max(...stage.jobs.flatMap((j) => [j.ep2025, j.ep2035]));
            expect(stageMaxEmployment(stage.jobs), stage.key).toBe(peak);
            const scale = stageMaxEmployment(stage.jobs);
            const tallest = Math.max(...stage.jobs.flatMap((j) => [stageJobHeight(j, 0, scale), stageJobHeight(j, 1, scale)]));
            expect(tallest, stage.key).toBeCloseTo(STAGE_PEAK_HEIGHT, 6);
            for (const f of [0, 0.45, 1]) {
                for (const j of stage.jobs) {
                    const employment = peakEmploymentAt(world(j.key).entry, YEAR_MIN + (YEAR_MAX - YEAR_MIN) * f);
                    expect((stageJobHeight(j, f, scale) - STAGE_MIN_HEIGHT) / (STAGE_PEAK_HEIGHT - STAGE_MIN_HEIGHT)).toBeCloseTo(employment / scale, 6);
                }
            }
        }
    });

    it.each(['field', 'family'] as const)('moves 0 of the 830 jobs against BLS on the slider at %s level', (kind) => {
        const socs = new Set<string>();
        let contradictions = 0;
        for (const stage of STAGES.filter((s) => s.kind === kind)) {
            const scale = stageMaxEmployment(stage.jobs);
            for (const j of stage.jobs) {
                socs.add(world(j.key).entry.soc);
                const bls = Math.sign(j.ep2035 - j.ep2025);
                const drawn = Math.sign(stageJobHeight(j, 1, scale) - stageJobHeight(j, 0, scale));
                if (drawn !== bls) contradictions++;
            }
        }
        expect(socs.size).toBe(830);
        expect(contradictions).toBe(0);
    });

    // Own heights are clean; the blended surface at a job's spot can still follow
    // a neighbour's flank. This records exactly how often, on the desktop mesh, so
    // the number can only change on purpose.
    it('keeps the surface honest: only these jobs still move against BLS, each on a neighbour\'s flank', () => {
        const opposite = new Map<string, number>();
        let largest = 0;
        for (const stage of STAGES) {
            const bake = bakeOf(stage, STAGE_SEGMENTS.desktop);
            for (const j of stage.jobs) {
                const bls = Math.sign(j.ep2035 - j.ep2025);
                const moved = surfaceHeight(bake, j.x, j.z, 1) - surfaceHeight(bake, j.x, j.z, 0);
                if (bls === 0 || Math.sign(moved) === bls) continue;
                opposite.set(stage.key, (opposite.get(stage.key) ?? 0) + 1);
                largest = Math.max(largest, Math.abs(moved));
            }
        }
        expect(Object.fromEntries(opposite)).toEqual(RECORDED_SURFACE_OPPOSITE);
        // Under half a percent of a full-height hill.
        expect(largest).toBeLessThan(0.0625);
    });

    it('holds Waiters and Waitresses to their 2.0% growth, the case that showed the bug', () => {
        const stage = stageOf(fieldLevel('35'));
        const scale = stageMaxEmployment(stage.jobs);
        const waiters = stage.jobs.find((j) => world(j.key).entry.title.startsWith('Waiters'))!;
        expect(stageJobHeight(waiters, 1, scale)).toBeGreaterThan(stageJobHeight(waiters, 0, scale));
    });

    it('reads the live view\'s height range', () => {
        expect(STAGE_PEAK_HEIGHT).toBe(SHADER.HEIGHT_CLAMP_MAX * SHADER.HEIGHT_SCALE);
        expect(STAGE_MIN_HEIGHT).toBe(SHADER.HEIGHT_CLAMP_MIN * SHADER.HEIGHT_SCALE);
    });

    it('maps slider years onto the two baked layers', () => {
        expect(yearMix(YEAR_MIN)).toBe(0);
        expect(yearMix(YEAR_MAX)).toBe(1);
        expect(yearMix(2030)).toBeCloseTo(0.5, 9);
        expect(yearMix(1999)).toBe(0);
    });
});

/** Recorded by the test above: stage key → jobs whose blended surface moves against their own BLS number. */
const RECORDED_SURFACE_OPPOSITE: Record<string, number> = {
    'family:1': 20, 'family:2': 4, 'family:3': 2, 'family:4': 12, 'family:5': 5,
    // Fields at FIELD_MAX_ASPECT 1.2: more of them stretch toward a square, which moves hills relative to their neighbours
    // (at 1.5 it was 11: 2, 27: 1, 33: 1, 47: 5 and nothing on 53; 14 field jobs then, 18 now, all under the bound above).
    'field:11': 1, 'field:27': 2, 'field:33': 2, 'field:39': 1, 'field:41': 1, 'field:43': 1, 'field:47': 7, 'field:49': 1, 'field:51': 1, 'field:53': 1,
};

describe.each(named)('the bake of %s', (_key, stage) => {
    const bake = bakeOf(stage);

    it('covers exactly the stage\'s rectangle, with square texels', () => {
        expectRect(bake.rect, stage.outline, 'bake');
        const tx = rectWidth(stage.outline) / (bake.cols - 1);
        const tz = rectDepth(stage.outline) / (bake.rows - 1);
        expect(Math.abs(tx / tz - 1)).toBeLessThan(0.08);
        expect(bake.heights).toHaveLength(bake.cols * bake.rows * 2);
    });

    it('has no NaN and nothing out of range anywhere', () => {
        for (const h of bake.heights) {
            expect(Number.isFinite(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(STAGE_HEIGHT_RANGE);
        }
    });

    it('tops out at the live view\'s tallest hill in whichever year its largest job peaks', () => {
        const tallest = Math.max(top(bake.heights, 0), top(bake.heights, 1));
        expect(tallest).toBeGreaterThan(STAGE_PEAK_HEIGHT * 0.95);
        expect(tallest).toBeLessThan(STAGE_PEAK_HEIGHT * 1.1);
    });

    it('comes down to the ground on its edge, a clean straight edge, without touching any job\'s own spot', () => {
        for (let col = 0; col < bake.cols; col++) {
            for (const row of [0, bake.rows - 1]) {
                const i = (row * bake.cols + col) * 2;
                expect(bake.heights[i]).toBeLessThan(1e-6);
                expect(bake.heights[i + 1]).toBeLessThan(1e-6);
            }
        }
        for (let row = 0; row < bake.rows; row++) {
            for (const col of [0, bake.cols - 1]) expect(bake.heights[(row * bake.cols + col) * 2]).toBeLessThan(1e-6);
        }
        const band = stageEdgeBand(stage);
        for (const j of stage.jobs) expect(stageEdgeTaper(stage.outline, band, j.x, j.z), j.key).toBe(1);
    });
});

describe('the surface', () => {
    const lone: StageJob = { key: 'a', code: '11', x: 4, z: -6, sigma: 2, ep2025: 1000, ep2035: 2000, color: [1, 0, 0], kelley: false };
    const outline: Rect = { x0: -35, z0: -35, x1: 35, z1: 35 };
    const stage = { jobs: [lone], outline };

    it('is one Gaussian hill for one job, with its own width, at the right spot', () => {
        const bake = bakeStage(stage, { x: 280, z: 280 }, 'sum', 1);
        expect(surfaceHeight(bake, 4, -6, 1)).toBeCloseTo(STAGE_PEAK_HEIGHT, 1);
        const away = surfaceHeight(bake, 4 + 2, -6, 1);
        expect(away).toBeCloseTo(STAGE_PEAK_HEIGHT * Math.exp(-(2 * 2) / SHADER.SIGMA_SQ2), 1);
    });

    it('lies the right way round: row 0 is the near edge, as the mesh\'s v = 0', () => {
        const bake = bakeStage({ jobs: [{ ...lone, x: 0, z: 20 }], outline }, { x: 140, z: 140 }, 'sum', 1);
        expect(surfaceHeight(bake, 0, 20, 1)).toBeGreaterThan(10);
        expect(surfaceHeight(bake, 0, -20, 1)).toBeLessThan(0.01);
        const nearRow = Math.round(((outline.z1 - 20) / 70) * 140);
        expect(bake.heights[(nearRow * 141 + 70) * 2 + 1]).toBeGreaterThan(10);
    });

    it('is the same lone hill either way: smooth max only differs where hills overlap', () => {
        const sum = bakeStage(stage, { x: 128, z: 128 }, 'sum', 1);
        const smooth = bakeStage(stage, { x: 128, z: 128 }, 'smoothmax', STAGE_BLEND_POWER);
        for (const [x, z] of [[4, -6], [6, -6], [4, -2], [0, 0]]) {
            expect(surfaceHeight(smooth, x, z, 0)).toBeCloseTo(surfaceHeight(sum, x, z, 0), 1);
        }
    });

    it('holds a job near its true height on the densest stage, which adding does not', () => {
        const dense = stageOf(familyLevel(1));
        const max = stageMaxEmployment(dense.jobs);
        const inflation = (blend: 'sum' | 'smoothmax', power: number) => {
            const bake = bakeStage(dense, stageSegments(dense.outline, 256), blend, power);
            const r = dense.jobs.map((j) => surfaceHeight(bake, j.x, j.z, 0) / stageJobHeight(j, 0, max)).sort((a, b) => a - b);
            return r[r.length >> 1];
        };
        expect(inflation('sum', 1)).toBeGreaterThan(1.5);
        expect(inflation(STAGE_BLEND, STAGE_BLEND_POWER)).toBeLessThan(1.1);
    });

    it('moves with the year on one number alone: the two layers just mix', () => {
        const two: StageJob[] = [lone, { ...lone, key: 'b', x: -10, z: 10, ep2025: 2000, ep2035: 1000 }];
        const bake = bakeStage({ jobs: two, outline }, { x: 128, z: 128 }, 'smoothmax', STAGE_BLEND_POWER);
        const at = (m: number) => surfaceHeight(bake, 4, -6, m);
        expect(at(0.5)).toBeCloseTo((at(0) + at(1)) / 2, 5);
        expect(at(1)).toBeGreaterThan(at(0));
    });

    it('keeps published employment out of it: jobs carry EP levels straight through', () => {
        for (const j of stageOf(fieldLevel('51')).jobs) {
            const entry = world(j.key).entry;
            expect(j.ep2025).toBe(entry.ep2025);
            expect(j.ep2035).toBe(entry.ep2035);
        }
    });
});

describe('colour', () => {
    it('keeps unscored jobs the existing grey: an all-grey field bakes to nothing else', () => {
        const real = stageOf(fieldLevel('47'));
        expect(real.jobs.every((j) => !j.kelley)).toBe(true);
        // Real data: every unscored job on the stage carries the grey, every scored one does not.
        const unscoredKeys = new Set(scene.peaks.filter((p) => !p.entry.scored).map((p) => p.entry.key));
        const unscoredHere = real.jobs.filter((j) => unscoredKeys.has(j.key));
        expect(unscoredHere.length).toBeGreaterThan(0);
        const isGrey = (c: readonly number[]) => c.every((v, k) => Math.abs(v - RISK_UNSCORED_RGB[k]) < 1e-9);
        for (const j of real.jobs) expect(isGrey(j.color), j.key).toBe(unscoredKeys.has(j.key));
        // No field is all grey once the planned jobs are scored, so the bake rule
        // is checked on field 47 with every job unscored (its own layout and heights).
        const stage = { ...real, jobs: real.jobs.map((j) => ({ ...j, color: RISK_UNSCORED_RGB })) };
        const { colors } = bakeOf(stage);
        const grey = RISK_UNSCORED_RGB.map((c) => Math.round(c * 255));
        // Bare ground is its own colour; anywhere a job's colour reaches is the grey.
        let checked = 0;
        for (let i = 0; i < colors.length; i += 4) {
            if (colors[i] === 13 && colors[i + 1] === 26 && colors[i + 2] === 51) continue;
            checked++;
            for (let k = 0; k < 3; k++) expect(Math.abs(colors[i + k] - grey[k])).toBeLessThanOrEqual(1);
        }
        expect(checked).toBeGreaterThan(colors.length / 16);
    });

    it('blends scored jobs in, and marks Kelley ground for the filter', () => {
        const stage = stageOf(fieldLevel('13'));
        expect(stage.jobs.some((j) => j.kelley)).toBe(true);
        const { colors } = bakeOf(stage);
        let bright = 0;
        for (let i = 3; i < colors.length; i += 4) if (colors[i] > 200) bright++;
        expect(bright).toBeGreaterThan(100);
    });
});

describe('height textures', () => {
    it('survive the 8-bit fallback to within a thousandth of a world unit', () => {
        const heights = new Float32Array([0, 0.25, 7.5, 12.5, 15.999, 3.14159]);
        const packed = packHeights(heights);
        expect(packed).toHaveLength(heights.length * 2);
        heights.forEach((h, i) => {
            const back = ((packed[i * 2] * 256 + packed[i * 2 + 1]) / 65535) * STAGE_HEIGHT_RANGE;
            expect(Math.abs(back - h)).toBeLessThan(0.001);
        });
    });

    it('clamp rather than wrap', () => {
        const packed = packHeights(new Float32Array([-1, 99]));
        expect([packed[0], packed[1], packed[2], packed[3]]).toEqual([0, 0, 255, 255]);
    });

    it('take a lower resolution on phones, one pipeline at every size', () => {
        expect(STAGE_SEGMENTS.mobile).toBeLessThan(STAGE_SEGMENTS.desktop);
        for (const s of STAGES) {
            const bake = bakeOf(s, STAGE_SEGMENTS.mobile);
            expect(Math.max(bake.cols, bake.rows)).toBe(STAGE_SEGMENTS.mobile + 1);
        }
    });
});

describe('the stage shader', () => {
    it('has no job limit: no uniform array of jobs, no loop over peaks', () => {
        expect(stageVertexShader).not.toMatch(/uPeaks|for\s*\(/);
        expect(stageVertexShader).toContain('uHeights');
    });

    it('ends on the rectangle\'s own edge, with the world map\'s borders, and no circular fade', () => {
        expect(stageFragmentShader).not.toMatch(/distance\(vUv/);
        expect(stageFragmentShader).toContain('uOutline');
        expect(stageFragmentShader).toContain('uTiles');
        expect(stageFragmentShader).toContain('gl_FragColor = vec4(finalColor, uFade)');
    });

    it('compiles both ways without the uniform-array limit biting', () => {
        expect(stageVertexShader).toContain('#ifdef STAGE_PACKED');
    });
});

describe('finding the point under the pointer', () => {
    const hill = (x: number, z: number) => 10 * Math.exp(-(x * x + z * z) / 8);

    it('stops on the hill, not on the plane behind it', () => {
        const hit = rayToSurface([0, 30, 40], [0, -30 / 50, -40 / 50], -3, hill)!;
        const plane = (-3 - 30) / (-30 / 50);
        expect(hit.z).toBeGreaterThan(40 - plane * (40 / 50));
    });

    it('lands on the ground where nothing stands', () => {
        const hit = rayToSurface([30, 30, 0], [0, -1, 0], -3, () => 0)!;
        expect(hit.x).toBeCloseTo(30, 6);
        expect(hit.z).toBeCloseTo(0, 6);
    });

    it('misses when looking up', () => {
        expect(rayToSurface([0, 10, 0], [0, 1, 0], -3, hill)).toBeNull();
    });
});

describe('the flight', () => {
    const viewOf = (level: WorldLevel) => levelViewOf(level, scene);
    const WORLD = viewOf(WORLD_LEVEL);
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const FRAMES = Array.from({ length: 55 }, (_, i) => ease((i + 1) / 55)); // 900ms at 60fps
    const screenRect = (map: PlaneMap, r: Rect) => mapRect(map, r);
    const flights: [string, WorldLevel, WorldLevel][] = [
        ['world to family', WORLD_LEVEL, familyLevel(1)],
        ['family to field', familyLevel(1), fieldLevel('13')],
        ['world to field', WORLD_LEVEL, fieldLevel('51')],
        ['field to family', fieldLevel('51'), familyLevel(5)],
        ['family to world', familyLevel(4), WORLD_LEVEL],
    ];

    it.each(flights)('%s: starts and ends exactly on the two levels\' maps', (_n, a, b) => {
        const from = viewOf(a);
        const to = viewOf(b);
        const t = beginTransition(from, to, restState(from));
        const start = viewAt(t, 0);
        for (const k of ['sx', 'sz', 'tx', 'tz'] as const) expect(start.map[k]).toBeCloseTo(from.map[k], 9);
        expect(viewAt(t, 1).map).toEqual(to.map);
        expect(viewAt(t, 1).layers).toEqual(new Map([[to.key, { alpha: 1, mult: 1 }]]));
        expect(start.layers.get(from.key)).toEqual({ alpha: 1, mult: 1 });
    });

    it.each(flights)('%s: the block being opened grows or shrinks in place, never jumping', (_n, a, b) => {
        const from = viewOf(a);
        const to = viewOf(b);
        const block = (to.depth > from.depth ? to : from).rect;
        const t = beginTransition(from, to, restState(from));
        let prev = screenRect(from.map, block);
        let prevArea = rectWidth(prev) * rectDepth(prev);
        const growing = to.depth > from.depth;
        for (const k of FRAMES) {
            const r = screenRect(viewAt(t, k).map, block);
            // Each 60fps frame moves the block's corners by under a tenth of its own size.
            const size = Math.max(rectWidth(r), rectDepth(r));
            for (const c of ['x0', 'z0', 'x1', 'z1'] as const) expect(Math.abs(r[c] - prev[c]), `${c} at k=${k.toFixed(3)}`).toBeLessThan(size * 0.1);
            const area = rectWidth(r) * rectDepth(r);
            if (growing) expect(area).toBeGreaterThanOrEqual(prevArea - 1e-9);
            else expect(area).toBeLessThanOrEqual(prevArea + 1e-9);
            prev = r;
            prevArea = area;
        }
    });

    it.each(flights)('%s: the treemap and the stage show every job of the block in the same place at every frame', (_n, a, b) => {
        const from = viewOf(a);
        const to = viewOf(b);
        const inner = to.depth > from.depth ? b : a;
        const stage = stageOf(inner);
        const t = beginTransition(from, to, restState(from));
        for (const k of FRAMES) {
            const view = viewAt(t, k);
            const stageToScreen = composeMaps(view.map, invertMap(stage.map));
            for (const j of stage.jobs) {
                const p = world(j.key);
                expect(Math.abs(mapX(view.map, p.x) - mapX(stageToScreen, j.x))).toBeLessThan(1e-6);
                expect(Math.abs(mapZ(view.map, p.z) - mapZ(stageToScreen, j.z))).toBeLessThan(1e-6);
            }
        }
    });

    it('hands over at matched heights: the inner layer starts on the outer layer\'s scale and ends on its own', () => {
        for (const [, a, b] of flights) {
            const from = viewOf(a);
            const to = viewOf(b);
            const t = beginTransition(from, to, restState(from));
            const inner = to.depth > from.depth ? to : from;
            const outer = inner === to ? from : to;
            const goingIn = inner === to;
            // When the inner layer is first (or last) seen, it stands on the outer layer's scale.
            const handover = viewAt(t, goingIn ? 0.0001 : 0.9999).layers.get(inner.key)!;
            expect(handover.mult).toBeCloseTo(inner.heightRef / outer.heightRef, 3);
            // At rest on the inner level it stands on its own.
            const rest = goingIn ? viewAt(t, 1) : viewAt(t, 0);
            expect(rest.layers.get(inner.key)!.mult).toBeCloseTo(1, 9);
        }
    });

    it('lays the inner layer over the outer before the outer goes, so the block is never empty', () => {
        const from = WORLD;
        const to = viewOf(familyLevel(2));
        const goIn = beginTransition(from, to, restState(from));
        const goOut = beginTransition(to, from, restState(to));
        for (let i = 0; i <= 100; i++) {
            const k = i / 100;
            for (const [t, inner, outer] of [[goIn, to.key, from.key], [goOut, to.key, from.key]] as const) {
                const layers = viewAt(t, k).layers;
                const a = layers.get(inner)?.alpha ?? 0;
                const o = layers.get(outer)?.alpha ?? 0;
                // Where the block is, one of the two is always nearly opaque.
                expect(Math.max(a, o), `k=${k}`).toBeGreaterThan(0.85);
            }
        }
        expect(INNER_FADE[1]).toBeLessThan(OUTER_FADE[1]);
    });

    it('carries on smoothly when interrupted: Back half way into a family', () => {
        const to = viewOf(familyLevel(3));
        const goIn = beginTransition(WORLD, to, restState(WORLD));
        const mid = viewAt(goIn, 0.5);
        const back = beginTransition(to, WORLD, mid);
        const first = viewAt(back, 0);
        expect(first.map).toEqual(mid.map);
        for (const [key, s] of mid.layers) expect(first.layers.get(key)!.alpha).toBeCloseTo(s.alpha, 9);
        expect(viewAt(back, 1).layers).toEqual(new Map([[WORLD_LAYER, { alpha: 1, mult: 1 }]]));
        expect(viewAt(back, 1).map).toEqual(IDENTITY_MAP);
    });

    it('starts from a copy of what was on screen, so writing each frame back cannot speed the flight up', () => {
        const from = viewOf(fieldLevel('13'));
        const to = viewOf(familyLevel(1));
        const live = { ...restState(from) };
        const t = beginTransition(from, to, live);
        const fresh = beginTransition(from, to, restState(from));
        for (const k of FRAMES) {
            const v = viewAt(t, k);
            // What CameraRig does each frame.
            live.map = v.map;
            live.layers = v.layers;
            expect(v.map).toEqual(viewAt(fresh, k).map);
        }
    });

    it('rests on the world with the identity map and the national scale', () => {
        const rest: ViewState = restState(WORLD);
        expect(rest.map).toEqual(IDENTITY_MAP);
        expect(WORLD.rect).toEqual(WORLD_BOUNDS);
        expect(blendMaps(IDENTITY_MAP, IDENTITY_MAP, 0.5, { x: 3, z: 4 })).toEqual(IDENTITY_MAP);
        expect(stageMapFor(WORLD_BOUNDS, 'family').sx).toBeGreaterThan(0);
    });
});
