/**
 * No peak loses its label for being tall (professor's review, Oct 2026).
 *
 * Runs the same per-frame pass as world/WorldMarkers (labelCandidates +
 * layoutLabelsByWeight) against a real three.js camera framed the way the app
 * frames it, at the two review viewports, with the chrome band measured in
 * Chrome at those sizes. Chip sizes follow the measured chips (chipHalf).
 *
 * A label may be hidden only by a collision with a BIGGER job's label: alone
 * on the screen it must always get a position.
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { useStore } from '../store';
import { SCENE } from '../config/constants';
import { buildWorldScene, fieldMaxEmploymentAt, type ScenePeak } from '../components/world/worldScene';
import { regionFraming, worldFraming, type Framing } from '../components/world/framing';
import { buildLabelCandidates, labelWeights, peakMarker, sortMarkers, type MarkerItem } from '../components/world/labelCandidates';
import { REGION_LABEL_CAP } from '../components/world/WorldMarkers';
import { isHiddenLabelPosition, labelsCollide, layoutLabels, layoutLabelsByWeight, type LabelBand, type LabelCandidate } from '../utils/labelLayout';

interface Viewport {
    name: string;
    width: number;
    height: number;
    fov: number;
    /**
     * Measured in Chrome at this size, as WorldMarkers measures it: full-width
     * top = header/search bottom + 6, bottom = from the year slider's top + 6,
     * and the fields bar (with its note) as a block, padded by 6.
     */
    kelleyBand: LabelBand;
    fieldBand: LabelBand;
    /** The free band the camera rig frames a zoomed field into (CameraRig freeBand). */
    fieldFrame: { top: number; bottom: number };
    /** Chip model fitted to the measured chips (see chipHalf). */
    chip: { lineH: number; extraLineH: number; charW: number; pad: number; capW: number; lines: number };
    cap: number;
}

const VIEWPORTS: Viewport[] = [
    {
        name: 'desktop 1470x801',
        width: 1470,
        height: 801,
        fov: SCENE.CAMERA_FOV,
        kelleyBand: { top: 144, bottom: 801 - 644 + 6, blocks: [{ left: 26, right: 366, bottom: 215 }] },
        fieldBand: { top: 144, bottom: 801 - 644 + 6, blocks: [{ left: 26, right: 431, bottom: 234 }] },
        fieldFrame: { top: 228, bottom: 644 },
        chip: { lineH: 19, extraLineH: 12.5, charW: 6.3, pad: 18, capW: 208, lines: 2 },
        cap: REGION_LABEL_CAP.desktop,
    },
    {
        name: 'phone 390x844',
        width: 390,
        height: 844,
        fov: SCENE.CAMERA_PORTRAIT_FOV,
        kelleyBand: { top: 160, bottom: 844 - 654 + 6, blocks: [{ left: 10, right: 380, bottom: 231 }] },
        fieldBand: { top: 210, bottom: 844 - 654 + 6, blocks: [{ left: 10, right: 380, bottom: 342 }] },
        fieldFrame: { top: 336, bottom: 654 },
        chip: { lineH: 16, extraLineH: 11.25, charW: 5.7, pad: 14, capW: 152, lines: 3 },
        cap: REGION_LABEL_CAP.mobile,
    },
];

const scene = buildWorldScene(useStore.getState().jobs);

/**
 * The chip as PeakLabel sizes it: one line up to the usual cap, wider for a
 * long title so it still takes at most `lines` lines (2 desktop, 3 phone).
 */
function chipHalf(title: string, chip: Viewport['chip']) {
    const oneLine = chip.pad + title.length * chip.charW;
    const maxW = Math.max(chip.capW, (Math.ceil(title.length / chip.lines) + 6) * chip.charW);
    const w = Math.min(oneLine, maxW);
    const lines = Math.ceil((oneLine - chip.pad) / (w - chip.pad));
    return { x: w / 2, y: (chip.lineH + (lines - 1) * chip.extraLineH) / 2 };
}

function cameraFor(vp: Viewport, framing: Framing) {
    const cam = new PerspectiveCamera(vp.fov, vp.width / vp.height, 0.1, 2000);
    cam.position.set(...framing.position);
    cam.lookAt(new Vector3(...framing.target));
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
}

/** The CameraRig's zoomed framing for a field, in the band it measures. */
function fieldFraming(vp: Viewport, code: string): Framing {
    const { top, bottom } = vp.fieldFrame;
    const h = vp.height;
    return regionFraming(scene.layout.regionByCode.get(code)!.rect, vp.fov, vp.width / vp.height, {
        usableHeight: (bottom - top) / h,
        bandCenter: ((top + bottom) / 2 - h / 2) / (h / 2),
    });
}

