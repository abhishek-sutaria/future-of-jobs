import React, { useState } from 'react';
import { useStore } from '../store';
import { IntroModal } from './IntroModal';
import { SkillsModal } from './SkillsModal';
import { useUserStore, reapplyUpskillCompletions } from '../userStore';
import { StartupIdeasModal } from './StartupIdeasModal';
import { MethodologyModal } from './MethodologyModal';
import { StudentGuideModal } from './Modals/StudentGuideModal';
import { HealthCheckModal } from './Modals/HealthCheckModal';
import { BLS_API } from '../config/constants';
import RoleSelector from './RoleSelector';
import { analyzeJob, getClaudeUserFriendlyMessage, type JobAnalysis } from '../utils/analysis';
import { Legend } from './Legend';
import { Header } from './Header';
import { YearSlider } from './YearSlider';
import { JobDetailPanel } from './JobDetailPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { GuidedTour } from './GuidedTour';
import { toast } from './ui/Toast';
import { Z } from '../config/layers';

interface UIProps {
    /** True while /dashboard is showing. The map/3D chrome stays mounted
     * (unmounting would drop economyData, autoAnalyzedJobIdsRef, and
     * re-trigger the BLS fetch on return) but must become inert: invisible to
     * screen readers and unreachable by click/tab, since a full-page view is
     * covering it visually. */
    dashboardOpen: boolean;
}

