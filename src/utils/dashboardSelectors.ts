/**
 * Pure data-shaping functions for the /dashboard page.
 *
 * Deliberately pure and framework-free: this repo has no component-testing
 * infrastructure (no @testing-library/react, no jsdom — all 93 existing tests
 * are pure logic/data, see src/__tests__/). Rather than introduce a new
 * testing paradigm for one page, every non-trivial piece of dashboard logic
 * lives here as a plain function, and the components stay a thin
 * presentational shell over it. See src/__tests__/dashboardSelectors.test.ts.
 *
 * SCALE NOTE: the app has exactly 50 roles total, so the realistic ceiling is
 * 50 saved + 50 explored + 250 possible trainings — a few hundred tiny rows,
 * not thousands. These functions are plain array operations with no
 * pagination/virtualization; that is a deliberate choice, not an oversight.
 */

import type { Job } from '../types';
import type { SavedRole, JobView, UpskillCompletion, StoredArtifact, ArtifactKind } from '../lib/userData';
import { getFunctionalCluster, type FunctionalCluster } from '../config/clusters';
import { buildRiskScale, riskBand, type RiskBand, type RiskScale } from '../config/theme';

// ── Job lookup ───────────────────────────────────────────────────────────
//
// No such index exists anywhere in the codebase today — every consumer does
// an O(n) `jobs.find(j => j.id === id)` (AccountModal.tsx, UpskillModal.tsx,
// store.ts, Terrain.tsx, JobMarkers.tsx). A dashboard doing N lookups per
// render over ~50 jobs is trivial cost either way, but a Map is the honest
// tool for repeated lookups and costs nothing to build.

export function buildJobIndex(jobs: Job[]): Map<string, Job> {
    const index = new Map<string, Job>();
    for (const job of jobs) index.set(job.id, job);
    return index;
}

// ── Row enrichment ───────────────────────────────────────────────────────
//
// Saved/viewed rows only carry {jobId, jobTitle, ...activity fields} from the
// database — cluster, risk, and growth are looked up from the live (Claude-
// scored) Job the moment of rendering, not stored, so they always reflect
// current data even for an old save.

export interface EnrichedRow {
    jobId: string;
    jobTitle: string;
    /** null when the role no longer exists in the current dataset (e.g. after
     * a catalogue change) — callers must render a "no longer available" state
     * rather than crash. Mirrors AccountModal.tsx's prior handling of this. */
    job: Job | null;
    cluster: FunctionalCluster | null;
    automationCostIndex: number | null;
    projectedGrowth: number | null;
    riskBand: RiskBand | null;
    /** Present for saved rows. */
    createdAt?: string;
    /** Present for viewed rows. */
    viewCount?: number;
    lastViewedAt?: string;
}

function enrichBase(
    jobId: string,
    jobTitle: string,
    jobIndex: Map<string, Job>,
    riskScale: RiskScale
): Pick<EnrichedRow, 'jobId' | 'jobTitle' | 'job' | 'cluster' | 'automationCostIndex' | 'projectedGrowth' | 'riskBand'> {
    const job = jobIndex.get(jobId) ?? null;
    return {
        jobId,
        jobTitle,
        job,
        cluster: job ? getFunctionalCluster(job.title) : null,
        automationCostIndex: job ? job.automationCostIndex : null,
        projectedGrowth: job ? job.projectedGrowth : null,
        riskBand: job && job.automationCostIndex > 0 ? riskBand(job.automationCostIndex, riskScale) : null,
    };
}

export function enrichSavedRoles(saved: SavedRole[], jobIndex: Map<string, Job>, riskScale: RiskScale): EnrichedRow[] {
    return saved.map((r) => ({
        ...enrichBase(r.jobId, r.jobTitle, jobIndex, riskScale),
        createdAt: r.createdAt,
    }));
}

export function enrichViewedRoles(views: JobView[], jobIndex: Map<string, Job>, riskScale: RiskScale): EnrichedRow[] {
    return views.map((v) => ({
        ...enrichBase(v.jobId, v.jobTitle, jobIndex, riskScale),
        viewCount: v.viewCount,
        lastViewedAt: v.lastViewedAt,
    }));
}

// ── Filtering / sorting ──────────────────────────────────────────────────
//
// Mirrors the app's existing search convention (Header.tsx's SearchBar):
// case-insensitive substring match on title, nothing fancier. No fuzzy
// matching, no token splitting — consistent with the rest of the app rather
// than inventing a new UX here.

export interface DashboardFilters {
    query: string;
    clusters: Set<FunctionalCluster>;
    riskBands: Set<RiskBand>;
}

export const EMPTY_FILTERS: DashboardFilters = {
    query: '',
    clusters: new Set(),
    riskBands: new Set(),
};

export function filterRows(rows: EnrichedRow[], filters: DashboardFilters): EnrichedRow[] {
    const q = filters.query.trim().toLowerCase();
    return rows.filter((row) => {
        if (q && !row.jobTitle.toLowerCase().includes(q)) return false;
        if (filters.clusters.size > 0 && (!row.cluster || !filters.clusters.has(row.cluster))) return false;
        if (filters.riskBands.size > 0 && (!row.riskBand || !filters.riskBands.has(row.riskBand))) return false;
        return true;
    });
}

