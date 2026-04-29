import { useEffect, useRef } from 'react';
import { Landscape } from './components/Landscape';
import { UI } from './components/UI';
import { MapView } from './components/MapView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ApiKeyModal } from './components/ApiKeyModal';
import { StartupAnalysisOverlay } from './components/StartupAnalysisOverlay';
import { useStore } from './store';

function WebGLFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
      <div className="text-center max-w-md p-8">
        <h2 className="text-xl font-bold text-white mb-2">3D View Unavailable</h2>
        <p className="text-gray-400 text-sm mb-4">
          Your browser doesn't support WebGL or the 3D renderer encountered an error. You can still use the 2D map view.
        </p>
        <button
          onClick={() => useStore.getState().setMapView('map')}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm transition-colors"
        >
          Switch to Map View
        </button>
      </div>
    </div>
  );
}

function App() {
  const mapView = useStore((state) => state.mapView);
  const fetchRealData = useStore((state) => state.fetchRealData);
  const scoreAllJobsWithAI = useStore((state) => state.scoreAllJobsWithAI);
  const hasConfiguredAI = useStore((state) => state.hasConfiguredAI);
  const hydrateAIConfig = useStore((state) => state.hydrateAIConfig);
  const startupAnalysisState = useStore((state) => state.startupAnalysisState);
  const hasShownStartupGate = useStore((state) => state.hasShownStartupGate);
  const startStartupAnalysisGate = useStore((state) => state.startStartupAnalysisGate);
  const finishStartupAnalysisGate = useStore((state) => state.finishStartupAnalysisGate);
  const dismissStartupAnalysisGate = useStore((state) => state.dismissStartupAnalysisGate);
  const startupGateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    hydrateAIConfig();
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (!hasConfiguredAI) return;
    if (hasShownStartupGate) return;
    // #region agent log
    fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run3',hypothesisId:'H6',location:'App.tsx:49',message:'startup_analysis_effect_started',data:{hasConfiguredAI,hasShownStartupGate,startupAnalysisState,year:useStore.getState().year},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // Load BLS employment data first, then score all job tasks with Claude.
    // scoreAllJobsWithAI reads from localStorage cache on repeat visits
    // so the API is only called once per 30 days.
    startStartupAnalysisGate();
    fetchRealData()
      .then(() => scoreAllJobsWithAI())
      .finally(() => finishStartupAnalysisGate());
  }, [
    hasConfiguredAI,
    hasShownStartupGate,
    fetchRealData,
    scoreAllJobsWithAI,
    startStartupAnalysisGate,
    finishStartupAnalysisGate,
  ]);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run3',hypothesisId:'H6',location:'App.tsx:66',message:'startup_analysis_state_changed',data:{startupAnalysisState,hasShownStartupGate},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (startupAnalysisState !== 'done' || hasShownStartupGate) return;
    startupGateTimerRef.current = window.setTimeout(() => {
      dismissStartupAnalysisGate();
      startupGateTimerRef.current = null;
    }, 2000);

    return () => {
      if (startupGateTimerRef.current !== null) {
        window.clearTimeout(startupGateTimerRef.current);
        startupGateTimerRef.current = null;
      }
    };
  }, [startupAnalysisState, hasShownStartupGate, dismissStartupAnalysisGate]);

  return (
    <div className="relative w-full h-full bg-gray-900">
      <ErrorBoundary fallback={<WebGLFallback />}>
        <Landscape />
      </ErrorBoundary>

      <div className={`absolute inset-0 z-10 transition-opacity duration-300 ${mapView === 'map' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {mapView === 'map' && <MapView />}
      </div>

      <UI />
      <ApiKeyModal />
      <StartupAnalysisOverlay />
    </div>
  );
}

export default App;
