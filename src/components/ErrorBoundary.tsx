import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<any, any> {
  state = {
    hasError: false,
    error: null as Error | null
  };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if ((this as any).state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 text-center font-sans">
          <div className="max-w-md space-y-4">
            <h1 className="text-2xl font-bold text-red-500">Something went wrong</h1>
            <p className="text-gray-400">The application encountered an unexpected error.</p>
            <pre className="bg-white/5 p-4 rounded text-xs text-left overflow-auto max-h-40">
              {(this as any).state.error?.message}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-black rounded-full font-bold hover:bg-gray-200 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
