import React from 'react';
import type { SharedAnswerMeta } from '../utils/claude';

const dateLabel = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * One quiet line under a live Claude answer about a role, saying whether it is
 * the saved answer every visitor sees (api/_lib/sharedAnswers) or a one-off
 * because saving is not set up on this server.
 */
export const SharedAnswerNote: React.FC<{ shared?: SharedAnswerMeta; className?: string }> = ({ shared, className = '' }) => {
    if (!shared) return null;
    const when = dateLabel(shared.savedAt);
    const text = shared.saved
        ? `Written by Claude once for this role${when ? ` on ${when}` : ''} and saved, so every visitor sees this same answer.`
        : 'Written by Claude just now. Saving is not set up on this server, so the next visitor gets a new answer.';
    return (
        <p className={`text-[11px] text-gray-500 leading-relaxed mt-3 ${className}`} data-testid="shared-answer-note" data-hit={shared.hit ? 'true' : 'false'}>
            {text}
        </p>
    );
};
