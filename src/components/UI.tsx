import React, { useState } from 'react';
import { useStore } from '../store';
import { IntroModal } from './IntroModal';
import { SkillsModal } from './SkillsModal';
import { MethodologyModal } from './MethodologyModal';
import { StudentGuideModal } from './Modals/StudentGuideModal';
import { BLS_API } from '../config/constants';
import RoleSelector from './RoleSelector';
import { analyzeJob, getClaudeUserFriendlyMessage, type JobAnalysis, IS_DEMO_MODE } from '../utils/analysis';
import { Legend } from './Legend';
import { Header } from './Header';
import { YearSlider } from './YearSlider';
import { JobDetailPanel } from './JobDetailPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { GuidedTour } from './GuidedTour';
import { toast } from './ui/Toast';
import { Z } from '../config/layers';

export const UI: React.FC = () => {
    const selectedJob = useStore((state) => state.selectedJob);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const mapView = useStore((state) => state.mapView);

    const [showSkillsModal, setShowSkillsModal] = useState(false);
    const [showMethodologyModal, setShowMethodologyModal] = useState(false);
    const [showStudentGuide, setShowStudentGuide] = useState(false);
    const [tourActive, setTourActive] = useState(false);

    const [economyData, setEconomyData] = useState<{ value: string, period: string, color: string } | null>(null);
    const [loadingEconomy, setLoadingEconomy] = useState(true);

    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<JobAnalysis | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const missingApiKey = false;

    // Auto-analyze selected job
    React.useEffect(() => {
        if (!selectedJob || selectedJob.yearlyForecast || analysisLoading) return;

        const runAnalysis = async () => {
            setAnalysisLoading(true);
            setAnalysisError(null);
            // #region agent log
            fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run2',hypothesisId:'H4',location:'UI.tsx:42',message:'auto_analysis_started',data:{jobId:selectedJob.id,jobTitle:selectedJob.title,selectedYear:useStore.getState().year,alreadyHasForecast:!!selectedJob.yearlyForecast},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            try {
                const taskList = selectedJob.tasks.map(t => t.name);
                const res = await analyzeJob(selectedJob.title, taskList);
                setAnalysisResult(res);
                if (res?.yearlyForecast) {
                    // #region agent log
                    fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run2',hypothesisId:'H4',location:'UI.tsx:48',message:'auto_analysis_received_forecast',data:{jobId:selectedJob.id,selectedYear:useStore.getState().year,forecastYears:res.yearlyForecast.map(item => item.year),forecastCount:res.yearlyForecast.length},timestamp:Date.now()})}).catch(()=>{});
                    // #endregion
                    useStore.getState().updateJobForecast(selectedJob.id, res.yearlyForecast);
                }
                if (!IS_DEMO_MODE) {
                    toast.success('AI analysis complete');
                }
            } catch (e: unknown) {
                console.error('Auto-analysis failed', e);
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
        <>
            <IntroModal />
            <MethodologyModal isOpen={showMethodologyModal} onClose={() => setShowMethodologyModal(false)} />
            <StudentGuideModal isOpen={showStudentGuide} onClose={() => setShowStudentGuide(false)} />

            <Header
                economyData={economyData}
                loadingEconomy={loadingEconomy}
                onOpenSkillsModal={() => setShowSkillsModal(true)}
                onStartTour={() => setTourActive(true)}
                onOpenStudentGuide={() => setShowStudentGuide(true)}
            />

            {mapView === 'map' && (
                <div className="absolute left-0 top-0 bottom-0" style={{ zIndex: Z.sidebar }}>
                    <RoleSelector />
                </div>
            )}

            {selectedJob && (
                <ErrorBoundary fallback={<div className="fixed inset-0 flex items-center justify-center z-[200] pointer-events-auto"><div className="bg-gray-900 border border-white/10 rounded-xl p-6 text-center"><p className="text-white mb-3">Panel encountered an error</p><button onClick={() => setSelectedJob(null)} className="px-4 py-2 bg-white/10 rounded-lg text-sm text-white">Close</button></div></div>}>
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

            <YearSlider />

            <div className="absolute bottom-4 right-4 md:right-8 pointer-events-none md:pointer-events-auto flex justify-end" style={{ zIndex: Z.base }}>
                <button
                    data-tour="tour-methodology"
                    onClick={() => setShowMethodologyModal(true)}
                    className="bg-gray-900/40 backdrop-blur-sm border border-white/[0.06] rounded-full px-4 py-1.5 flex items-center gap-3 text-[10px] text-gray-500 hover:text-white hover:bg-gray-900/60 transition-all cursor-pointer"
                >
                    <span className="uppercase tracking-wider font-semibold opacity-70">Sources:</span>
                    <span>Methodology & Data</span>
                </button>
            </div>

            <SkillsModal isOpen={showSkillsModal} onClose={() => setShowSkillsModal(false)} />
            <Legend />
            <GuidedTour isActive={tourActive} onClose={() => setTourActive(false)} />
        </>
    );
};
