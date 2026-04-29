import React from 'react';
import { useStore } from '../store';

export const StartupAnalysisOverlay: React.FC = () => {
  const startupAnalysisState = useStore((state) => state.startupAnalysisState);
  const isVisible = startupAnalysisState === 'loading' || startupAnalysisState === 'done';

  if (!isVisible) return null;

  const isLoading = startupAnalysisState === 'loading';

  return (
    <div className="fixed inset-0 z-[6000] backdrop-blur-md bg-black/55 flex items-center justify-center pointer-events-auto">
      <div className="w-[90%] max-w-md rounded-2xl border border-white/10 bg-gray-900/90 shadow-2xl p-8 text-center">
        {isLoading ? (
          <>
            <div className="mx-auto mb-4 h-12 w-12 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
            <h2 className="text-xl font-semibold text-white">Analyzing AI...</h2>
            <p className="mt-2 text-sm text-gray-400">
              Running startup analysis. The app will unlock automatically when this completes.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
              <span className="text-emerald-400 text-2xl leading-none">✓</span>
            </div>
            <h2 className="text-xl font-semibold text-white">AI analysis complete</h2>
            <p className="mt-2 text-sm text-gray-400">Loading your workspace...</p>
          </>
        )}
      </div>
    </div>
  );
};
