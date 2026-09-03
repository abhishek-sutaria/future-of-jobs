import { useStore } from '../store';

/**
 * Shared between App.tsx (WebGL unsupported at all, or an uncaught render
 * error) and Landscape.tsx (WebGL context lost on a real device and gave up
 * trying to recover — see MAX_CONTEXT_LOSS_RETRIES there). Same failure
 * shape either way: the 3D canvas is a dead end, but the 2D map never
 * touches WebGL at all (react-simple-maps renders SVG), so it's always a
 * working way out.
 */
export function WebGLFallback() {
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
