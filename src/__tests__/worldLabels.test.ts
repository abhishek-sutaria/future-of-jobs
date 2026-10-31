/**
 * The world names all five BLS job families at the broad view and all 22
 * fields once zoomed in, at the two review viewports. Runs the same pass as
 * world/WorldMarkers against a real three.js camera framed as the app frames
 * it; chip sizes and the chrome band were measured in Chrome at each size
 * (Oct 2026).
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { useStore } from '../store';
import { SCENE } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { buildWorldScene } from '../components/world/worldScene';
import { atDistance, familyFraming, framingDistance, regionFraming, worldFraming, type Framing } from '../components/world/framing';
import { buildLabelCandidates, familyMarker, focusedRegionMarker, labelWeights, peakMarker, regionMarker, sortMarkers, type MarkerItem } from '../components/world/labelCandidates';
import { isHiddenLabelPosition, labelsCollide, layoutLabelsByWeight, type LabelBand, type LabelCandidate } from '../utils/labelLayout';
import { BROAD_LABELS, decideLabels, FIELD_ARRIVAL_ZOOM } from '../utils/labelLevel';

type Sizes = Record<string, [number, number]>;

const DESKTOP_SIZES: Sizes = {
    'Office & Admin': [101, 27], Sales: [48, 27], 'Transportation & Moving': [155, 27], 'Food Service': [91, 27], Management: [91, 27],
    'Business & Finance': [126, 27], 'Healthcare Practitioners': [154, 27], Education: [74, 27], Production: [79, 27], 'Healthcare Support': [127, 27],
    'Construction & Extraction': [161, 27], 'Installation & Repair': [129, 27], 'Cleaning & Grounds': [128, 27], 'Computer & Math': [115, 27],
    'Personal Care': [96, 27], 'Protective Service': [120, 27], 'Community & Social Service': [175, 27], 'Arts & Media': [89, 27],
    'Architecture & Engineering': [168, 27], Science: [63, 27], Legal: [48, 27], 'Farming, Fishing & Forestry': [171, 27],
    'Management, Business, Science & Arts': [208, 32], Service: [68, 18], 'Sales & Office': [118, 18],
    'Natural Resources, Construction & Maintenance': [208, 45], 'Production, Transportation & Moving': [208, 32],
};

const PHONE_SIZES: Sizes = {
    'Office & Admin': [62, 22], Sales: [31, 13], 'Transportation & Moving': [62, 22], 'Food Service': [61, 13], Management: [61, 13],
    'Business & Finance': [62, 22], 'Healthcare Practitioners': [62, 22], Education: [49, 13], Production: [52, 13], 'Healthcare Support': [62, 22],
    'Construction & Extraction': [62, 22], 'Installation & Repair': [62, 22], 'Cleaning & Grounds': [62, 22], 'Computer & Math': [62, 22],
    'Personal Care': [62, 22], 'Protective Service': [62, 22], 'Community & Social Service': [62, 30], 'Arts & Media': [59, 13],
    'Architecture & Engineering': [62, 30], Science: [41, 13], Legal: [31, 13], 'Farming, Fishing & Forestry': [62, 30],
    'Management, Business, Science & Arts': [152, 27], Service: [53, 15], 'Sales & Office': [90, 15],
    'Natural Resources, Construction & Maintenance': [152, 38], 'Production, Transportation & Moving': [152, 38],
};

// `band` is the chrome at the broad view; `zoomedBand` adds "Reset view", which wraps the header on a phone.
const VIEWPORTS: { name: string; width: number; height: number; fov: number; band: LabelBand; zoomedBand: LabelBand; sizes: Sizes }[] = [
    {
        name: 'desktop 1470x801', width: 1470, height: 801, fov: SCENE.CAMERA_FOV, sizes: DESKTOP_SIZES,
        band: { top: 144, bottom: 801 - 644 + 6, blocks: [{ left: 26, right: 289, bottom: 184 }] },
        zoomedBand: { top: 144, bottom: 801 - 644 + 6, blocks: [{ left: 26, right: 289, bottom: 184 }] },
    },
    {
        name: 'phone 390x844', width: 390, height: 844, fov: SCENE.CAMERA_PORTRAIT_FOV, sizes: PHONE_SIZES,
        band: { top: 160, bottom: 844 - 654 + 6, blocks: [{ left: 10, right: 380, bottom: 200 }] },
        zoomedBand: { top: 210, bottom: 844 - 654 + 6, blocks: [{ left: 10, right: 380, bottom: 250 }] },
    },
];

const scene = buildWorldScene(useStore.getState().jobs);
const nameOf = (m: MarkerItem) => (m.kind === 'region' ? CONTINENT_DISPLAY_NAMES[m.code] : m.kind === 'family' ? m.family.family.shortName : m.peak.entry.title);

/** The declutter pass for `markers` seen from `framing`: which ids show, and where. */
function layOut(markers: MarkerItem[], framing: Framing, vp: (typeof VIEWPORTS)[number], band: LabelBand) {
    const items = sortMarkers(markers, () => false);
    const half = new Map(items.map((m) => {
        const s = vp.sizes[nameOf(m)];
        if (!s) throw new Error(`no measured size for ${nameOf(m)}`);
        return [m.id, { x: s[0] / 2, y: s[1] / 2 }];
    }));
    const camera = new PerspectiveCamera(vp.fov, vp.width / vp.height, 0.1, 2000);
    camera.position.set(...framing.position);
    camera.lookAt(new Vector3(...framing.target));
    camera.updateMatrixWorld();
    const list: LabelCandidate[] = [];
    buildLabelCandidates(items, camera, { width: vp.width, height: vp.height }, band, half, list, new Map());
    const out = new Map<string, [number, number]>();
    layoutLabelsByWeight(list, labelWeights(items, null), vp.width, vp.height, band, out, new Map());
    return { list, out, shown: (id: string) => !isHiddenLabelPosition(out.get(id) ?? [-1e5, -1e5]) };
}

