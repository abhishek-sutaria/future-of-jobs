import React from 'react';
import type { ResumeAnalysisResult } from '../../utils/analysis';

/** Presentational only. Used by the dashboard viewer and the export renderer. */
export const SkillsReport: React.FC<{ result: ResumeAnalysisResult }> = ({ result }) => (
    <div className="space-y-4 text-sm">
        {result.feedback && (
            <p data-print-card className="text-gray-200 leading-relaxed print:text-black">{result.feedback}</p>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
            {result.strengths?.length > 0 && (
                <div data-print-card>
                    <h4 className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2 print:text-black">Strengths</h4>
                    <ul className="space-y-1.5">
                        {result.strengths.map((s, i) => <li key={i} className="text-gray-300 text-xs print:text-black">&bull; {s}</li>)}
                    </ul>
                </div>
            )}
            {result.gaps?.length > 0 && (
                <div data-print-card>
                    <h4 className="text-[10px] uppercase tracking-wider text-red-400 font-semibold mb-2 print:text-black">Gaps</h4>
                    <ul className="space-y-1.5">
                        {result.gaps.map((s, i) => <li key={i} className="text-gray-300 text-xs print:text-black">&bull; {s}</li>)}
                    </ul>
                </div>
            )}
        </div>
        {result.plan && (
            <div data-print-card>
                <h4 className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold mb-2 print:text-black">5-Year Plan</h4>
                <p className="text-gray-300 text-xs leading-relaxed print:text-black">{result.plan}</p>
            </div>
        )}
    </div>
);
