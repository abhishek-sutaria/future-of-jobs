import { create } from 'zustand';
import type { Job } from './types';

import { initialJobs } from './data';
import { resolveInitialScores, type ScoresSource } from './utils/bakedScores';
import type { JobAnalysisResult } from './utils/taskScoring';
import { UPSKILL_IMPACT } from './config/GameMechanics';
import {
    YEAR_MIN, PERCENTILES, RESILIENCE_LABELS, VOLATILITY_LABELS,
    CONFIDENCE, BLS_API, DATA_SOURCES,
} from './config/constants';

// ── Percentile helper (used by both fetchRealData and scoreAllJobsWithAI) ──
//
// Labels are only meaningful when the underlying scores are real (i.e. Claude
// has analyzed the tasks). If every job's automation index is still 0 we leave
// the labels at their pending sentinel ("—") instead of computing percentiles
// from uninitialized data.

const PENDING_LABEL = '—';

function applyPercentileLabels(jobs: Job[]): Job[] {
    const allUninitialized = jobs.every(j =>
        j.automationCostIndex === 0 &&
        j.tasks.every(t => t.aiCapabilityScore === 0 && t.humanCriticalityScore === 0)
    );

    if (allUninitialized) {
        return jobs.map(job => ({
            ...job,
            humanResilienceLabel: PENDING_LABEL,
            salaryVolatilityLabel: PENDING_LABEL,
        }));
    }

    const autoScores = jobs.map(j => j.automationCostIndex).sort((a, b) => a - b);
    const humanScores = jobs.map(j => {
        const avg = j.tasks.reduce((sum, t) => sum + t.humanCriticalityScore, 0) / j.tasks.length;
        return avg || 0;
    }).sort((a, b) => a - b);

    const pct = (arr: number[], p: number) =>
        arr[Math.min(Math.floor(p * arr.length), arr.length - 1)];

    const p75_auto  = pct(autoScores,  PERCENTILES.HIGH);
    const p50_auto  = pct(autoScores,  PERCENTILES.MEDIUM);
    const p75_human = pct(humanScores, PERCENTILES.HIGH);
    const p25_human = pct(humanScores, PERCENTILES.LOW);

    return jobs.map(job => {
        const item = { ...job };
        const taskScoresUninitialized = job.tasks.every(t =>
            t.aiCapabilityScore === 0 && t.humanCriticalityScore === 0
        );

        // Per-job pending: this specific job hasn't been Claude-scored yet
        // (e.g. a single job failed to score) — leave its labels pending.
        if (taskScoresUninitialized) {
            item.humanResilienceLabel = PENDING_LABEL;
            item.salaryVolatilityLabel = PENDING_LABEL;
            return item;
        }

        const avgHuman = job.tasks.reduce((sum, t) => sum + t.humanCriticalityScore, 0) / job.tasks.length;
        const isHighRisk   = job.automationCostIndex >= p75_auto;
        const isMediumRisk = job.automationCostIndex >= p50_auto;

        item.humanResilienceLabel =
            avgHuman >= p75_human ? RESILIENCE_LABELS.TOP :
            avgHuman >= p25_human ? RESILIENCE_LABELS.MID :
            RESILIENCE_LABELS.BOTTOM;

        item.salaryVolatilityLabel =
            isHighRisk && item.projectedGrowth < 0 ? VOLATILITY_LABELS.CRITICAL :
            isHighRisk                              ? VOLATILITY_LABELS.HIGH :
            isMediumRisk                            ? VOLATILITY_LABELS.MODERATE :
            VOLATILITY_LABELS.STABLE;

        return item;
    });
}

// ── Analysis merge ─────────────────────────────────────────────────────────
//
// Folds Claude analyses (per-task scores + yearly forecast) into jobs. Shared by
// the startup seed (precomputed scores), the live scoring progress callback, and
// the final scoring pass, so all three stay consistent.

