import { create } from 'zustand';
import { UI } from '../../config/constants';
import { Z } from '../../config/layers';

interface Toast {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

interface ToastStore {
    toasts: Toast[];
    addToast: (message: string, type?: Toast['type'], duration?: number) => void;
    removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    addToast: (message, type = 'info', duration = UI.TOAST_DURATION_MS) => {
        const id = Math.random().toString(36).slice(2);
        set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
        if (duration > 0) {
            setTimeout(() => {
                set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) }));
            }, duration);
        }
    },
    removeToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export const toast = {
    info: (msg: string) => useToastStore.getState().addToast(msg, 'info'),
    success: (msg: string) => useToastStore.getState().addToast(msg, 'success'),
    error: (msg: string) => useToastStore.getState().addToast(msg, 'error'),
    warning: (msg: string) => useToastStore.getState().addToast(msg, 'warning'),
};

const TYPE_STYLES: Record<Toast['type'], string> = {
    info: 'border-blue-500/30 bg-blue-950/80 text-blue-200',
    success: 'border-emerald-500/30 bg-emerald-950/80 text-emerald-200',
    error: 'border-red-500/30 bg-red-950/80 text-red-200',
    warning: 'border-amber-500/30 bg-amber-950/80 text-amber-200',
};

const TYPE_ICONS: Record<Toast['type'], string> = {
    info: 'M12 16v-4m0-4h.01M22 12a10 10 0 11-20 0 10 10 0 0120 0z',
    success: 'M9 12l2 2 4-4m6 2a10 10 0 11-20 0 10 10 0 0120 0z',
    error: 'M12 9v2m0 4h.01M21 12a10 10 0 11-20 0 10 10 0 0120 0z',
    warning: 'M12 9v2m0 4h.01m-6.94 4h13.86c1.1 0 1.96-.9 1.73-1.97L13.73 4.03c-.23-1.07-1.23-1.07-1.46 0L5.41 18.03C5.18 19.1 6.04 20 7.14 20z',
};

export function ToastContainer() {
    const toasts = useToastStore(s => s.toasts);
    const removeToast = useToastStore(s => s.removeToast);

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed bottom-6 right-6 flex flex-col gap-2 pointer-events-none"
            style={{ zIndex: Z.toast }}
            aria-live="polite"
        >
            {toasts.map(t => (
                <div
                    key={t.id}
                    className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium backdrop-blur-md shadow-lg animate-in slide-in-from-bottom-3 fade-in duration-300 ${TYPE_STYLES[t.type]}`}
                    role="alert"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d={TYPE_ICONS[t.type]} />
                    </svg>
                    <span className="flex-1">{t.message}</span>
                    <button
                        onClick={() => removeToast(t.id)}
                        className="opacity-50 hover:opacity-100 transition-opacity shrink-0"
                        aria-label="Dismiss"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            ))}
        </div>
    );
}
