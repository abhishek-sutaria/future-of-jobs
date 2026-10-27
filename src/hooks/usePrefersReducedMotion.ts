import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** True when the user asked the OS for less motion. Tracks changes live. */
export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches);
    useEffect(() => {
        const mq = window.matchMedia?.(QUERY);
        if (!mq) return;
        const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}