function applyAnalysesToJobs(jobs: Job[], analyses: Record<string, JobAnalysisResult>): Job[] {
    return jobs.map(job => {
        const analysis = analyses[job.id];
        if (!analysis) return job;

        const newTasks = job.tasks.map(task => {
            const match = analysis.tasks.find(sc =>
                sc.taskName === task.name ||
                sc.taskName.startsWith(task.name.slice(0, 40))
            );
            if (!match) return task;
            return {
                ...task,
                aiCapabilityScore:     match.aiCapabilityScore,
                humanCriticalityScore: match.humanCriticalityScore,
            };
        });

        const avgAi = newTasks.reduce((sum, t) => sum + t.aiCapabilityScore, 0) / newTasks.length;
        return {
            ...job,
            tasks: newTasks,
            automationCostIndex: parseFloat(avgAi.toFixed(2)),
            yearlyForecast: analysis.yearlyForecast.length > 0
                ? analysis.yearlyForecast
                : job.yearlyForecast,
        };
    });
}

// Precomputed scores are applied synchronously at module load so the very first
// render already has real risk colors and forecasts — no blocking startup pass.
const INITIAL_SCORES = resolveInitialScores();
const SEEDED_JOBS = applyPercentileLabels(applyAnalysesToJobs(initialJobs, INITIAL_SCORES.scores));

// ── Store interface ────────────────────────────────────────────────────────

interface AppState {
    year: number;
    setYear: (year: number) => void;
    selectedJob: Job | null;
    setSelectedJob: (job: Job | null) => void;
    jobs: Job[];
    upskillTask: (jobId: string, taskName: string) => void;

    // Peak height encoding — what does mountain height represent in the 3D view?
    //   'growth'     → cumulative % → damped shader height (timeline scrub)
    //   'employment' → implied headcount (BLS employment × (1+cumulative%/100)) log-scaled (timeline scrub)
    heightMode: 'growth' | 'employment';
    setHeightMode: (mode: 'growth' | 'employment') => void;

    // Map view state
    mapView: 'globe' | 'map';
    setMapView: (mode: 'globe' | 'map') => void;
    selectedRoleIds: Set<string>;
    toggleRoleOnMap: (jobId: string) => void;
    selectAllRoles: () => void;
    clearAllRoles: () => void;

    // Real Data Integration
    isLoadingData: boolean;
    hasLoadedRealData: boolean;
    /** Provenance of the currently displayed BLS employment values */
    blsSource: 'live' | 'cache' | 'seed';
    /** Epoch ms of the fetch that produced them (null when showing bundled seed data) */
    blsFetchedAt: number | null;
    fetchRealData: () => Promise<void>;
    updateJobForecast: (jobId: string, forecast: { year: number, growthImpact: number, reasoning: string }[]) => void;

    // AI Task Scoring
    isScoring: boolean;
    hasAIScores: boolean;
    /** Where the currently displayed scores came from */
    scoresSource: ScoresSource | 'live';
    /** Epoch ms the scores were produced (build time for precomputed, refresh time for live) */
    scoresGeneratedAt: number | null;
    /** Live progress while re-scoring, for the header pill */
    scoringProgress: { done: number; total: number } | null;
    /** `force` bypasses the "already scored" guard — used by the manual refresh */
    scoreAllJobsWithAI: (opts?: { force?: boolean }) => Promise<void>;
    /** Discard cached scores and re-score everything from Claude */
    refreshAIScores: () => Promise<void>;

    // Claude API key mode
    apiKeyMode: 'user' | 'default' | null;
    userClaudeApiKey: string;
    hasConfiguredAI: boolean;
    hydrateAIConfig: () => void;
    useDefaultClaudeKey: () => void;
    setUserClaudeApiKey: (key: string) => void;
    claudeKeyModalOpen: boolean;
    openClaudeKeyModal: () => void;
    closeClaudeKeyModal: () => void;
}

const AI_MODE_STORAGE_KEY = 'foj_ai_mode';
const AI_USER_KEY_STORAGE_KEY = 'foj_user_claude_key';
const HAS_DEFAULT_CLAUDE_KEY = import.meta.env.VITE_HAS_DEFAULT_CLAUDE_KEY;

