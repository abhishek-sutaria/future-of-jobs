// @vitest-environment jsdom
/**
 * Opening an occupation outside the 50 Kelley roles must never call Claude,
 * whether or not it has published scores (ai_scores_bls.json): every call
 * costs money, and those panels show published figures only. Mounts the real
 * UI (which owns the auto-analyze effect), opens every one of the 783 BLS
 * occupations through the same path search and the 3D view use, and counts
 * calls at both the Claude client and the network.
 *
 * The last test is the control: opening a Kelley role still auto-analyzes, so
 * a zero above means "not called", not "mock not wired".
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const claude = vi.hoisted(() => ({
    callClaudeJSON: vi.fn(async () => ({
        strategic_insight: 'stub',
        likely_replacements: [],
        human_centric_traits: [],
        tasks: [],
    })),
}));
vi.mock('../utils/claude', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../utils/claude')>()),
    callClaudeJSON: claude.callClaudeJSON,
}));

// Resume upload (pdf.js) needs browser canvas APIs jsdom lacks; it is not
// part of what this test checks.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

import { UI } from '../components/UI';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { getRoleEntries } from '../utils/roles';
import { BLS_SCORES } from '../utils/blsScores';

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
});

afterAll(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('non-Kelley occupations never reach Claude', () => {
    it('opens all 783, scored or not, with zero Claude calls', { timeout: 120_000 }, async () => {
        const unscored = getRoleEntries(useStore.getState().jobs).filter((e) => e.kind === 'bls');
        expect(unscored).toHaveLength(783);
        expect(unscored.filter((e) => e.scored)).toHaveLength(BLS_SCORES.size);
        for (const code of new Set(unscored.map((e) => e.continent))) {
            await act(async () => { await useWorldStore.getState().loadContinent(code); });
        }
        claude.callClaudeJSON.mockClear();
        fetchCalls.length = 0;

        for (const entry of unscored) {
            await act(async () => useWorldStore.getState().openRole(entry));
            await settle();
            const dialog = document.querySelector('[role="dialog"]');
            expect(dialog?.getAttribute('aria-label'), entry.title).toBe(entry.title);
            if (entry.scored) {
                expect(dialog?.textContent).toContain('Automation Risk');
                expect(dialog?.textContent).not.toContain('AI scores coming soon');
            } else {
                expect(dialog?.textContent).toContain('AI scores coming soon');
            }
            expect(useStore.getState().selectedJob).toBeNull();
        }
        await act(async () => useWorldStore.getState().closeOccupation());

        expect(claude.callClaudeJSON).not.toHaveBeenCalled();
        expect(fetchCalls.filter((u) => u.includes('/api/claude'))).toEqual([]);
    });

    it('control: opening a Kelley role still auto-analyzes (the mock is wired)', async () => {
        const kelley = getRoleEntries(useStore.getState().jobs).find((e) => e.title === 'Financial Analyst')!;
        expect(kelley.kind).toBe('kelley');
        claude.callClaudeJSON.mockClear();
        await act(async () => useWorldStore.getState().openRole(kelley));
        await settle();
        expect(useStore.getState().selectedJob?.title).toBe('Financial Analyst');
        expect(claude.callClaudeJSON).toHaveBeenCalledTimes(1);
        await act(async () => useStore.getState().setSelectedJob(null));
    });
});