export const UI: React.FC<UIProps> = ({ dashboardOpen }) => {
    const selectedJob = useStore((state) => state.selectedJob);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const mapView = useStore((state) => state.mapView);

    const [showSkillsModal, setShowSkillsModal] = useState(false);
    const [showStartupIdeasModal, setShowStartupIdeasModal] = useState(false);
    const [showMethodologyModal, setShowMethodologyModal] = useState(false);
    const [showStudentGuide, setShowStudentGuide] = useState(false);
    const [showHealthCheck, setShowHealthCheck] = useState(false);
    const [tourActive, setTourActive] = useState(false);

    // The tour's spotlight targets data-tour selectors on chrome that is
    // covered (and inert) while the dashboard is open — its getBoundingClientRect
    // math would highlight nothing. inert alone only blocks interaction/a11y,
    // not this component's own effects, so it must be stopped explicitly.
    React.useEffect(() => {
        if (dashboardOpen) setTourActive(false);
    }, [dashboardOpen]);

    const [economyData, setEconomyData] = useState<{ value: string, period: string, color: string } | null>(null);
    const [loadingEconomy, setLoadingEconomy] = useState(true);

    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<JobAnalysis | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const missingApiKey = false;

    // Jobs already auto-analyzed this session. This used to be inferred from
    // `selectedJob.yearlyForecast` being absent, but forecasts now ship
    // precomputed for every job, which made that check always short-circuit and
    // silently stopped the deep-dive fields (resilience, volatility, traits)
    // from ever loading. Track the intent directly instead.
    const autoAnalyzedJobIdsRef = React.useRef<Set<string>>(new Set());

    // Record the view as user activity. Kept in its own effect rather than
    // folded into auto-analysis below, which short-circuits for already-analyzed
    // jobs and would therefore miss most repeat visits.
    React.useEffect(() => {
        if (!selectedJob) return;
        void useUserStore.getState().recordJobView(selectedJob.id, selectedJob.title);
    }, [selectedJob?.id]);

    // Auto-analyze selected job
    React.useEffect(() => {
        if (!selectedJob) return;
        const jobId = selectedJob.id;
        const { title, tasks, employment, projectedGrowth } = selectedJob;

        // Don't leave the previously opened job's analysis on screen under this one.
        setAnalysisResult(null);
        setAnalysisError(null);

        if (analysisLoading) return;
        if (autoAnalyzedJobIdsRef.current.has(jobId)) return;
        autoAnalyzedJobIdsRef.current.add(jobId);

        const isStale = () => useStore.getState().selectedJob?.id !== jobId;

        const runAnalysis = async () => {
            setAnalysisLoading(true);
            setAnalysisError(null);

            try {
                const taskList = tasks.map(t => t.name);
                const res = await analyzeJob(jobId, title, taskList, { employment, projectedGrowth });
                // A slow response for a job the user already navigated away from
                // must not overwrite the panel they're looking at now.
                if (isStale()) return;
                setAnalysisResult(res);
                if (res) {
                    useStore.getState().updateJobFromLiveAnalysis(jobId, res);
                    reapplyUpskillCompletions(jobId);
                }
                toast.success('AI analysis complete');
            } catch (e: unknown) {
                console.error('Auto-analysis failed', e);
                // Allow a retry the next time this job is opened.
                autoAnalyzedJobIdsRef.current.delete(jobId);
                if (isStale()) return;
                const msg = e instanceof Error ? e.message : 'Failed to analyze';
                if (msg.includes('429') || msg.includes('quota')) {
                    toast.warning('AI analysis rate limited. Try again in a moment.');
                } else {
                    setAnalysisError(getClaudeUserFriendlyMessage(e));
                }
            } finally {
                setAnalysisLoading(false);
            }
        };
        runAnalysis();
    }, [selectedJob?.id]);

    // Fetch BLS unemployment
    React.useEffect(() => {
        const fetchBLS = async () => {
            const fallbackData = { value: 'Offline', period: 'Cached', color: 'text-gray-500' };
            try {
                const res = await fetch(`${BLS_API.PROXY_URL}/${BLS_API.UNEMPLOYMENT_SERIES_ID}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const json = await res.json();
                const resultObj = json.Results || json.result;

                if (json.status === 'REQUEST_SUCCEEDED' && resultObj?.series?.[0]?.data?.length > 0) {
                    const latest = resultObj.series[0].data[0];
                    const val = parseFloat(latest.value);
                    setEconomyData({
                        value: `${val}%`,
                        period: `${latest.periodName} ${latest.year}`,
                        color: val < BLS_API.UNEMPLOYMENT_THRESHOLD ? 'text-emerald-400' : 'text-red-400'
                    });
                } else {
                    setEconomyData(fallbackData);
                }
            } catch {
                setEconomyData(fallbackData);
                toast.warning('Live economic data unavailable. Showing cached data.');
            } finally {
                setLoadingEconomy(false);
            }
        };
        fetchBLS();
    }, []);

    return (
        // Plain, non-positioned wrapper — deliberately not `relative`/`absolute`
        // so it stays transparent to its children's own `absolute` positioning,
        // which resolves against the App root two levels up exactly as it did
        // when this returned a bare fragment. `inert` (React 19) removes the
        // whole subtree from the accessibility tree and blocks all pointer/
        // keyboard interaction — the belt to the individual suppressions
        // already applied to IntroModal/ApiKeyModal/RescoreConfirmModal/tour.
        <div inert={dashboardOpen}>
            <IntroModal />
            <MethodologyModal isOpen={showMethodologyModal} onClose={() => setShowMethodologyModal(false)} />
            <StudentGuideModal isOpen={showStudentGuide} onClose={() => setShowStudentGuide(false)} />
            <HealthCheckModal isOpen={showHealthCheck} onClose={() => setShowHealthCheck(false)} />

            <Header
                economyData={economyData}
                loadingEconomy={loadingEconomy}
                onOpenSkillsModal={() => setShowSkillsModal(true)}
                onOpenStartupIdeasModal={() => setShowStartupIdeasModal(true)}
                onStartTour={() => setTourActive(true)}
                onOpenStudentGuide={() => setShowStudentGuide(true)}
                onOpenHealthCheck={() => setShowHealthCheck(true)}
            />

            {mapView === 'map' && (
                <div className="absolute left-0 top-0 bottom-0" style={{ zIndex: Z.sidebar }}>
                    <RoleSelector />
                </div>
            )}

            {selectedJob && (
                <ErrorBoundary fallback={<div className="fixed inset-0 flex items-center justify-center pointer-events-auto" style={{ zIndex: Z.detailPanel }}><div className="bg-gray-900 border border-white/10 rounded-xl p-6 text-center"><p className="text-white mb-3">Panel encountered an error</p><button onClick={() => setSelectedJob(null)} className="px-4 py-2 bg-white/10 rounded-lg text-sm text-white">Close</button></div></div>}>
                    <JobDetailPanel
                        job={selectedJob}
                        analysisResult={analysisResult}
                        analysisLoading={analysisLoading}
                        analysisError={analysisError}
                        missingApiKey={missingApiKey}
                        onClose={() => setSelectedJob(null)}
                        onSetAnalysisResult={setAnalysisResult}
                        onSetAnalysisLoading={setAnalysisLoading}
                        onShowMethodology={() => setShowMethodologyModal(true)}
                    />
                </ErrorBoundary>
            )}

            {/* Both are 3D-terrain controls/keys — they do nothing over the 2D map, so
                they are hidden there rather than floating inertly above it. */}
            {mapView !== 'map' && <YearSlider />}

            <div className="absolute bottom-4 left-4 md:left-8 pointer-events-auto" style={{ zIndex: Z.base }}>
                <button
                    data-tour="tour-methodology"
                    onClick={() => setShowMethodologyModal(true)}
                    className="bg-gray-900/70 backdrop-blur-sm border border-white/15 rounded-full px-4 py-2 flex items-center gap-2 text-[11px] text-gray-200 hover:text-white hover:bg-gray-900/90 hover:border-white/25 transition-all cursor-pointer shadow-lg"
                >
                    <span className="uppercase tracking-wider font-semibold text-cyan-400">Sources:</span>
                    <span>Methodology & Data</span>
                </button>
            </div>

            <SkillsModal isOpen={showSkillsModal} onClose={() => setShowSkillsModal(false)} />
            <StartupIdeasModal isOpen={showStartupIdeasModal} onClose={() => setShowStartupIdeasModal(false)} />
            {mapView !== 'map' && <Legend />}
            <GuidedTour isActive={tourActive} onClose={() => setTourActive(false)} />
        </div>
    );
};
