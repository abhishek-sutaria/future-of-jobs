import React from 'react';

/**
 * Section heading + optional item count, and a muted empty-state line.
 * Lifted out of the old AccountModal.tsx (now the /dashboard page) so both
 * that page and any future consumer share one definition.
 */
export const Section: React.FC<{ title: string; count?: number; children: React.ReactNode }> = ({
    title, count, children,
}) => (
    <section className="mb-6 last:mb-0">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-2">
            {title}
            {typeof count === 'number' && <span className="ml-2 text-gray-500">({count})</span>}
        </h3>
        {children}
    </section>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-xs text-gray-500 italic">{children}</p>
);
