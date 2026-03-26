import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeFirebase } from './firebase';

const rootElement = document.getElementById('root')!;
const root = createRoot(rootElement);

// Show a simple loading state immediately
root.render(
  <div className="min-h-screen bg-black text-white flex items-center justify-center font-sans">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      <p className="text-sm tracking-widest uppercase opacity-50">Initializing Adventure...</p>
    </div>
  </div>
);

initializeFirebase()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err) => {
    console.error("Initialization failed", err);
    root.render(
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 text-center font-sans">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-bold text-red-500">Initialization Error</h1>
          <p className="text-gray-400">The game failed to start. This might be due to a network error or missing configuration.</p>
          <pre className="bg-white/5 p-4 rounded text-xs text-left overflow-auto max-h-40">{err.message}</pre>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-white text-black rounded-full font-bold hover:bg-gray-200 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  });