function expectNoOverlap({ list, out, shown }: ReturnType<typeof layOut>) {
    const placed = list.filter((c) => shown(c.id));
    for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
            const a = placed[i];
            const b = placed[j];
            const pa = out.get(a.id)!;
            const pb = out.get(b.id)!;
            expect(labelsCollide(pa[0], pa[1], a.halfWidth, a.halfHeight, pb[0], pb[1], b.halfWidth, b.halfHeight), `${a.id} / ${b.id}`).toBe(false);
        }
    }
}

describe.each(VIEWPORTS)('labels at $name', (vp) => {
    const aspect = vp.width / vp.height;
    const home = worldFraming(vp.fov, aspect);

    describe('broad view', () => {
        const families = scene.layout.families.map(familyMarker);
        const layout = layOut(families, home, vp, vp.band);

        it('shows all five family names in full, inside the screen and clear of the chrome', () => {
            expect(families).toHaveLength(5);
            for (const c of layout.list) {
                expect(layout.shown(c.id), c.id).toBe(true);
                const [x, y] = layout.out.get(c.id)!;
                expect(x - c.halfWidth).toBeGreaterThanOrEqual(0);
                expect(x + c.halfWidth).toBeLessThanOrEqual(vp.width);
                expect(y - c.halfHeight).toBeGreaterThanOrEqual(vp.band.top);
                expect(y + c.halfHeight).toBeLessThanOrEqual(vp.height - vp.band.bottom);
            }
        });

        it('never lets two family names overlap', () => expectNoOverlap(layout));

        it('puts each family name inside its own block', () => {
            for (const m of families) {
                if (m.kind !== 'family') continue;
                const { rect } = m.family;
                expect(m.x).toBeGreaterThan(rect.x0);
                expect(m.x).toBeLessThan(rect.x1);
                expect(m.z).toBeGreaterThan(rect.z0);
                expect(m.z).toBeLessThan(rect.z1);
            }
        });
    });

    describe('zoomed in as far as the field names first appear', () => {
        const fields = scene.layout.regions.map((r) => regionMarker(r.code, r.cx, r.cz));
        const layout = layOut(fields, atDistance(home, framingDistance(home) / FIELD_ARRIVAL_ZOOM), vp, vp.zoomedBand);

        it('shows every field name', () => {
            for (const r of scene.layout.regions) expect(layout.shown(`region:${r.code}`), CONTINENT_DISPLAY_NAMES[r.code]).toBe(true);
        });

        it('never lets two field names overlap', () => expectNoOverlap(layout));
    });
});

// Every window shape a user could plausibly be on, not only the two review sizes:
// on a wide screen the tallest field and family frame further out than the world does.
describe.each([[1920, 1080], [1470, 801], [1280, 720], [1024, 768], [768, 1024], [390, 844], [360, 640], [844, 390]])('flights at %ix%i', (width, height) => {
    const aspect = width / height;
    const fov = aspect < 1 ? SCENE.CAMERA_PORTRAIT_FOV : SCENE.CAMERA_FOV;
    const base = framingDistance(worldFraming(fov, aspect));
    const band = { usableHeight: 0.55, bandCenter: 0.05, maxDistance: base / FIELD_ARRIVAL_ZOOM };
    const landsOnFields = (f: Framing) => decideLabels(base / framingDistance(f), BROAD_LABELS).fields;

    it('every field lands past the threshold', () => {
        for (const r of scene.layout.regions) expect(landsOnFields(regionFraming(r.rect, fov, aspect, band)), r.code).toBe(true);
    });

    it('every family lands past the threshold', () => {
        for (const f of scene.layout.families) expect(landsOnFields(familyFraming(f.rect, fov, aspect, band)), f.family.shortName).toBe(true);
    });

    it('the whole-world framing is the broad view', () => {
        expect(landsOnFields(worldFraming(fov, aspect))).toBe(false);
    });
});

describe('inside a zoomed field', () => {
    const region = scene.layout.regions.find((r) => r.code === '43')!;
    const own = focusedRegionMarker(region);

    it('puts its own name inside its block, in front of the middle where the peaks crowd', () => {
        expect(own.x).toBe(region.cx);
        expect(own.z).toBeGreaterThan(region.cz);
        expect(own.z).toBeLessThan(region.rect.z1);
    });

    it('lets job labels win, then its own name, then the other fields', () => {
        const big = scene.layout.regions.find((r) => r.code === '29')!;
        const peak = scene.peaksByContinent.get('43')![0];
        const job = peakMarker(peak, 2025, '43', 1);
        const order = sortMarkers([regionMarker(big.code, big.cx, big.cz), own, job], () => false, true, '43');
        expect(order.map((m) => m.id)).toEqual([job.id, own.id, 'region:29']);
    });
});
