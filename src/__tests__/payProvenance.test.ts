/**
 * Pay comes from OEWS (payroll employees only); the worker count on an
 * unscored occupation's panel comes from BLS Employment Projections (everyone,
 * self-employed included). No explanation may say the two share a survey.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { provenanceLabel, type DataProvenance } from '../utils/provenance';

const ALL: DataProvenance[] = [
    'BLS_OES', 'BLS_OES_WAGES', 'BLS_OOH', 'BLS_EP', 'BLS_CPS', 'ONET', 'ONET_PROXY',
    'CLAUDE_TASK_SCORE', 'CLAUDE_FORECAST', 'COVERAGE_FORMULA', 'UNAVAILABLE',
];
const SHARED_SURVEY = /same survey as the (job|worker)|same (survey|source) as (the )?(job|worker|employment) count|share[sd]? (a|one|the same) survey/i;

describe('pay provenance', () => {
    it('no provenance text claims pay and worker counts share a survey', () => {
        for (const p of ALL) expect(provenanceLabel(p), p).not.toMatch(SHARED_SURVEY);
    });

    it('says pay counts payroll employees only, in the requested words', () => {
        expect(provenanceLabel('BLS_OES_WAGES')).toBe(
            'What this job pays across the U.S., from the government’s wage survey (BLS OEWS May 2025), which counts payroll employees only. The median is the middle wage: half of workers earn more, half earn less. The mean is the average, which a few very high earners can pull up.',
        );
    });

    it('no in-app or guide copy makes the claim either', () => {
        for (const f of ['src/components/MethodologyModal.tsx', 'src/components/Modals/StudentGuideModal.tsx', 'public/student-guide.html', 'src/components/OccupationPanel.tsx']) {
            expect(readFileSync(resolve(__dirname, '../..', f), 'utf8'), f).not.toMatch(SHARED_SURVEY);
        }
    });
});