interface Outcome {
    title: string;
    size: number;
    shown: boolean;
    /** Placed when it is the only label on screen. */
    shownAlone: boolean;
    /** Bigger labels whose box overlaps the room this label could use. */
    blockers: string[];
}

function runPass(vp: Viewport, band: LabelBand, framing: Framing, peaks: ScenePeak[], focused: string | null): Outcome[] {
    const year = 2025;
    const fieldMax = focused ? fieldMaxEmploymentAt(scene.peaksByContinent.get(focused) ?? [], year) : 0;
    const items: MarkerItem[] = sortMarkers(peaks.map((p) => peakMarker(p, year, focused, fieldMax)), () => false);
    const half = new Map(items.map((m) => [m.id, chipHalf((m as Extract<MarkerItem, { kind: 'peak' }>).peak.entry.title, vp.chip)]));
    const camera = cameraFor(vp, framing);
    const size = { width: vp.width, height: vp.height };
    const list: LabelCandidate[] = [];
    buildLabelCandidates(items, camera, size, band, half, list, new Map());
    const out = new Map<string, [number, number]>();
    layoutLabelsByWeight(list, labelWeights(items, null), vp.width, vp.height, band, out, new Map());

    const byId = new Map(list.map((c) => [c.id, c]));
    return items.map((m, i) => {
        const peak = (m as Extract<MarkerItem, { kind: 'peak' }>).peak;
        const c = byId.get(m.id)!;
        const alone = new Map<string, [number, number]>();
        layoutLabels([c], vp.width, vp.height, band, alone, new Map());
        const blockers = items.slice(0, i).filter((o) => {
            const pos = out.get(o.id);
            if (!pos || isHiddenLabelPosition(pos)) return false;
            const oc = byId.get(o.id)!;
            // Anywhere this label's nudges could reach (anchor ± its own size).
            return labelsCollide(c.anchorX, c.anchorY, 2 * c.halfWidth, 2 * c.halfHeight, pos[0], pos[1], oc.halfWidth, oc.halfHeight, 2);
        });
        return {
            title: peak.entry.title,
            size: peak.entry.ep2025 ?? 0,
            shown: !isHiddenLabelPosition(out.get(m.id)!),
            shownAlone: !isHiddenLabelPosition(alone.get(m.id)!),
            blockers: blockers.map((o) => (o as Extract<MarkerItem, { kind: 'peak' }>).peak.entry.title),
        };
    });
}

function expectNoHeightCulling(outcomes: Outcome[], where: string) {
    for (const o of outcomes) {
        expect(o.shownAlone, `${where}: "${o.title}" has no on-screen position even alone`).toBe(true);
        if (!o.shown) expect(o.blockers.length, `${where}: "${o.title}" hidden with no bigger label in the way`).toBeGreaterThan(0);
    }
}

const PROFESSOR_LIST = [
    'General Manager', 'Software Developer', 'Accountant & Auditor', 'Project Management Specialist',
    'Financial Manager', 'IT Manager', 'Sales Manager', 'Marketing Manager',
];

describe.each(VIEWPORTS)('peak labels at $name', (vp) => {
    it('Kelley roles, world view: all 50 get a place unless a bigger job is in the way', () => {
        const kelley = scene.peaks.filter((p) => p.entry.kind === 'kelley');
        expect(kelley).toHaveLength(50);
        const outcomes = runPass(vp, vp.kelleyBand, worldFraming(vp.fov, vp.width / vp.height), kelley, null);
        expectNoHeightCulling(outcomes, 'Kelley');
        // The tallest peaks of all must show.
        for (const t of ['General Manager', 'Software Developer']) expect(outcomes.find((o) => o.title === t)?.shown, t).toBe(true);
        for (const t of PROFESSOR_LIST) expect(outcomes.find((o) => o.title === t), t).toBeTruthy();
    });

    it('every zoomed field: its labelled peaks get a place unless a bigger job is in the way', () => {
        for (const region of scene.layout.regions) {
            const peaks = [...(scene.peaksByContinent.get(region.code) ?? [])]
                .sort((a, b) => (b.entry.ep2025 ?? 0) - (a.entry.ep2025 ?? 0))
                .slice(0, vp.cap);
            const outcomes = runPass(vp, vp.fieldBand, fieldFraming(vp, region.code), peaks, region.code);
            expectNoHeightCulling(outcomes, `field ${region.code}`);
            // The field's biggest occupation always keeps its label.
            expect(outcomes[0].shown, `field ${region.code}: ${outcomes[0].title}`).toBe(true);
        }
    });
});