// ── Store ──────────────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
    year: YEAR_MIN,
    setYear: (year) => {
        set({ year });
    },
    selectedJob: null,
    setSelectedJob: (selectedJob) => set({ selectedJob }),
    jobs: SEEDED_JOBS,

    upskillTask: (jobId, taskName) => set((state) => {
        const newJobs = state.jobs.map((job) => {
            if (job.id !== jobId) return job;
            const newTasks = job.tasks.map((task) => {
                if (task.name !== taskName) return task;
                return {
                    ...task,
                    humanCriticalityScore: Math.min(1, task.humanCriticalityScore + UPSKILL_IMPACT.HUMAN_SCORE_BOOST),
                    aiCapabilityScore: Math.max(0, task.aiCapabilityScore - UPSKILL_IMPACT.AI_SCORE_REDUCTION)
                };
            });
            return { ...job, tasks: newTasks };
        });

        const newSelectedJob = state.selectedJob?.id === jobId
            ? newJobs.find(j => j.id === jobId) || null
            : state.selectedJob;

        return { jobs: newJobs, selectedJob: newSelectedJob };
    }),

    // Peak height encoding
    heightMode: 'growth',
    setHeightMode: (mode) => set({ heightMode: mode }),

    // Map state
    mapView: 'globe',
    setMapView: (mode) => set({ mapView: mode }),

    selectedRoleIds: new Set<string>(),
    toggleRoleOnMap: (jobId) => set((state) => {
        const newSet = new Set(state.selectedRoleIds);
        if (newSet.has(jobId)) newSet.delete(jobId);
        else newSet.add(jobId);
        return { selectedRoleIds: newSet };
    }),
    selectAllRoles:  () => set((state) => ({ selectedRoleIds: new Set(state.jobs.map(j => j.id)) })),
    clearAllRoles:   () => set({ selectedRoleIds: new Set<string>() }),

    // ── BLS Real Data ────────────────────────────────────────────────────

    isLoadingData: false,
    hasLoadedRealData: false,
    blsSource: 'seed',
    blsFetchedAt: null,

    fetchRealData: async () => {
        const state = get();
        if (state.isLoadingData || state.hasLoadedRealData) return;
        set({ isLoadingData: true });

        const { fetchLaborStats, getSeriesIdForJob } = await import('./utils/bls');
        const { MAP_TITLE_TO_SOC }                   = await import('./utils/onet');
        const locationModule                          = await import('./data/geo_real.json');
        // Strip the _meta provenance block — it is not a SOC → locations array entry.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawGeo: Record<string, any> = locationModule.default || locationModule;
        const locationData: Record<string, { name: string; lat: number; lng: number; employment: number; lq: number }[]> =
            Object.fromEntries(Object.entries(rawGeo).filter(([k]) => k !== '_meta'));

        // Collect BLS series IDs
        const jobMap    = new Map<string, string>();
        const seriesIds: string[] = [];
        get().jobs.forEach(job => {
            const sid = getSeriesIdForJob(job.title, '01');
            if (sid) { seriesIds.push(sid); jobMap.set(sid, job.id); }
        });

        let blsResults = new Map<string, number>();
        let blsSource: 'live' | 'cache' | 'seed' = 'seed';
        let blsFetchedAt: number | null = null;
        try {
            if (seriesIds.length > 0) {
                const result = await fetchLaborStats(seriesIds);
                blsResults   = result.values;
                blsSource    = result.source;
                blsFetchedAt = result.fetchedAt;
            }
        } catch (e) {
            console.error('Store: Failed to load BLS data', e);
        }

        // PASS 1 — apply raw BLS employment + compute automationCostIndex
        const intermediateJobs = get().jobs.map(job => {
            const item        = { ...job };
            let dataSources   = [...job.dataSources];

            const sid = getSeriesIdForJob(job.title, '01');
            if (sid) {
                if (blsResults.has(sid)) {
                    const raw         = blsResults.get(sid)!;
                    item.employment   = raw * BLS_API.EMPLOYMENT_MULTIPLIER;
                    dataSources       = [...dataSources.filter(s => !s.startsWith('BLS')), DATA_SOURCES.BLS_CPS];
                    item.isStale      = false;
                } else {
                    item.isStale      = true;
                }
            }

            if (item.tasks.length > 0) {
                const avg             = item.tasks.reduce((s, t) => s + t.aiCapabilityScore, 0) / item.tasks.length;
                item.automationCostIndex = parseFloat(avg.toFixed(2));
            }

            const socCode = MAP_TITLE_TO_SOC[job.title];
            if (socCode && locationData[socCode]) {
                item.locations = locationData[socCode];
                dataSources.push(DATA_SOURCES.BLS_STATE);
            }

            item.dataSources = [...new Set(dataSources)];

            let confidence = CONFIDENCE.BASELINE;
            if (item.dataSources.some(s => s.includes('BLS')))  confidence += CONFIDENCE.BLS_BONUS;
            if (item.dataSources.some(s => s.includes('ONET'))) confidence += CONFIDENCE.ONET_BONUS;
            item.confidenceScore = confidence;

            return item;
        });

        // PASS 2 + 3 — percentile labels
        const finalJobs = applyPercentileLabels(intermediateJobs);

        set({ jobs: finalJobs, isLoadingData: false, hasLoadedRealData: true, blsSource, blsFetchedAt });
    },

    updateJobForecast: (jobId, forecast) => set((state) => {
        const newJobs = state.jobs.map(job =>
            job.id !== jobId ? job : { ...job, yearlyForecast: forecast }
        );
        const newSelected = state.selectedJob?.id === jobId
            ? newJobs.find(j => j.id === jobId) || null
            : state.selectedJob;
        return { jobs: newJobs, selectedJob: newSelected };
    }),

    // ── AI Task Scoring ───────────────────────────────────────────────────

    isScoring: false,
    // Precomputed scores are merged at module load, so the app starts already scored.
    hasAIScores: INITIAL_SCORES.source !== 'none',
    scoresSource: INITIAL_SCORES.source,
    scoresGeneratedAt: INITIAL_SCORES.generatedAt,
    scoringProgress: null,
    apiKeyMode: null,
    userClaudeApiKey: '',
    hasConfiguredAI: false,
    claudeKeyModalOpen: false,

    openClaudeKeyModal: () => set({ claudeKeyModalOpen: true }),
    closeClaudeKeyModal: () => set({ claudeKeyModalOpen: false }),

    hydrateAIConfig: () => {
        const savedMode = (localStorage.getItem(AI_MODE_STORAGE_KEY) as 'user' | 'default' | null);
        const savedUserKey = localStorage.getItem(AI_USER_KEY_STORAGE_KEY) || '';

        if (savedMode === 'default' && HAS_DEFAULT_CLAUDE_KEY) {
            set({ apiKeyMode: 'default', userClaudeApiKey: '', hasConfiguredAI: true });
            return;
        }

        if (savedMode === 'default' && !HAS_DEFAULT_CLAUDE_KEY) {
            localStorage.removeItem(AI_MODE_STORAGE_KEY);
            set({ apiKeyMode: null, userClaudeApiKey: '', hasConfiguredAI: false });
            return;
        }

        if (savedMode === 'user' && savedUserKey.trim()) {
            set({ apiKeyMode: 'user', userClaudeApiKey: savedUserKey.trim(), hasConfiguredAI: true });
            return;
        }

        set({ apiKeyMode: null, userClaudeApiKey: '', hasConfiguredAI: false });
    },

    useDefaultClaudeKey: () => {
        if (!HAS_DEFAULT_CLAUDE_KEY) {
            set({ apiKeyMode: null, userClaudeApiKey: '', hasConfiguredAI: false });
            return;
        }
        localStorage.setItem(AI_MODE_STORAGE_KEY, 'default');
        localStorage.removeItem(AI_USER_KEY_STORAGE_KEY);
        set({ apiKeyMode: 'default', userClaudeApiKey: '', hasConfiguredAI: true });
        queueMicrotask(() => {
            const st = get();
            if (!st.hasConfiguredAI || st.hasAIScores || st.isScoring) return;
            if (st.apiKeyMode === 'user' && !st.userClaudeApiKey.trim()) return;
            void st.scoreAllJobsWithAI();
        });
    },

    setUserClaudeApiKey: (key) => {
        const trimmed = key.trim();
        localStorage.setItem(AI_MODE_STORAGE_KEY, 'user');
        localStorage.setItem(AI_USER_KEY_STORAGE_KEY, trimmed);
        set({ apiKeyMode: 'user', userClaudeApiKey: trimmed, hasConfiguredAI: true });
        queueMicrotask(() => {
            const st = get();
            if (!st.hasConfiguredAI || st.hasAIScores || st.isScoring) return;
            if (st.apiKeyMode === 'user' && !st.userClaudeApiKey.trim()) return;
            void st.scoreAllJobsWithAI();
        });
    },

    scoreAllJobsWithAI: async (opts) => {
        const state = get();
        // `force` lets the manual refresh re-score even though scores already exist.
        if (state.isScoring || !state.hasConfiguredAI) return;
        if (state.hasAIScores && !opts?.force) return;

        const userKey = state.apiKeyMode === 'user' ? state.userClaudeApiKey : undefined;
        if (state.apiKeyMode === 'user' && !userKey) {
            console.log('[TaskScoring] User-key mode active but no key found.');
            return;
        }
        set({ isScoring: true, scoringProgress: { done: 0, total: get().jobs.length } });

        try {
            const { scoreAllJobTasks } = await import('./utils/taskScoring');

            const jobsToScore = get().jobs.map(j => ({
                id: j.id,
                title: j.title,
                tasks: j.tasks.map(t => ({ name: t.name })),
                employment: j.employment,
                projectedGrowth: j.projectedGrowth,
            }));

            const allAnalyses = await scoreAllJobTasks(jobsToScore, userKey, (jobId, done, total, analysis) => {
                // Apply this job's scores as soon as they arrive so the map updates live.
                set(s => {
                    const relabelled = applyPercentileLabels(
                        applyAnalysesToJobs(s.jobs, { [jobId]: analysis }),
                    );
                    return {
                        jobs: relabelled,
                        selectedJob: s.selectedJob
                            ? relabelled.find(j => j.id === s.selectedJob!.id) || s.selectedJob
                            : null,
                        scoringProgress: { done, total },
                    };
                });
            });

            // Final pass — fold in anything that landed after the last callback.
            set(s => {
                const signature = (jobs: Job[]) =>
                    jobs.map(j =>
                        `${j.yearlyForecast?.length ?? 0}:` +
                        j.tasks.reduce((a, t) => a + t.aiCapabilityScore + t.humanCriticalityScore, 0),
                    ).join('|');

                const beforeSig = signature(s.jobs);
                const finalJobs = applyAnalysesToJobs(s.jobs, allAnalyses);
                const applied = Object.keys(allAnalyses).length > 0 || signature(finalJobs) !== beforeSig;

                const relabelled = applyPercentileLabels(finalJobs);
                return {
                    jobs: relabelled,
                    selectedJob: s.selectedJob
                        ? relabelled.find(j => j.id === s.selectedJob!.id) || s.selectedJob
                        : null,
                    hasAIScores: applied || s.hasAIScores,
                    scoresSource: applied ? 'live' as const : s.scoresSource,
                    scoresGeneratedAt: applied ? Date.now() : s.scoresGeneratedAt,
                };
            });

        } catch (err) {
            console.error('[TaskScoring] Fatal error:', err);
        } finally {
            set({ isScoring: false, scoringProgress: null });
        }
    },

    refreshAIScores: async () => {
        const { clearScoreCache } = await import('./utils/taskScoring');
        clearScoreCache();
        // hasAIScores must drop first or the guard below would short-circuit —
        // this is what made the old header pill silently do nothing.
        set({ hasAIScores: false });
        await get().scoreAllJobsWithAI({ force: true });
    },
}));
