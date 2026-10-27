/**
 * On the globe too, a tall Kelley peak keeps its label when its stalk would
 * reach under the top chrome: the anchor slides down toward the peak's foot
 * (globeLabels.layoutGlobeLabels with a `foot`), and the stalk is shortened
 * to match. Checked against a real camera looking at the globe, with a peak
 * placed so its full stalk ends above the free band.
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { layoutGlobeLabels, type GlobeLabel } from '../components/world/globeLabels';
import { LAND_RADIUS, unitVector } from '../utils/globeLayout';
import { bandTopAt, isHiddenLabelPosition, type LabelBand } from '../utils/labelLayout';

const W = 1470;
const H = 801;
const camera = new PerspectiveCamera(45, W / H, 0.1, 2000);
camera.position.set(0, 0, 70);
camera.lookAt(new Vector3(0, 0, 0));
camera.updateMatrixWorld();

const screenY = (p: readonly number[]) => {
    const v = new Vector3(p[0], p[1], p[2]).project(camera);
    return -((v.y * H) / 2) + H / 2;
};

// A peak high on the near side of the globe, with a tall stalk.
const n = unitVector(0, Math.sin(0.62));
const foot = [n[0] * LAND_RADIUS, n[1] * LAND_RADIUS, n[2] * LAND_RADIUS] as const;
const tipR = LAND_RADIUS + 9;
const anchor = [n[0] * tipR, n[1] * tipR, n[2] * tipR] as const;
// The chrome ends between the peak's foot and the tip of its full stalk.
const band: LabelBand = { top: (screenY(foot) + screenY(anchor)) / 2, bottom: 100 };
const label: GlobeLabel = { id: 'tall', n, anchor, foot, halfWidth: 50, halfHeight: 9, slack: 1 };

describe('tall peaks on the globe', () => {
    it('the full stalk would put the label under the chrome', () => {
        expect(screenY(anchor)).toBeLessThan(band.top);
        expect(screenY(foot)).toBeGreaterThan(band.top + 2 * label.halfHeight);
    });

    it('keeps the label, lower on its stalk, inside the free band', () => {
        const out = new Map<string, [number, number]>();
        const tips = new Map<string, number>();
        layoutGlobeLabels([label], new Map(), camera, W, H, band, out, new Map(), new Map(), false, tips);
        const pos = out.get('tall');
        expect(pos && !isHiddenLabelPosition(pos)).toBe(true);
        expect(pos![1] - label.halfHeight).toBeGreaterThanOrEqual(bandTopAt(band, pos![0] - label.halfWidth, pos![0] + label.halfWidth) - 0.01);
        const t = tips.get('tall')!;
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
    });

    it('without a foot (the old behaviour) the same label is hidden', () => {
        const out = new Map<string, [number, number]>();
        layoutGlobeLabels([{ ...label, foot: undefined }], new Map(), camera, W, H, band, out, new Map(), new Map());
        const pos = out.get('tall');
        expect(!pos || isHiddenLabelPosition(pos)).toBe(true);
    });
});
