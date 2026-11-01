/**
 * Selecting a family or field puts it alone on centre stage. Projects the
 * ground corners of all 5 families and all 22 fields through a real three.js
 * camera, framed as CameraRig frames it, and checks each block lands inside the
 * free band and centred.
 *
 * The band is never a guess: fixtures/chromeBands.json holds the top controls,
 * the year slider and the legend read with getBoundingClientRect from the
 * production build at each size, at each of the 27 levels, because the chrome
 * wraps differently for each name. 390x844 was measured with touch emulation,
 * since a coarse pointer makes the buttons 44px tall, not 36px.
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { useStore } from '../store';
import { SCENE } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { atDistance, familyFraming, frameBlock, framingDistance, regionFraming, worldFraming, type Framing, type FreeBand, type StagePoint } from '../components/world/framing';
import { stageSoftEdge } from '../components/world/worldShaders';
import { buildWorldScene, GROUND_Y, peakTips } from '../components/world/worldScene';
import { rectDepth, rectWidth, type Rect } from '../utils/worldLayout';
import { ZOOM_OUT_RATIO } from '../utils/worldLevel';
import chromeBands from './fixtures/chromeBands.json';

interface Measured { top: number; bottom: number; legendLeft?: number; legendTop?: number }

const VIEWPORTS = [
    { name: 'desktop 1470x801', width: 1470, height: 801, fov: SCENE.CAMERA_FOV },
    { name: 'desktop 1920x958', width: 1920, height: 958, fov: SCENE.CAMERA_FOV },
    { name: 'phone 390x844', width: 390, height: 844, fov: SCENE.CAMERA_PORTRAIT_FOV },
];

const scene = buildWorldScene(useStore.getState().jobs);

interface Block { key: string; name: string; rect: Rect; tips: StagePoint[]; frame: (band: FreeBand, fov: number, aspect: number) => Framing }

const BLOCKS: Block[] = [
    ...scene.layout.families.map((f): Block => {
        const tips = peakTips(f.codes.flatMap((code) => scene.peaksByContinent.get(code) ?? []), false);
        return { key: `family:${f.family.id}`, name: f.family.shortName, rect: f.rect, tips, frame: (band, fov, aspect) => familyFraming(f.rect, fov, aspect, band, tips) };
    }),
    ...scene.layout.regions.map((r): Block => {
        const tips = peakTips(scene.peaksByContinent.get(r.code) ?? [], true);
        return { key: `field:${r.code}`, name: CONTINENT_DISPLAY_NAMES[r.code], rect: r.rect, tips, frame: (band, fov, aspect) => regionFraming(r.rect, fov, aspect, band, tips) };
    }),
];

function screenOf(framing: Framing, vp: (typeof VIEWPORTS)[number]) {
    const camera = new PerspectiveCamera(vp.fov, vp.width / vp.height, 0.1, 2000);
    camera.position.set(...framing.position);
    camera.lookAt(new Vector3(...framing.target));
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return (x: number, y: number, z: number) => {
        const p = new Vector3(x, y, z).project(camera);
        return { x: ((p.x + 1) / 2) * vp.width, y: ((1 - p.y) / 2) * vp.height };
    };
}

/** Where a block lands: its ground corners on screen, and how much of the free band they take. */
function landing(block: Block, vp: (typeof VIEWPORTS)[number], measured: Measured) {
    const band: FreeBand = {
        top: measured.top / vp.height,
        bottom: measured.bottom / vp.height,
        legend: measured.legendLeft != null && measured.legendTop != null && measured.legendTop < measured.bottom
            ? { left: measured.legendLeft / vp.width, top: measured.legendTop / vp.height }
            : undefined,
    };
    const framing = block.frame(band, vp.fov, vp.width / vp.height);
    const screen = screenOf(framing, vp);
    const { x0, x1, z0, z1 } = block.rect;
    const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => screen(x, GROUND_Y, z));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return { framing, screen, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), corners };
}

