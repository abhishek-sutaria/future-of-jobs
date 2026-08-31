import { useEffect, useState } from 'react';

/**
 * Matches Tailwind's `md` breakpoint (768px) so CSS `max-md:` classes and
 * this hook agree on where "mobile" starts. SSR-safe: the initial value is
 * computed lazily so it never touches `window` during a server render.
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
    );

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    return isMobile;
}
