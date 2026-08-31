import React from 'react';
import { IconShield } from './Icons';

/**
 * Shown wherever a résumé/CV is accepted. Every claim here is enforced by
 * code, not policy: useResumeInput parses PDFs client-side (pdf.js) and the
 * text lives only in component state; userData.ts persists a SHA-256 content
 * hash plus the AI result — never the source text, and only on an explicit
 * "Save this report". Keep this copy and those guarantees in sync.
 */
export const ResumePrivacyNote: React.FC = () => (
    <div className="flex gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
        <IconShield size={14} className="text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed text-gray-400">
            <span className="text-emerald-300 font-semibold">Your résumé stays private.</span>{' '}
            The file is read in your browser and never uploaded. Its text is sent to Anthropic
            only to generate this analysis, then discarded — this app never stores it. If you
            choose <em>Save this report</em>, only the result is saved.
        </p>
    </div>
);
