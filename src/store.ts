import { create } from 'zustand';
import type { Job } from './types';

import { initialJobs } from './data';
import { UPSKILL_IMPACT } from './config/GameMechanics';
import {
    YEAR_MIN, PERCENTILES, RESILIENCE_LABELS, VOLATILITY_LABELS,
    CONFIDENCE, BLS_API, DATA_SOURCES,
} from './config/constants';

// ── Percentile helper (used by both fetchRealData and scoreAllJobsWithAI) ──

function applyPercentileLabels(jobs: Job[]): Job[] {
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

// ── Store interface ────────────────────────────────────────────────────────

interface AppState {
    year: number;
    setYear: (year: number) => void;
    selectedJob: Job | null;
    setSelectedJob: (job: Job | null) => void;
    jobs: Job[];
    upskillTask: (jobId: string, taskName: string) => void;

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
    fetchRealData: () => Promise<void>;
    updateJobForecast: (jobId: string, forecast: { year: number, growthImpact: number, reasoning: string }[]) => void;

    // AI Task Scoring
    isScoring: boolean;
    hasAIScores: boolean;
    scoreAllJobsWithAI: () => Promise<void>;
    startupAnalysisState: 'idle' | 'loading' | 'done';
    hasShownStartupGate: boolean;
    startStartupAnalysisGate: () => void;
    finishStartupAnalysisGate: () => void;
    dismissStartupAnalysisGate: () => void;

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
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a3c6a6'},body:JSON.stringify({sessionId:'a3c6a6',runId:'run1',hypothesisId:'H1',location:'store.ts:84',message:'store_set_year_called',data:{year},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        set({ year });
    },
    selectedJob: null,
    setSelectedJob: (selectedJob) => set({ selectedJob }),
    jobs: initialJobs,

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

    fetchRealData: async () => {
        const state = get();
        if (state.isLoadingData || state.hasLoadedRealData) return;
        set({ isLoadingData: true });

        const { fetchLaborStats, getSeriesIdForJob } = await import('./utils/bls');
        const { MAP_TITLE_TO_SOC }                   = await import('./utils/onet');
        const locationModule                          = await import('./data/geo_real.json');
        const locationData: Record<string, { name: string; lat: number; lng: number; employment: number; lq: number }[]> =
            locationModule.default || locationModule;

        // Collect BLS series IDs
        const jobMap    = new Map<string, string>();
        const seriesIds: string[] = [];
        get().jobs.forEach(job => {
            const sid = getSeriesIdForJob(job.title, '01');
            if (sid) { seriesIds.push(sid); jobMap.set(sid, job.id); }
        });

        let blsResults = new Map<string, number>();
        try {
            if (seriesIds.length > 0) blsResults = await fetchLaborStats(seriesIds);
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

        set({ jobs: finalJobs, isLoadingData: false, hasLoadedRealData: true });
    },

    updateJobForecast: (jobId, forecast) => set((state) => {
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run2',hypothesisId:'H3',location:'store.ts:219',message:'update_job_forecast_called',data:{jobId,forecastYears:forecast.map(item => item.year),forecastCount:forecast.length,selectedJobId:state.selectedJob?.id ?? null},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
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
    hasAIScores: false,
    startupAnalysisState: 'idle',
    hasShownStartupGate: false,
    apiKeyMode: null,
    userClaudeApiKey: '',
    hasConfiguredAI: false,
    claudeKeyModalOpen: false,

    startStartupAnalysisGate: () =>
        set((state) => (state.hasShownStartupGate ? state : { startupAnalysisState: 'loading' })),

    finishStartupAnalysisGate: () =>
        set((state) => {
            if (state.hasShownStartupGate || state.startupAnalysisState !== 'loading') return state;
            return { startupAnalysisState: 'done' };
        }),

    dismissStartupAnalysisGate: () =>
        set((state) => {
            if (state.hasShownStartupGate) return state;
            return { startupAnalysisState: 'idle', hasShownStartupGate: true };
        }),

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
    },

    setUserClaudeApiKey: (key) => {
        const trimmed = key.trim();
        localStorage.setItem(AI_MODE_STORAGE_KEY, 'user');
        localStorage.setItem(AI_USER_KEY_STORAGE_KEY, trimmed);
        set({ apiKeyMode: 'user', userClaudeApiKey: trimmed, hasConfiguredAI: true });
    },

    scoreAllJobsWithAI: async () => {
        const state = get();
        if (state.isScoring || state.hasAIScores || !state.hasConfiguredAI) return;

        const userKey = state.apiKeyMode === 'user' ? state.userClaudeApiKey : undefined;
        if (state.apiKeyMode === 'user' && !userKey) {
            console.log('[TaskScoring] User-key mode active but no key found.');
            return;
        }

        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run3',hypothesisId:'H5',location:'store.ts:310',message:'score_all_jobs_started',data:{hasConfiguredAI:state.hasConfiguredAI,hasAIScores:state.hasAIScores,jobCount:state.jobs.length,sampleAutomation:state.jobs.slice(0,3).map(job=>({id:job.id,automationCostIndex:job.automationCostIndex}))},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        set({ isScoring: true });

        try {
            const { scoreAllJobTasks } = await import('./utils/taskScoring');

            const jobsToScore = get().jobs.map(j => ({
                id: j.id,
                title: j.title,
                tasks: j.tasks.map(t => ({ name: t.name })),
            }));

            const allScores = await scoreAllJobTasks(jobsToScore, userKey, (jobId, done, total) => {
                console.log(`[TaskScoring] ${done}/${total} jobs scored`);

                // Apply scores for this job immediately as they arrive
                set(s => {
                    const jobScores = allScores[jobId];
                    if (!jobScores) return s;

                    const updatedJobs = s.jobs.map(job => {
                        if (job.id !== jobId) return job;

                        const newTasks = job.tasks.map(task => {
                            const match = jobScores.find(sc =>
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
                        return { ...job, tasks: newTasks, automationCostIndex: parseFloat(avgAi.toFixed(2)) };
                    });

                    // Re-run percentile labels across all jobs after each update
                    const relabelled    = applyPercentileLabels(updatedJobs);
                    const newSelectedJob = s.selectedJob
                        ? relabelled.find(j => j.id === s.selectedJob!.id) || s.selectedJob
                        : null;

                    // #region agent log
                    fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run3',hypothesisId:'H6',location:'store.ts:355',message:'score_progress_applied',data:{jobId,done,total,updatedAutomation:relabelled.find(job=>job.id===jobId)?.automationCostIndex ?? null,sampleAutomation:relabelled.slice(0,3).map(job=>({id:job.id,automationCostIndex:job.automationCostIndex}))},timestamp:Date.now()})}).catch(()=>{});
                    // #endregion
                    return { jobs: relabelled, selectedJob: newSelectedJob };
                });
            });

            // Final pass — apply any remaining scores that arrived after the last callback
            set(s => {
                const finalJobs = s.jobs.map(job => {
                    const jobScores = allScores[job.id];
                    if (!jobScores) return job;

                    const newTasks = job.tasks.map(task => {
                        const match = jobScores.find(sc =>
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
                    return { ...job, tasks: newTasks, automationCostIndex: parseFloat(avgAi.toFixed(2)) };
                });

                const relabelled     = applyPercentileLabels(finalJobs);
                const newSelectedJob = s.selectedJob
                    ? relabelled.find(j => j.id === s.selectedJob!.id) || s.selectedJob
                    : null;

                // #region agent log
                fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run3',hypothesisId:'H5',location:'store.ts:388',message:'score_all_jobs_finished',data:{jobCount:relabelled.length,sampleAutomation:relabelled.slice(0,3).map(job=>({id:job.id,automationCostIndex:job.automationCostIndex})),hasSelectedJob:!!newSelectedJob},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                return { jobs: relabelled, selectedJob: newSelectedJob, hasAIScores: true };
            });

        } catch (err) {
            console.error('[TaskScoring] Fatal error:', err);
        } finally {
            set({ isScoring: false });
        }
    },
}));
