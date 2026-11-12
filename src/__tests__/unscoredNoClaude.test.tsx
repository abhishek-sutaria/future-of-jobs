// @vitest-environment jsdom
/**
 * One common role experience (UI.tsx, JobDetailPanel). Mounts the real UI,
 * which owns the auto-analyze effect, and opens roles through the same path
 * search and the 3D view use, with Claude mocked at the client:
 *
 *   - every "All Other" occupation with no published score opens the
 *     numbers-only panel, says Not scored, and NEVER reaches Claude;
 *   - every scored BLS occupation opens the same panel as a Kelley role, with
 *     the same controls, and auto-analyzes once under its own role key;
 *   - a Kelley role, a Healthcare, a Construction and an Office job show the
 *     very same feature set.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const claude = vi.hoisted(() => ({
    callClaudeJSON: vi.fn(async () => ({})),
    callClaudeFeature: vi.fn(async (_feature: string, input: { tasks?: string[] }) => ({
        result: {
            strategic_insight: 'stub insight',
            likely_replacements: ['stub tool'],
            human_centric_traits: ['stub trait'],
            tasks: (input.tasks ?? []).map((t) => ({ task_text: t, ai_exposure_score: 0.5, human_criticality_score: 0.5, reasoning: 'stub reason' })),
        },
        shared: { hit: false, saved: true, savedAt: '2026-11-08T00:00:00.000Z' },
    })),
}));
vi.mock('../utils/claude', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../utils/claude')>()),
    callClaudeJSON: claude.callClaudeJSON,
    callClaudeFeature: claude.callClaudeFeature,
}));

// Resume upload (pdf.js) needs browser canvas APIs jsdom lacks; it is not
// part of what this test checks.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

import { UI } from '../components/UI';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { getRoleEntries, type RoleEntry } from '../utils/roles';
import { BLS_SCORE_RISK, SCORE_COUNTS } from '../utils/blsScores';

const fetchCalls: string[] = [];
let root: Root;
let container: HTMLDivElement;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
    window.matchMedia ??= ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
        fetchCalls.push(String(url));
        return new Response('{}', { status: 503 });
    }));
    localStorage.setItem('foj_intro_dismissed', '1');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<UI dashboardOpen={false} />));
    for (const code of new Set(getRoleEntries(useStore.getState().jobs).map((e) => e.continent))) {
        await act(async () => { await useWorldStore.getState().loadContinent(code); });
    }
});

afterAll(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const entries = () => getRoleEntries(useStore.getState().jobs);

async function open(entry: RoleEntry): Promise<Element> {
    await act(async () => useWorldStore.getState().openRole(entry));
    await settle();
    const dialog = document.querySelector('[role="dialog"]') ?? document.querySelector('.max-w-6xl');
    if (!dialog) throw new Error(`no panel for ${entry.title}`);
    return dialog;
}

async function closeAll() {
    await act(async () => {
        useWorldStore.getState().closeOccupation();
        useStore.getState().setSelectedJob(null);
    });
}

/** The panel's role features, as the visitor sees them. */
function featureSet(panel: Element): string[] {
    const text = panel.textContent ?? '';
    const buttons = [...panel.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`);
    const has = (re: RegExp) => buttons.some((b) => re.test(b));
    return [
        has(/Roadmap/) && 'Roadmap',
        has(/Scenario/) && 'Scenario',
        has(/Defend this task|Build on this/) && 'Defend / Build',
        /Strategic Insight/.test(text) && 'Strategic Insight',
        /Human Resilience/.test(text) && 'Human Resilience',
        /Automation Risk/.test(text) && 'Automation Risk',
        /Human Criticality/.test(text) && 'Human Criticality',
        /Rank among all [\d,]+ scored occupations/.test(text) && 'all-roles rank',
    ].filter(Boolean) as string[];
}

const FULL_SET = ['Roadmap', 'Scenario', 'Defend / Build', 'Strategic Insight', 'Human Resilience', 'Automation Risk', 'Human Criticality', 'all-roles rank'];

describe('one role panel for every scored role', () => {
    it('every unscored occupation says Not scored and never reaches Claude', { timeout: 60_000 }, async () => {
        const unscored = entries().filter((e) => e.kind === 'bls' && !e.scored);
        expect(unscored).toHaveLength(SCORE_COUNTS.unscored);
        claude.callClaudeJSON.mockClear();
        claude.callClaudeFeature.mockClear();
        fetchCalls.length = 0;
        for (const entry of unscored) {
            const panel = await open(entry);
            expect(panel.getAttribute('aria-label'), entry.title).toBe(entry.title);
            expect(panel.querySelector('[data-testid="ai-soon"]')!.textContent, entry.title).toContain('Not scored');
            expect(panel.textContent).not.toContain('Automation Risk');
            expect(featureSet(panel), entry.title).toEqual([]);
        }
        await closeAll();
        expect(claude.callClaudeFeature).not.toHaveBeenCalled();
        expect(claude.callClaudeJSON).not.toHaveBeenCalled();
        expect(fetchCalls.filter((u) => u.includes('/api/claude'))).toEqual([]);
    });

    it('every scored BLS occupation opens the common panel and auto-analyzes once, under its own key', { timeout: 180_000 }, async () => {
        const scored = entries().filter((e) => e.kind === 'bls' && e.scored);
        expect(scored).toHaveLength(BLS_SCORE_RISK.size);
        for (const entry of scored) {
            claude.callClaudeFeature.mockClear();
            const panel = await open(entry);
            expect(useStore.getState().selectedJob).toBeNull();
            expect(panel.querySelector('[data-testid="ai-soon"]'), entry.title).toBeNull();
            expect(panel.querySelector('[data-testid="kelley-label"]'), entry.title).toBeNull();
            expect(featureSet(panel), entry.title).toEqual(expect.arrayContaining(FULL_SET.filter((f) => f !== 'Roadmap' && f !== 'Defend / Build')));
            const analyze = claude.callClaudeFeature.mock.calls.filter(([f]) => f === 'analyze');
            expect(analyze, entry.title).toHaveLength(1);
            expect((analyze[0][1] as { roleKey: string }).roleKey).toBe(`soc:${entry.soc}`);
        }
        await closeAll();
    });

    it('a Kelley role, a Healthcare, a Construction and an Office job show the same feature set', async () => {
        const all = entries();
        const pick = (title: string) => all.find((e) => e.title === title)!;
        const roles = [pick('Financial Analyst'), pick('Registered Nurses'), pick('Electricians'), pick('Secretaries and Administrative Assistants, Except Legal, Medical, and Executive')];
        expect(roles.map((r) => r.continent)).toEqual(['13', '29', '47', '43']);
        for (const role of roles) {
            claude.callClaudeFeature.mockClear();
            const panel = await open(role);
            expect(featureSet(panel), role.title).toEqual(FULL_SET);
            expect(panel.querySelector('[data-testid="rank-scope"]')!.textContent).toBe(`Rank among all ${SCORE_COUNTS.ranked.toLocaleString('en-US')} scored occupations`);
            expect(Boolean(panel.querySelector('[data-testid="kelley-label"]')), role.title).toBe(role.kind === 'kelley');
            expect(panel.textContent).toContain('saved, so every visitor sees this same answer');
            // The BLS jobs were analyzed in the test above: reopening one in the
            // same page reuses that answer (UI's session cache), with no new call.
            expect(claude.callClaudeFeature.mock.calls.filter(([f]) => f === 'analyze')).toHaveLength(role.kind === 'kelley' ? 1 : 0);
            await closeAll();
        }
    });
});
