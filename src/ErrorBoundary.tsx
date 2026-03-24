import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-red-100 p-4 rounded-full mb-6">
            <AlertCircle className="w-12 h-12 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-4">A Runtime Error Occurred</h1>
          <div className="bg-white border border-red-200 p-4 rounded-xl max-w-md mb-8">
            <p className="text-red-600 font-mono text-sm break-words">
              {this.state.error?.message || 'Unknown error'}
            </p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="bg-emerald-600 text-white font-bold px-8 py-3 rounded-xl shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try Refreshing
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
