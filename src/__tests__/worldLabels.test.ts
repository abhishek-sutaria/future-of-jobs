/**
 * The world view names all 22 fields and all five BLS job families, at the
 * two review viewports. Runs the same pass as world/WorldMarkers against a
 * real three.js camera framed as the app frames it; chip sizes and the chrome
 * band were measured in Chrome at each size (Oct 2026).
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { useStore } from '../store';
import { SCENE } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { buildWorldScene } from '../components/world/worldScene';
import { worldFraming } from '../components/world/framing';
import { buildLabelCandidates, dropFamilyFallbacks, familyMarkers, labelWeights, regionMarker, sortMarkers, type MarkerItem } from '../components/world/labelCandidates';
import { isHiddenLabelPosition, labelsCollide, layoutLabelsByWeight, type LabelBand, type LabelCandidate } from '../utils/labelLayout';

type Sizes = Record<string, [number, number]>;

const DESKTOP_SIZES: Sizes = {
    'Office & Admin': [101, 27], Sales: [48, 27], 'Transportation & Moving': [155, 27], 'Food Service': [91, 27], Management: [91, 27],
    'Business & Finance': [126, 27], 'Healthcare Practitioners': [154, 27], Education: [74, 27], Production: [79, 27], 'Healthcare Support': [127, 27],
    'Construction & Extraction': [161, 27], 'Installation & Repair': [129, 27], 'Cleaning & Grounds': [128, 27], 'Computer & Math': [115, 27],
    'Personal Care': [96, 27], 'Protective Service': [120, 27], 'Community & Social Service': [175, 27], 'Arts & Media': [89, 27],
    'Architecture & Engineering': [168, 27], Science: [63, 27], Legal: [48, 27], 'Farming, Fishing & Forestry': [171, 27],
    'Management, Business, Science & Arts': [176, 23], Service: [54, 11], 'Sales & Office': [94, 11],
    'Natural Resources, Construction & Maintenance': [176, 34], 'Production, Transportation & Moving': [176, 23],
};

const PHONE_SIZES: Sizes = {
    'Office & Admin': [62, 22], Sales: [31, 13], 'Transportation & Moving': [62, 22], 'Food Service': [61, 13], Management: [61, 13],
    'Business & Finance': [62, 22], 'Healthcare Practitioners': [62, 22], Education: [49, 13], Production: [52, 13], 'Healthcare Support': [62, 22],
    'Construction & Extraction': [62, 22], 'Installation & Repair': [62, 22], 'Cleaning & Grounds': [62, 22], 'Computer & Math': [62, 22],
    'Personal Care': [62, 22], 'Protective Service': [62, 22], 'Community & Social Service': [62, 30], 'Arts & Media': [59, 13],
    'Architecture & Engineering': [62, 30], Science: [41, 13], Legal: [31, 13], 'Farming, Fishing & Forestry': [62, 30],
    'Management, Business, Science & Arts': [152, 14], Service: [40, 7], 'Sales & Office': [68, 7],
    'Natural Resources, Construction & Maintenance': [152, 14], 'Production, Transportation & Moving': [152, 14],
};

const VIEWPORTS: { name: string; width: number; height: number; fov: number; band: LabelBand; sizes: Sizes }[] = [
    { name: 'desktop 1470x801', width: 1470, height: 801, fov: SCENE.CAMERA_FOV, band: { top: 144, bottom: 801 - 644 + 6, blocks: [{ left: 26, right: 289, bottom: 184 }] }, sizes: DESKTOP_SIZES },
    { name: 'phone 390x844', width: 390, height: 844, fov: SCENE.CAMERA_PORTRAIT_FOV, band: { top: 160, bottom: 844 - 654 + 6, blocks: [{ left: 10, right: 380, bottom: 200 }] }, sizes: PHONE_SIZES },
];

const scene = buildWorldScene(useStore.getState().jobs);
const nameOf = (m: MarkerItem) => (m.kind === 'region' ? CONTINENT_DISPLAY_NAMES[m.code] : m.kind === 'family' ? m.family.family.shortName : m.peak.entry.title);

describe.each(VIEWPORTS)('world view at $name', (vp) => {
    const items = sortMarkers(
        [...scene.layout.regions.map((r) => regionMarker(r.code, r.cx, r.cz)), ...scene.layout.families.flatMap(familyMarkers)],
        () => false,
    );
    const half = new Map(items.map((m) => {
        const s = vp.sizes[nameOf(m)];
        if (!s) throw new Error(`no measured size for ${nameOf(m)}`);
        return [m.id, { x: s[0] / 2, y: s[1] / 2 }];
    }));
    const f = worldFraming(vp.fov, vp.width / vp.height);
    const camera = new PerspectiveCamera(vp.fov, vp.width / vp.height, 0.1, 2000);
    camera.position.set(...f.position);
    camera.lookAt(new Vector3(...f.target));
    camera.updateMatrixWorld();
    const list: LabelCandidate[] = [];
    buildLabelCandidates(items, camera, { width: vp.width, height: vp.height }, vp.band, half, list, new Map());
    const out = new Map<string, [number, number]>();
    layoutLabelsByWeight(list, labelWeights(items, null), vp.width, vp.height, vp.band, out, new Map());
    dropFamilyFallbacks(items, out);
    const shown = (id: string) => !isHiddenLabelPosition(out.get(id) ?? [-1e5, -1e5]);

    it('shows every field name', () => {
        for (const r of scene.layout.regions) expect(shown(`region:${r.code}`), CONTINENT_DISPLAY_NAMES[r.code]).toBe(true);
    });

    it('shows each family name exactly once, inside its block or on its edge', () => {
        for (const fam of scene.layout.families) {
            const id = `family:${fam.family.id}`;
            expect(Number(shown(id)) + Number(shown(`${id}:outside`)), fam.family.shortName).toBe(1);
        }
    });

    it('never lets two shown labels overlap', () => {
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
    });
});