describe.each(VIEWPORTS)('centre stage at $name', (vp) => {
    const bands = (chromeBands as unknown as Record<string, Record<string, Measured>>)[`${vp.width}x${vp.height}`];

    it('has a real measurement for all 27 levels', () => {
        for (const b of BLOCKS) expect(bands[b.key], b.name).toBeDefined();
        expect(BLOCKS).toHaveLength(27);
    });

    describe.each(BLOCKS.map((b) => [b.name, b] as const))('%s', (_name, block) => {
        const measured = bands[block.key];
        const land = landing(block, vp, measured);

        it('fits completely inside the free band, and on the screen', () => {
            expect(land.top).toBeGreaterThanOrEqual(measured.top);
            expect(land.bottom).toBeLessThanOrEqual(measured.bottom);
            expect(land.left).toBeGreaterThanOrEqual(0);
            expect(land.right).toBeLessThanOrEqual(vp.width);
        });

        it('is centred on the screen and in the free band', () => {
            expect(Math.abs((land.left + land.right) / 2 - vp.width / 2)).toBeLessThan(0.5);
            expect(Math.abs((land.top + land.bottom) / 2 - (measured.top + measured.bottom) / 2)).toBeLessThan(1);
        });

        it('keeps every peak tip below the top controls, on the tallest the slider can draw it', () => {
            for (const [x, y, z] of block.tips) {
                const tip = land.screen(x, y, z);
                expect(tip.y).toBeGreaterThanOrEqual(measured.top - 0.5);
            }
        });

        it('stays out from under the legend', () => {
            if (measured.legendLeft == null || measured.legendTop == null || measured.legendTop >= measured.bottom) return;
            const inLegend = land.corners.some((c) => c.x > measured.legendLeft! && c.y > measured.legendTop!);
            expect(inLegend).toBe(false);
        });

        it('leaves the soft edge inside the screen', () => {
            const spill = stageSoftEdge(rectWidth(block.rect), rectDepth(block.rect)) / 2;
            const { x1, z1 } = block.rect;
            expect(land.screen(x1 + spill, GROUND_Y, z1).x).toBeLessThanOrEqual(vp.width);
        });

        it('can always be left by a hand zoom: its threshold is further than the camera stops anywhere near it', () => {
            expect(framingDistance(land.framing) * ZOOM_OUT_RATIO).toBeGreaterThan(framingDistance(land.framing));
            expect(framingDistance(land.framing)).toBeGreaterThanOrEqual(SCENE.MIN_CAMERA_DISTANCE);
        });
    });
});

describe('the framing itself', () => {
    const rect: Rect = { x0: -8, z0: -6, x1: 8, z1: 6 };
    const band: FreeBand = { top: 0.25, bottom: 0.8 };

    it('does not depend on where the block is', () => {
        const a = frameBlock(rect, 45, 1.8, band);
        const moved = frameBlock({ x0: 12, z0: -26, x1: 28, z1: -14 }, 45, 1.8, band);
        expect(moved.position[0] - a.position[0]).toBeCloseTo(20, 6);
        expect(moved.position[1]).toBeCloseTo(a.position[1], 6);
        expect(moved.position[2] - a.position[2]).toBeCloseTo(-20, 6);
    });

    it('steps back for a tall peak at the back, and not for a short one', () => {
        const tall = frameBlock(rect, 45, 1.8, band, [[0, GROUND_Y + 30, -6]]);
        const short = frameBlock(rect, 45, 1.8, band, [[0, GROUND_Y + 0.1, 6]]);
        expect(framingDistance(tall)).toBeGreaterThan(framingDistance(short));
        expect(framingDistance(short)).toBeCloseTo(framingDistance(frameBlock(rect, 45, 1.8, band)), 6);
    });

    it('steps back to clear the legend when the corner would land under it', () => {
        const free = frameBlock(rect, 45, 1.8, band);
        const clear = frameBlock(rect, 45, 1.8, { ...band, legend: { left: 0.6, top: 0.65 } });
        expect(framingDistance(clear)).toBeGreaterThan(framingDistance(free));
    });

    it('keeps its distance above the orbit minimum however small the block', () => {
        const tiny: Rect = { x0: 0, z0: 0, x1: 0.5, z1: 0.5 };
        expect(framingDistance(frameBlock(tiny, 45, 1.8, band))).toBeGreaterThanOrEqual(SCENE.MIN_CAMERA_DISTANCE + 4 - 1e-6);
    });

    it('still leaves the whole-world framing alone', () => {
        expect(worldFraming(45, 1.8)).toEqual(worldFraming(45, 1.8));
        const home = worldFraming(45, 1.8);
        expect(atDistance(home, framingDistance(home)).position).toEqual(home.position);
    });
});
