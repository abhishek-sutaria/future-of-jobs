import { Component, type ErrorInfo, type ReactNode } from 'react';
import { IconAlertTriangle } from './ui/Icons';
import { Z } from '../config/layers';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="fixed inset-0 bg-gray-950 flex items-center justify-center p-4" style={{ zIndex: Z.errorBoundary }}>
                    <div className="max-w-md w-full bg-gray-900 border border-red-500/20 rounded-2xl p-8 text-center">
                        <div className="flex justify-center mb-5">
                            <IconAlertTriangle size={48} className="text-red-400" />
                        </div>
                        <h1 className="text-xl font-bold text-white mb-2">
                            Something went wrong
                        </h1>
                        <p className="text-gray-400 mb-6 text-sm leading-relaxed">
                            The application encountered an unexpected error. This has been logged automatically.
                        </p>

                        {import.meta.env.DEV && this.state.error && (
                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-4 mb-6 text-left overflow-auto max-h-32">
                                <code className="text-red-400 text-xs font-mono">
                                    {this.state.error.toString()}
                                </code>
                            </div>
                        )}

                        <button
                            onClick={() => window.location.reload()}
                            className="bg-white/10 hover:bg-white/15 text-white font-medium py-2.5 px-6 rounded-lg transition-colors text-sm"
                        >
                            Reload Application
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
