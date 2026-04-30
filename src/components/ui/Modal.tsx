import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Z } from '../../config/layers';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    layer?: 'base' | 'overlay' | 'top';
    printable?: boolean;
}

const Z_MAP = { base: Z.detailPanel, overlay: Z.modal, top: Z.modalTop } as const;
const SIZE_MAP = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl'
} as const;

export function Modal({ isOpen, onClose, title, children, size = 'md', layer = 'overlay', printable = false }: ModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const titleId = useRef(`modal-${Math.random().toString(36).slice(2, 9)}`);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
            return;
        }
        if (e.key !== 'Tab' || !dialogRef.current) return;

        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;
        previousFocus.current = document.activeElement as HTMLElement;
        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';

        requestAnimationFrame(() => {
            const first = dialogRef.current?.querySelector<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            first?.focus();
        });

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
            previousFocus.current?.focus();
        };
    }, [isOpen, handleKeyDown]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 flex items-center justify-center p-4 animate-in fade-in duration-200"
            style={{ zIndex: Z_MAP[layer] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId.current}
        >
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                ref={dialogRef}
                {...(printable ? { 'data-print-modal': '' } : {})}
                className={`relative bg-gray-900/95 border border-white/10 rounded-2xl ${SIZE_MAP[size]} w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-300`}
            >
                <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
                    <h2
                        id={titleId.current}
                        className="text-lg font-semibold text-white tracking-wide"
                    >
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>
    );
}
