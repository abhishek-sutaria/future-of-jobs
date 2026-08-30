/**
 * Per-user data access layer.
 *
 * This is the ONLY module in the app that touches Supabase tables. Keeping the
 * surface in one place means the user-scoping rule is auditable in one file
 * rather than scattered across components.
 *
 * DEFENCE IN DEPTH: every write stamps `user_id` from the live session and
 * every read filters on it, even though Row Level Security already enforces
 * exactly that in Postgres. The RLS policy is the real boundary — this layer
 * is the second lock, and it makes the intent testable without a database.
 *
 * FAILURE POSTURE: nothing here throws into the render tree. A failed call
 * logs and returns a null/empty result, because losing the ability to save a
 * bookmark must never take down the 3D visualisation.
 *
 * PRIVACY: raw resume/CV text is never accepted or stored by this module.
 * Resume-derived artifacts are keyed by a hash of the input (see
 * `resumeCacheKey`) so a user can recover their dashboard without the source
 * document ever leaving the browser.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import type {
    ScenarioResult,
    RoadmapResult,
    ResumeAnalysisResult,
    StartupIdeasResult,
} from '../utils/analysis';

// ── Types ──────────────────────────────────────────────────────────

export type ArtifactKind = 'scenario' | 'roadmap' | 'startup_ideas' | 'skills_analysis';

export interface SavedRole {
    jobId: string;
    jobTitle: string;
    createdAt: string;
}

export interface JobView {
    jobId: string;
    jobTitle: string;
    viewCount: number;
    lastViewedAt: string;
}

export interface UpskillCompletion {
    jobId: string;
    taskName: string;
    completedAt: string;
}

export interface StoredArtifact<T = unknown> {
    id: string;
    kind: ArtifactKind;
    jobId: string | null;
    jobTitle: string | null;
    cacheKey: string;
    payload: T;
    updatedAt: string;
}

/** Everything belonging to one user, loaded in a single hydration pass. */
export interface UserActivity {
    savedRoles: SavedRole[];
    recentViews: JobView[];
    upskillCompletions: UpskillCompletion[];
    artifacts: StoredArtifact[];
}

export const EMPTY_ACTIVITY: UserActivity = {
    savedRoles: [],
    recentViews: [],
    upskillCompletions: [],
    artifacts: [],
};

// ── Cache keys ─────────────────────────────────────────────────────

/** Deterministic key for a per-job scenario. */
export const scenarioCacheKey = (jobId: string): string => jobId;

/** Deterministic key for a roadmap, which is specific to a task transition. */
export const roadmapCacheKey = (jobId: string, riskTask: string, targetTask: string): string =>
    `${jobId}|${riskTask}|${targetTask}`;

/**
 * Stable key for resume-derived artifacts, WITHOUT storing the resume.
 *
 * Uses SubtleCrypto where available so the same CV maps to the same saved
 * dashboard across sessions. Falls back to a simple string hash in
 * environments without SubtleCrypto (older browsers, some test runners).
 * This is a cache key, not a security primitive.
 */
export async function resumeCacheKey(resumeText: string): Promise<string> {
    const normalised = resumeText.trim().replace(/\s+/g, ' ');
    try {
        const subtle = globalThis.crypto?.subtle;
        if (subtle) {
            const bytes = new TextEncoder().encode(normalised);
            const digest = await subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest))
                .slice(0, 16)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch {
        // fall through to the non-crypto path
    }
    let h = 0;
    for (let i = 0; i < normalised.length; i++) {
        h = (Math.imul(31, h) + normalised.charCodeAt(i)) | 0;
    }
    return `fallback-${(h >>> 0).toString(16)}-${normalised.length}`;
}

// ── Internals ──────────────────────────────────────────────────────

interface Ctx {
    db: SupabaseClient;
    userId: string;
}

/**
 * Resolve the client plus the CURRENT user id. Returns null when accounts are
 * unconfigured or nobody is signed in, which is how every public function in
 * this module short-circuits into a safe no-op.
 */
async function ctx(): Promise<Ctx | null> {
    const db = getSupabase();
    if (!db) return null;
    try {
        const { data, error } = await db.auth.getUser();
        if (error || !data?.user) return null;
        return { db, userId: data.user.id };
    } catch {
        return null;
    }
}

