import React, { Suspense, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { takeCareerPathsOpener, useWorldStore } from '../../worldStore';
import { Z } from '../../config/layers';
import { ErrorBoundary } from '../ErrorBoundary';
import { CloseButton } from '../ui/CloseButton';

/**
 * Mounts the Career Paths view (a full-screen page, separate from the 3D
 * landscape) while worldStore.careerPathsOpen. The view, its data and
 * utils/careerPaths load lazily on first open, so the main bundle carries
 * only this host and the buttons that open it.
 *
 * It is portalled to document.body and the app root is made inert while it is
 * open, so clicks, Tab and screen readers stay in the view (the header's
 * pointer-events gotcha does not apply). On close, focus goes back to the
 * control that opened it.
 */
const CareerPathsView = React.lazy(() => import('./CareerPathsView'));

export const CareerPathsHost: React.FC = () => {
    const open = useWorldStore((s) => s.careerPathsOpen);
    const close = useWorldStore((s) => s.closeCareerPaths);

    useLayoutEffect(() => {
        if (!open) return;
        const root = document.getElementById('root');
        root?.setAttribute('inert', '');
        return () => {
            root?.removeAttribute('inert');
            const opener = takeCareerPathsOpener();
            if (opener?.isConnected) opener.focus();
        };
    }, [open]);

    if (!open) return null;
    const shell = (body: React.ReactNode) => (
        <div role="dialog" aria-modal="true" aria-label="Career Paths" className="fixed inset-0 bg-gray-950 text-gray-300 flex items-center justify-center" style={{ zIndex: Z.page }}>
            <div className="absolute top-[calc(0.75rem+var(--safe-top))] right-[calc(0.75rem+var(--safe-right))]">
                <CloseButton onClick={() => close()} label="Close Career Paths" />
            </div>
            {body}
        </div>
    );
    return createPortal(
        <ErrorBoundary fallback={shell(<p className="text-sm">Career Paths could not open. Close it and try again.</p>)}>
            <Suspense fallback={shell(<p className="text-sm text-gray-500" role="status">Loading Career Paths…</p>)}>
                <CareerPathsView />
            </Suspense>
        </ErrorBoundary>,
        document.body,
    );
};
