import { IconX } from './Icons';

/**
 * The one close control used by every panel (dialogs, the Saved page, the
 * guided tour): an X in the top-right corner. Escape and a click outside do
 * the same thing, so panels never need a second "Close" button at the bottom.
 */
export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={`${label} (Esc)`}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        >
            <IconX size={18} />
        </button>
    );
}