function warn(op: string, error: unknown): void {
    if (error) console.warn(`[userData] ${op} failed:`, error);
}

// ── Saved roles ────────────────────────────────────────────────────

export async function saveRole(jobId: string, jobTitle: string): Promise<boolean> {
    const c = await ctx();
    if (!c) return false;
    const { error } = await c.db
        .from('saved_roles')
        .upsert({ user_id: c.userId, job_id: jobId, job_title: jobTitle }, { onConflict: 'user_id,job_id' });
    warn('saveRole', error);
    return !error;
}

export async function unsaveRole(jobId: string): Promise<boolean> {
    const c = await ctx();
    if (!c) return false;
    const { error } = await c.db
        .from('saved_roles')
        .delete()
        .eq('user_id', c.userId)
        .eq('job_id', jobId);
    warn('unsaveRole', error);
    return !error;
}

// ── View history ───────────────────────────────────────────────────

/**
 * Record that the user opened a role. Deliberately stores only the id, title
 * and a counter — never the whole Job object, which is bundled app data and
 * would bloat every row for no benefit.
 */
export async function recordJobView(jobId: string, jobTitle: string): Promise<void> {
    const c = await ctx();
    if (!c) return;
    // Read-modify-write on a 2-column PK. A dedicated RPC with an atomic
    // `view_count + 1` would be tighter, but a lost increment under a race is
    // harmless for a "recently viewed" list and this avoids another migration.
    const { data } = await c.db
        .from('job_views')
        .select('view_count')
        .eq('user_id', c.userId)
        .eq('job_id', jobId)
        .maybeSingle();

    const { error } = await c.db.from('job_views').upsert(
        {
            user_id: c.userId,
            job_id: jobId,
            job_title: jobTitle,
            view_count: (data?.view_count ?? 0) + 1,
            last_viewed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,job_id' }
    );
    warn('recordJobView', error);
}

// ── Upskill completions ────────────────────────────────────────────

export async function recordUpskill(jobId: string, taskName: string): Promise<boolean> {
    const c = await ctx();
    if (!c) return false;
    const { error } = await c.db.from('upskill_completions').upsert(
        { user_id: c.userId, job_id: jobId, task_name: taskName },
        { onConflict: 'user_id,job_id,task_name' }
    );
    warn('recordUpskill', error);
    return !error;
}

// ── Generated artifacts ────────────────────────────────────────────

export async function saveArtifact<T>(
    kind: ArtifactKind,
    cacheKey: string,
    payload: T,
    meta: { jobId?: string | null; jobTitle?: string | null } = {}
): Promise<boolean> {
    const c = await ctx();
    if (!c) return false;
    const { error } = await c.db.from('generated_artifacts').upsert(
        {
            user_id: c.userId,
            kind,
            cache_key: cacheKey,
            payload: payload as never,
            job_id: meta.jobId ?? null,
            job_title: meta.jobTitle ?? null,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,kind,cache_key' }
    );
    warn(`saveArtifact(${kind})`, error);
    return !error;
}

export async function loadArtifact<T>(kind: ArtifactKind, cacheKey: string): Promise<T | null> {
    const c = await ctx();
    if (!c) return null;
    const { data, error } = await c.db
        .from('generated_artifacts')
        .select('payload')
        .eq('user_id', c.userId)
        .eq('kind', kind)
        .eq('cache_key', cacheKey)
        .maybeSingle();
    warn(`loadArtifact(${kind})`, error);
    return (data?.payload as T) ?? null;
}

export async function deleteArtifact(kind: ArtifactKind, cacheKey: string): Promise<boolean> {
    const c = await ctx();
    if (!c) return false;
    const { error } = await c.db
        .from('generated_artifacts')
        .delete()
        .eq('user_id', c.userId)
        .eq('kind', kind)
        .eq('cache_key', cacheKey);
    warn(`deleteArtifact(${kind})`, error);
    return !error;
}

// Convenience wrappers so call sites stay readable and type-safe.
export const saveScenario = (jobId: string, jobTitle: string, r: ScenarioResult) =>
    saveArtifact('scenario', scenarioCacheKey(jobId), r, { jobId, jobTitle });
export const loadScenario = (jobId: string) =>
    loadArtifact<ScenarioResult>('scenario', scenarioCacheKey(jobId));

export const saveRoadmap = (
    jobId: string, jobTitle: string, riskTask: string, targetTask: string, r: RoadmapResult
) => saveArtifact('roadmap', roadmapCacheKey(jobId, riskTask, targetTask), r, { jobId, jobTitle });
export const loadRoadmap = (jobId: string, riskTask: string, targetTask: string) =>
    loadArtifact<RoadmapResult>('roadmap', roadmapCacheKey(jobId, riskTask, targetTask));

export const saveStartupIdeas = (cacheKey: string, r: StartupIdeasResult) =>
    saveArtifact('startup_ideas', cacheKey, r);
export const loadStartupIdeas = (cacheKey: string) =>
    loadArtifact<StartupIdeasResult>('startup_ideas', cacheKey);

export const saveSkillsAnalysis = (cacheKey: string, r: ResumeAnalysisResult) =>
    saveArtifact('skills_analysis', cacheKey, r);
export const loadSkillsAnalysis = (cacheKey: string) =>
    loadArtifact<ResumeAnalysisResult>('skills_analysis', cacheKey);

// ── Hydration ──────────────────────────────────────────────────────

/**
 * Load everything belonging to the current user in one pass, for use on
 * sign-in / app boot. Returns EMPTY_ACTIVITY when unconfigured or signed out,
 * so callers never need to special-case the anonymous path.
 */
export async function loadUserActivity(): Promise<UserActivity> {
    const c = await ctx();
    if (!c) return EMPTY_ACTIVITY;

    const [roles, views, upskills, artifacts] = await Promise.all([
        c.db.from('saved_roles').select('job_id, job_title, created_at')
            .eq('user_id', c.userId).order('created_at', { ascending: false }),
        c.db.from('job_views').select('job_id, job_title, view_count, last_viewed_at')
            .eq('user_id', c.userId).order('last_viewed_at', { ascending: false }).limit(50),
        c.db.from('upskill_completions').select('job_id, task_name, completed_at')
            .eq('user_id', c.userId),
        c.db.from('generated_artifacts').select('id, kind, job_id, job_title, cache_key, payload, updated_at')
            .eq('user_id', c.userId).order('updated_at', { ascending: false }),
    ]);

    warn('loadUserActivity.savedRoles', roles.error);
    warn('loadUserActivity.recentViews', views.error);
    warn('loadUserActivity.upskills', upskills.error);
    warn('loadUserActivity.artifacts', artifacts.error);

    return {
        savedRoles: (roles.data ?? []).map((r) => ({
            jobId: r.job_id, jobTitle: r.job_title, createdAt: r.created_at,
        })),
        recentViews: (views.data ?? []).map((v) => ({
            jobId: v.job_id, jobTitle: v.job_title,
            viewCount: v.view_count, lastViewedAt: v.last_viewed_at,
        })),
        upskillCompletions: (upskills.data ?? []).map((u) => ({
            jobId: u.job_id, taskName: u.task_name, completedAt: u.completed_at,
        })),
        artifacts: (artifacts.data ?? []).map((a) => ({
            id: a.id, kind: a.kind as ArtifactKind, jobId: a.job_id, jobTitle: a.job_title,
            cacheKey: a.cache_key, payload: a.payload, updatedAt: a.updated_at,
        })),
    };
}

/**
 * Erase everything this user has stored. Runs the SECURITY INVOKER function
 * from the migration, so RLS applies and it can only ever delete the caller's
 * own rows — there is no privileged path that could touch another account.
 */
export async function deleteMyData(): Promise<boolean> {
    const c = await ctx();
    if (!c) return false;
    const { error } = await c.db.rpc('delete_my_data');
    warn('deleteMyData', error);
    return !error;
}

/** Current signed-in user, or null. Exposed for the store's hydration pass. */
export async function getCurrentUser(): Promise<User | null> {
    const db = getSupabase();
    if (!db) return null;
    try {
        const { data, error } = await db.auth.getUser();
        return error ? null : (data?.user ?? null);
    } catch {
        return null;
    }
}
