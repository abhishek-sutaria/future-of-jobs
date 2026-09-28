import { useMediaQuery } from './useMediaQuery';

/**
 * Matches Tailwind's `md` breakpoint (768px) so CSS `max-md:` classes and
 * this hook agree on where "mobile" starts.
 */
export function useIsMobile(): boolean {
    return useMediaQuery('(max-width: 767px)');
}

/**
 * Phone + tablet portrait: use the role filter sheet instead of the 320px
 * desktop sidebar. At 768–1023 the sidebar ate ~40% of the map.
 */
export function usePreferRoleSheet(): boolean {
    return useMediaQuery('(max-width: 1023px)');
}