export type SortKey = 'title' | 'date' | 'risk' | 'growth' | 'views';
export type SortDirection = 'asc' | 'desc';

/**
 * Rows missing the sorted field (no matching job, or a pending '—' score)
 * sort to the end regardless of direction, rather than colliding with 0 at
 * one end of the list.
 */
export function sortRows(rows: EnrichedRow[], key: SortKey, dir: SortDirection): EnrichedRow[] {
    const sign = dir === 'asc' ? 1 : -1;
    const value = (row: EnrichedRow): number | string | null => {
        switch (key) {
            case 'title': return row.jobTitle.toLowerCase();
            case 'date': return row.createdAt ?? row.lastViewedAt ?? null;
            case 'risk': return row.automationCostIndex;
            case 'growth': return row.projectedGrowth;
            case 'views': return row.viewCount ?? null;
        }
    };
    return [...rows].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;   // missing always last
        if (vb == null) return -1;
        if (va < vb) return -1 * sign;
        if (va > vb) return 1 * sign;
        return 0;
    });
}

// ── Portfolio stats ──────────────────────────────────────────────────────

export interface PortfolioStats {
    savedCount: number;
    exploredCount: number;
    trainedCount: number;
    /** null when there are no saved roles with a real score yet — never NaN. */
    averageRisk: number | null;
}

export function computePortfolioStats(
    saved: SavedRole[],
    views: JobView[],
    completions: UpskillCompletion[],
    jobIndex: Map<string, Job>
): PortfolioStats {
    const scored = saved
        .map((r) => jobIndex.get(r.jobId))
        .filter((j): j is Job => !!j && j.automationCostIndex > 0);

    return {
        savedCount: saved.length,
        exploredCount: views.length,
        trainedCount: completions.length,
        averageRisk: scored.length > 0
            ? scored.reduce((sum, j) => sum + j.automationCostIndex, 0) / scored.length
            : null,
    };
}

/**
 * Re-exported so dashboard components build the risk scale the same, correct
 * way every caller in the app already does: from the FULL job list, never a
 * filtered subset — see the caveat on buildRiskScale itself. A dashboard
 * that built the scale from only saved/filtered roles would make a role's
 * colour shift as filters change, which is exactly the bug that comment warns
 * against.
 */
export { buildRiskScale };

// ── Training log ─────────────────────────────────────────────────────────
//
// upskill_completions has no job_title column (see migration) — every
// completion must be joined to a Job by id to get a displayable title.
// Read-only by design: there is no inverse of store.ts's upskillTask, so the
// dashboard must not imply completions can be undone here.

export interface TrainingGroup {
    jobId: string;
    jobTitle: string;
    cluster: FunctionalCluster | null;
    completions: UpskillCompletion[];
}

export function groupTrainingByRole(completions: UpskillCompletion[], jobIndex: Map<string, Job>): TrainingGroup[] {
    const byJob = new Map<string, UpskillCompletion[]>();
    for (const c of completions) {
        const list = byJob.get(c.jobId);
        if (list) list.push(c);
        else byJob.set(c.jobId, [c]);
    }
    return [...byJob.entries()].map(([jobId, list]) => {
        const job = jobIndex.get(jobId);
        return {
            jobId,
            jobTitle: job?.title ?? '(role no longer available)',
            cluster: job ? getFunctionalCluster(job.title) : null,
            completions: list,
        };
    });
}

// ── Saved reports ────────────────────────────────────────────────────────

export interface ArtifactSummary {
    id: string;
    kind: ArtifactKind;
    jobTitle: string | null;
    updatedAt: string;
    /** Short plain-text preview so a report card shows more than a title —
     * this is the exact gap that made the old flat list in AccountModal
     * "not useful" (a bare list of role names carries no information about
     * what was actually generated). */
    preview: string;
}

const ARTIFACT_PREVIEW_LENGTH = 140;

function firstString(payload: unknown, keys: string[]): string | null {
    if (!payload || typeof payload !== 'object') return null;
    for (const key of keys) {
        const value = (payload as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
}

export function summarizeArtifacts(artifacts: StoredArtifact[]): ArtifactSummary[] {
    return artifacts.map((a) => {
        // Each artifact kind's payload shape is documented in userData.ts's
        // typed save/load wrappers; probe the field that carries prose for
        // each rather than importing every result type just for a preview.
        const raw =
            firstString(a.payload, ['story']) ??                 // ScenarioResult
            firstString(a.payload, ['feedback', 'plan']) ??      // ResumeAnalysisResult
            (() => {
                const phases = (a.payload as { phases?: { title?: string }[] })?.phases;
                return phases?.[0]?.title ?? null;                // RoadmapResult
            })() ??
            (() => {
                const profile = (a.payload as { founderProfile?: { summary?: string } })?.founderProfile;
                return profile?.summary ?? null;                  // StartupIdeasResult
            })() ??
            '';
        const preview = raw.length > ARTIFACT_PREVIEW_LENGTH
            ? raw.slice(0, ARTIFACT_PREVIEW_LENGTH).trimEnd() + '…'
            : raw;
        return { id: a.id, kind: a.kind, jobTitle: a.jobTitle, updatedAt: a.updatedAt, preview };
    });
}
