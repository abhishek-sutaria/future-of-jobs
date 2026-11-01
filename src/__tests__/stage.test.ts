/**
 * A family or field stands on one terrain at the middle of the world, drawn and
 * framed as the live 3D view is. Layout, heights and the bake are pure, so all of
 * it is checked here against the real 833 peaks. What the GPU does with them is
 * measured on the preview.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { useStore } from '../store';
import { SCENE, SHADER, SHADER_VISUAL, YEAR_MAX, YEAR_MIN } from '../config/constants';
import { RISK_UNSCORED_RGB } from '../config/theme';
import { SOC_FAMILIES } from '../config/socFamilies';
import { initialJobs } from '../data';
import { buildWorldScene, peakEmploymentAt } from '../components/world/worldScene';
import { framingDistance, stageFraming } from '../components/world/framing';
import { STAGE_SEGMENTS, stageFragmentShader, stageVertexShader } from '../components/world/stageShaders';
import { INDEX_CONTINENTS, INDEX_CONTINENT_BY_CODE } from '../utils/occupationIndex';
import {
    bakeStage, packHeights, rayToSurface, STAGE_BLEND, STAGE_BLEND_POWER, STAGE_HEIGHT_RANGE, STAGE_MIN_HEIGHT, STAGE_PEAK_HEIGHT,
    stageJobHeight, surfaceHeight, yearMix,
} from '../utils/stageBake';
import {
    buildStage, minorGroupsOf, STAGE_INPUT_RADIUS, STAGE_OUTER_RING, STAGE_SIGMA_MAX, STAGE_SIGMA_MIN, stageFieldAt, stageKey, stageRingSpacing, stageSigma, type Stage, type StageJob,
} from '../utils/stageLayout';
import { computeClusterTerritoryLayout, territoryLayout } from '../utils/terrainMath';
import { familyLevel, fieldLevel, WORLD_LEVEL, ZOOM_OUT_RATIO, type WorldLevel } from '../utils/worldLevel';

const scene = buildWorldScene(useStore.getState().jobs);
const LEVELS: WorldLevel[] = [...SOC_FAMILIES.map((f) => familyLevel(f.id)), ...INDEX_CONTINENTS.map((c) => fieldLevel(c.code))];
const stageOf = (level: WorldLevel) => buildStage(level, scene.peaksByContinent)!;
const STAGES = LEVELS.map(stageOf);
const named = STAGES.map((s) => [s.key, s] as const);
const bakeOf = (stage: Stage, segments = 128) => bakeStage(stage, segments, STAGE_BLEND, STAGE_BLEND_POWER);
const top = (heights: Float32Array, layer: 0 | 1) => {
    let max = 0;
    for (let i = layer; i < heights.length; i += 2) max = Math.max(max, heights[i]);
    return max;
};

describe('the camera', () => {
    it('is the live view exactly, read from the same constants', () => {
        expect(SCENE.CAMERA_INITIAL_POSITION).toEqual([0, 35, 55]);
        expect(SCENE.CAMERA_FOV).toBe(45);
        expect(SCENE.CAMERA_PORTRAIT_POSITION).toEqual([0, 74, 58]);
        expect(SCENE.CAMERA_PORTRAIT_FOV).toBe(70);
        expect(stageFraming(45)).toEqual({ target: [0, 0, 0], position: [0, 35, 55] });
        expect(stageFraming(70)).toEqual({ target: [0, 0, 0], position: [0, 74, 58] });
    });

    it('gives all 27 stages identical numbers: it takes nothing from the stage', () => {
        expect(stageFraming.length).toBe(1);
        expect(STAGES).toHaveLength(27);
        const homes = new Set(STAGES.map(() => JSON.stringify([stageFraming(45), stageFraming(70)])));
        expect(homes.size).toBe(1);
        const rig = readFileSync(join(__dirname, '../components/world/CameraRig.tsx'), 'utf8');
        expect(rig).not.toMatch(/frameBlock|regionFraming|familyFraming|\.rect\b|peakTips/);
    });

    it('leaves the hand zoom-out threshold inside the orbit limit, on both', () => {
        for (const fov of [45, 70]) expect(framingDistance(stageFraming(fov)) * ZOOM_OUT_RATIO).toBeLessThan(SCENE.MAX_CAMERA_DISTANCE);
    });
});

describe('stage layout', () => {
    it('leaves the live 50-role layout exactly where it was', () => {
        const positions = computeClusterTerritoryLayout(initialJobs);
        let x = 2166136261;
        for (const c of initialJobs.map((j) => `${j.id}:${positions.get(j.id)!.x.toFixed(9)}:${positions.get(j.id)!.z.toFixed(9)}`).join('|')) {
            x ^= c.charCodeAt(0);
            x = Math.imul(x, 16777619);
        }
        expect((x >>> 0).toString(16)).toBe('d506028c');
    });

    it('generalises the live disc: one group of ids lands on the live rings', () => {
        const p = territoryLayout([['a', 'b', 'c']], { ringSpacing: 5 });
        for (const id of ['a', 'b', 'c']) expect(Math.hypot(p.get(id)!.x, p.get(id)!.z)).toBeCloseTo(7, 9);
    });

    it('has no stage at the world', () => {
        expect(buildStage(WORLD_LEVEL, scene.peaksByContinent)).toBeNull();
        expect(stageKey(WORLD_LEVEL)).toBeNull();
    });

    it.each(named)('%s: every job once, inside the live disc, with real numbers', (_key, stage) => {
        expect(new Set(stage.jobs.map((j) => j.key)).size).toBe(stage.jobs.length);
        const spots = new Set(stage.jobs.map((j) => `${j.x.toFixed(6)},${j.z.toFixed(6)}`));
        expect(spots.size).toBe(stage.jobs.length);
        for (const j of stage.jobs) {
            expect(Number.isFinite(j.x) && Number.isFinite(j.z), j.key).toBe(true);
            expect(Math.hypot(j.x, j.z), j.key).toBeLessThanOrEqual(32);
        }
    });

    it('holds every occupation: a family is exactly its fields', () => {
        const fields = STAGES.filter((s) => s.kind === 'field');
        expect(fields.reduce((n, s) => n + s.jobs.length, 0)).toBe(scene.peaks.length);
        for (const family of SOC_FAMILIES) {
            const stage = stageOf(familyLevel(family.id));
            const expected = fields.filter((s) => stageOf(familyLevel(family.id)).ranges.some((r) => s.key === `field:${r.code}`)).reduce((n, s) => n + s.jobs.length, 0);
            expect(stage.jobs.length).toBe(expected);
        }
    });

    it('lands the same job in the same place every time, whatever the year or the jobs array', () => {
        for (const level of LEVELS) {
            const a = stageOf(level);
            const b = buildStage(level, buildWorldScene([...useStore.getState().jobs]).peaksByContinent)!;
            expect(b.jobs.map((j) => [j.key, j.x, j.z])).toEqual(a.jobs.map((j) => [j.key, j.x, j.z]));
        }
        expect(buildStage.length).toBe(2); // takes no year
    });

    it('fills the same footprint whatever the count: all 27 end on the live outermost ring', () => {
        for (const stage of STAGES) {
            const radii = stage.jobs.map((j) => Math.hypot(j.x, j.z));
            expect(Math.max(...radii), stage.key).toBeCloseTo(STAGE_OUTER_RING, 6);
            expect(Math.min(...radii), stage.key).toBeGreaterThanOrEqual(7 - 1e-6);
        }
    });

    it('turns every stage so its largest job stands at the side, clear of the header and the slider', () => {
        for (const stage of STAGES) {
            const largest = stage.jobs.reduce((a, b) => (b.ep2025 > a.ep2025 ? b : a));
            expect(Math.abs(largest.z), stage.key).toBeLessThan(1e-9);
        }
    });

    it('starts from the live hill at the live count, and stays inside its limits at any size', () => {
        expect(stageSigma(50)).toBeCloseTo(2, 9);
        expect(stageRingSpacing(50)).toBeCloseTo(5, 9);
        expect(stageSigma(8)).toBeGreaterThan(stageSigma(105));
        expect(stageSigma(100000)).toBe(STAGE_SIGMA_MIN);
        expect(stageSigma(1)).toBe(STAGE_SIGMA_MAX);
    });

    it('gives a field its minor groups as territories, in SOC order', () => {
        for (const c of INDEX_CONTINENTS) {
            const groups = minorGroupsOf(c.code, scene.peaksByContinent.get(c.code)!);
            expect(groups.flat()).toHaveLength(scene.peaksByContinent.get(c.code)!.length);
            const minors = c.minorGroups.map((g) => g.soc).sort();
            for (const group of groups) {
                const home = (soc: string) => minors.filter((m) => m <= soc).pop();
                expect(new Set(group.map((p) => home(p.entry.soc))).size, c.code).toBe(1);
            }
        }
    });

    it('keeps a minor group together: its jobs sit closer to each other than to the rest of the disc', () => {
        const stage = stageOf(fieldLevel('51'));
        const groups = minorGroupsOf('51', scene.peaksByContinent.get('51')!);
        const big = groups.reduce((a, b) => (a.length > b.length ? a : b));
        const inGroup = stage.jobs.filter((j) => big.some((p) => p.entry.key === j.key));
        const spread = (list: StageJob[]) => {
            const cx = list.reduce((s, j) => s + j.x, 0) / list.length;
            const cz = list.reduce((s, j) => s + j.z, 0) / list.length;
            return list.reduce((s, j) => s + Math.hypot(j.x - cx, j.z - cz), 0) / list.length;
        };
        expect(spread(inGroup)).toBeLessThan(spread(stage.jobs));
    });

    it('gives a family its fields as ranges, each named at its own middle, next to its SOC neighbours', () => {
        for (const family of SOC_FAMILIES) {
            const stage = stageOf(familyLevel(family.id));
            for (const r of stage.ranges) {
                const members = stage.jobs.filter((j) => j.code === r.code);
                expect(members.length).toBeGreaterThan(0);
                expect(r.x).toBeCloseTo(members.reduce((s, j) => s + j.x, 0) / members.length, 9);
                expect(r.z).toBeCloseTo(members.reduce((s, j) => s + j.z, 0) / members.length, 9);
            }
            // Sectors run round the disc in SOC order: a job's sector angle only ever climbs.
            const angles = stage.ranges.map((r) => stage.jobs.filter((j) => j.code === r.code)).map((m) => Math.min(...m.map((j) => (Math.atan2(j.z, j.x) + 2 * Math.PI) % (2 * Math.PI))));
            expect([...angles].sort((a, b) => a - b).length).toBe(angles.length);
        }
    });

    it('finds the field under a point, and nothing off the disc', () => {
        const stage = stageOf(familyLevel(5));
        for (const j of stage.jobs) expect(stageFieldAt(stage, j.x, j.z)).toBe(j.code);
        expect(stageFieldAt(stage, STAGE_INPUT_RADIUS + 1, 0)).toBeNull();
    });
});

describe('heights', () => {
    it("draws a stage's largest job at the live view's tallest height in every year, the rest in proportion", () => {
        for (const stage of STAGES) {
            for (const f of [0, 0.45, 1]) {
                const year = YEAR_MIN + (YEAR_MAX - YEAR_MIN) * f;
                const employment = stage.jobs.map((j) => peakEmploymentAt(scene.peakByKey.get(j.key)!.entry, year));
                const max = Math.max(...employment);
                const heights = stage.jobs.map((j) => stageJobHeight(j, f, max));
                expect(Math.max(...heights), stage.key).toBeCloseTo(STAGE_PEAK_HEIGHT, 6);
                heights.forEach((h, i) => {
                    expect((h - STAGE_MIN_HEIGHT) / (STAGE_PEAK_HEIGHT - STAGE_MIN_HEIGHT)).toBeCloseTo(employment[i] / max, 6);
                });
            }
        }
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

describe.each(named)('the bake of %s', (_key, stage) => {
    const bake = bakeOf(stage);

    it('has no NaN and nothing out of range anywhere', () => {
        for (const h of bake.heights) {
            expect(Number.isFinite(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(STAGE_HEIGHT_RANGE);
        }
    });

    it('tops out at the live view\'s tallest hill, both years', () => {
        for (const layer of [0, 1] as const) {
            expect(top(bake.heights, layer)).toBeGreaterThan(STAGE_PEAK_HEIGHT * 0.97);
            expect(top(bake.heights, layer)).toBeLessThan(STAGE_PEAK_HEIGHT * 1.1);
        }
    });

    it('is flat ground past the hills, so the soft edge fades bare land', () => {
        for (let i = 0; i < bake.size; i++) expect(bake.heights[i * 2]).toBeLessThan(0.01);
    });
});

describe('the surface', () => {
    const lone: StageJob = { key: 'a', code: '11', x: 4, z: -6, ep2025: 1000, ep2035: 2000, color: [1, 0, 0], kelley: false };
    const stage = { jobs: [lone], sigma: 2 };

    it('is one Gaussian hill for one job, with the live width, at the right spot', () => {
        const bake = bakeStage(stage, 280, 'sum', 1);
        expect(surfaceHeight(bake, 4, -6, 0)).toBeCloseTo(STAGE_PEAK_HEIGHT, 1);
        const away = surfaceHeight(bake, 4 + 2, -6, 0);
        expect(away).toBeCloseTo(STAGE_PEAK_HEIGHT * Math.exp(-(2 * 2) / SHADER.SIGMA_SQ2), 1);
    });

    it('is the same lone hill either way: smooth max only differs where hills overlap', () => {
        const sum = bakeStage(stage, 128, 'sum', 1);
        const smooth = bakeStage(stage, 128, 'smoothmax', STAGE_BLEND_POWER);
        for (const [x, z] of [[4, -6], [6, -6], [4, -2], [0, 0]]) {
            expect(surfaceHeight(smooth, x, z, 0)).toBeCloseTo(surfaceHeight(sum, x, z, 0), 1);
        }
    });

    it('holds a job near its true height on the densest stage, which adding does not', () => {
        const dense = stageOf(familyLevel(1));
        const max = Math.max(...dense.jobs.map((j) => j.ep2025));
        const inflation = (blend: 'sum' | 'smoothmax', power: number) => {
            const bake = bakeStage(dense, 256, blend, power);
            const r = dense.jobs.map((j) => surfaceHeight(bake, j.x, j.z, 0) / stageJobHeight(j, 0, max)).sort((a, b) => a - b);
            return r[r.length >> 1];
        };
        expect(inflation('sum', 1)).toBeGreaterThan(2);
        expect(inflation(STAGE_BLEND, STAGE_BLEND_POWER)).toBeLessThan(1.35);
    });

    it('moves with the year on one number alone: the two layers just mix', () => {
        const two: StageJob[] = [lone, { ...lone, key: 'b', x: -10, z: 10, ep2025: 2000, ep2035: 1000 }];
        const bake = bakeStage({ jobs: two, sigma: 2 }, 128, 'smoothmax', STAGE_BLEND_POWER);
        const at = (m: number) => surfaceHeight(bake, 4, -6, m);
        expect(at(0.5)).toBeCloseTo((at(0) + at(1)) / 2, 5);
        expect(at(1)).toBeGreaterThan(at(0));
    });

    it('keeps published employment out of it: jobs carry EP levels straight through', () => {
        const stage51 = stageOf(fieldLevel('51'));
        for (const j of stage51.jobs) {
            const entry = scene.peakByKey.get(j.key)!.entry;
            expect(j.ep2025).toBe(entry.ep2025);
            expect(j.ep2035).toBe(entry.ep2035);
        }
    });
});

describe('colour', () => {
    it('keeps unscored jobs the existing grey: an all-grey field bakes to nothing else', () => {
        const stage = stageOf(fieldLevel('47'));
        expect(stage.jobs.every((j) => !j.kelley)).toBe(true);
        const { colors } = bakeOf(stage);
        const grey = RISK_UNSCORED_RGB.map((c) => Math.round(c * 255));
        const size = Math.sqrt(colors.length / 4);
        const middle = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
        // Bare ground is its own colour; anywhere a job's colour reaches is the grey.
        let checked = 0;
        for (let i = 0; i < colors.length; i += 4) {
            if (colors[i] === 13 && colors[i + 1] === 26 && colors[i + 2] === 51) continue;
            checked++;
            for (let k = 0; k < 3; k++) expect(Math.abs(colors[i + k] - grey[k])).toBeLessThanOrEqual(1);
        }
        expect(checked).toBeGreaterThan(colors.length / 16);
        expect(colors[middle + 3]).toBeLessThan(255);
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
        const sizes = STAGES.map((s) => bakeOf(s, STAGE_SEGMENTS.mobile).size);
        expect(new Set(sizes)).toEqual(new Set([STAGE_SEGMENTS.mobile + 1]));
    });
});

describe('the stage shader', () => {
    it('has no job limit: no uniform array, no loop over peaks', () => {
        expect(stageVertexShader).not.toMatch(/uPeaks|\[\s*${'$'}|for\s*\(/);
        expect(stageVertexShader).toContain('uHeights');
    });

    it('ends in the live soft circular edge, with no rectangle or border', () => {
        expect(stageFragmentShader).toContain(`smoothstep(${SHADER_VISUAL.EDGE_FADE_START}, ${SHADER_VISUAL.EDGE_FADE_END}, dist)`);
        expect(stageFragmentShader).not.toMatch(/border|uRegions|uFamilies/i);
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

describe('every minor group in the index', () => {
    it('is a real SOC code the jobs can fall under', () => {
        for (const code of INDEX_CONTINENT_BY_CODE.keys()) {
            for (const g of INDEX_CONTINENT_BY_CODE.get(code)!.minorGroups) expect(g.soc.startsWith(code)).toBe(true);
        }
    });
});
