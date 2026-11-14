/**
 * The red band's label is "High AI Exposure" (renamed from "High Automation
 * Risk", 2026-11-13): red means a job is in the top third most exposed to AI
 * of all scored jobs, not that it will disappear. Every place that shows it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Legend } from '../components/Legend';
import { FEATURES } from '../components/Modals/studentGuideFeatures';
import { ActivityTable } from '../components/dashboard/ActivityTable';
import type { EnrichedRow } from '../utils/dashboardSelectors';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('red band label', () => {
    it('the legend shows High AI Exposure', () => {
        const html = renderToStaticMarkup(<Legend />);
        expect(html).toContain('>High AI Exposure<');
        expect(html).not.toContain('Automation Risk');
    });

    it('the in-app and printable Student Guide say High AI Exposure', () => {
        expect(FEATURES.some((f) => f.description.includes('High AI Exposure (red)'))).toBe(true);
        expect(read('public/student-guide.html')).toContain('High AI Exposure (red)');
    });

    it('the old label is gone from every file that showed it', () => {
        for (const f of [
            'src/components/Legend.tsx',
            'src/components/dashboard/FilterBar.tsx',
            'src/components/Modals/studentGuideFeatures.ts',
            'public/student-guide.html',
        ]) {
            expect(read(f), f).not.toContain('High Automation Risk');
        }
    });

    it('the intro dialog speaks of AI exposure, not risk', () => {
        const intro = read('src/components/IntroModal.tsx');
        expect(intro).toContain('Color Indicates Relative AI Exposure');
        expect(intro).toContain('High AI exposure markers</span> are more exposed to AI than most of the');
        expect(intro).toContain('not immune');
        expect(intro).not.toMatch(/Relative Risk|High risk markers|exposed to automation/);
    });

    it('the dashboard table badge reads High AI exposure', () => {
        const row: EnrichedRow = {
            jobId: 'x', jobTitle: 'Financial Analysts', job: null, cluster: null,
            automationCostIndex: 0.73, projectedGrowth: 3, riskBand: 'high', createdAt: '2026-11-13T00:00:00Z',
        };
        const html = renderToStaticMarkup(
            <ActivityTable rows={[row]} variant="saved" onOpenJob={() => {}} onRemove={() => {}} emptyMessage="" />,
        );
        expect(html).toContain('73% · High AI exposure');
        expect(html).not.toContain('High risk');
    });
});
