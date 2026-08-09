import { useEffect, useState } from 'react';
import { Landscape } from './components/Landscape';
import { UI } from './components/UI';
import { MapView } from './components/MapView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ApiKeyModal } from './components/ApiKeyModal';
import { RescoreConfirmModal } from './components/RescoreConfirmModal';
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

/**
 * Feature-detect WebGL before mounting the 3D canvas.
 *
 * The ErrorBoundary below cannot cover this case: three.js raises "Error creating
 * WebGL context" from its own render loop, outside React's render phase, so the
 * boundary never trips and the user is left staring at UI chrome around an empty
 * void — with no hint that the 2D map still works. Machines without a usable GPU
 * (VMs, remote desktops, locked-down laptops) hit this.
 */
function hasWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function App() {
  // Probed once — the answer cannot change for the life of the page.
  const [webglSupported] = useState(hasWebGLSupport);
  const mapView = useStore((state) => state.mapView);
  const fetchRealData = useStore((state) => state.fetchRealData);
  const scoreAllJobsWithAI = useStore((state) => state.scoreAllJobsWithAI);
  const hasConfiguredAI = useStore((state) => state.hasConfiguredAI);
  const hasAIScores = useStore((state) => state.hasAIScores);
  const isScoring = useStore((state) => state.isScoring);
  const hydrateAIConfig = useStore((state) => state.hydrateAIConfig);
  const scoresSource = useStore((state) => state.scoresSource);

  useEffect(() => {
    hydrateAIConfig();
  }, [hydrateAIConfig]);

  // BLS employment refresh. Deliberately not awaited and not gated behind any
  // overlay — it's one batched call with a 24h cache, and the app is fully
  // usable from bundled values while it lands.
  useEffect(() => {
    void fetchRealData();
  }, [fetchRealData]);

  // Scores normally come precomputed from src/data/ai_scores.json (applied at
  // store init), so nothing to do here. Only fall back to live scoring when that
  // file is missing/stale — and even then in the background, never blocking.
  useEffect(() => {
    if (!hasConfiguredAI) return;
    if (scoresSource !== 'none') return;
    if (hasAIScores || isScoring) return;
    console.warn('[Scores] No precomputed scores found — falling back to live scoring. Run `npm run generate-scores`.');
    void scoreAllJobsWithAI();
  }, [hasConfiguredAI, scoresSource, hasAIScores, isScoring, scoreAllJobsWithAI]);

  return (
    <div className="relative w-full h-full bg-gray-900">
      {/* isolate creates a stacking context so drei <Html> label z-indexes (up to 100) can never escape above the fixed UI overlay */}
      <div className="absolute inset-0 z-0 isolate">
        {webglSupported ? (
          <ErrorBoundary fallback={<WebGLFallback />}>
            <Landscape />
          </ErrorBoundary>
        ) : (
          <WebGLFallback />
        )}
      </div>

      <div className={`absolute inset-0 z-10 transition-opacity duration-300 ${mapView === 'map' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {mapView === 'map' && <MapView />}
      </div>

      <UI />
      <ApiKeyModal />
      <RescoreConfirmModal />
    </div>
  );
}

export default App;
