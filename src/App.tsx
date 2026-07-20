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
  const hasAIScores = useStore((state) => state.hasAIScores);
  const isScoring = useStore((state) => state.isScoring);
  const hydrateAIConfig = useStore((state) => state.hydrateAIConfig);
  const startupAnalysisState = useStore((state) => state.startupAnalysisState);
  const hasShownStartupGate = useStore((state) => state.hasShownStartupGate);
  const startStartupAnalysisGate = useStore((state) => state.startStartupAnalysisGate);
  const finishStartupAnalysisGate = useStore((state) => state.finishStartupAnalysisGate);
  const dismissStartupAnalysisGate = useStore((state) => state.dismissStartupAnalysisGate);
  const startupGateTimerRef = useRef<number | null>(null);
  const postGateScoreAttemptsRef = useRef(0);

  useEffect(() => {
    hydrateAIConfig();
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (!hasConfiguredAI) return;
    if (hasShownStartupGate) return;

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

  // If startup bulk scoring produced no merged AI data (API errors, no key, etc.),
  // hasAIScores stays false but the gate effect above never runs again. Retry a
  // limited number of times after the gate dismisses so peaks get forecasts
  // without requiring a full page refresh.
  useEffect(() => {
    if (!hasConfiguredAI || !hasShownStartupGate) return;
    if (hasAIScores || isScoring) return;
    if (postGateScoreAttemptsRef.current >= 2) return;
    postGateScoreAttemptsRef.current += 1;
    void scoreAllJobsWithAI();
  }, [hasConfiguredAI, hasShownStartupGate, hasAIScores, isScoring, scoreAllJobsWithAI]);

  useEffect(() => {

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
      {/* isolate creates a stacking context so drei <Html> label z-indexes (up to 100) can never escape above the fixed UI overlay */}
      <div className="absolute inset-0 z-0 isolate">
        <ErrorBoundary fallback={<WebGLFallback />}>
          <Landscape />
        </ErrorBoundary>
      </div>

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
