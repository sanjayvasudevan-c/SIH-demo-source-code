import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { PrefsProvider } from './lib/prefs';
import { ToastProvider } from './components/ui';
import { ApiError } from './api/client';
// Self-hosted fonts, bundled by Vite (no font CDN).
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-500.css';
import '@fontsource/noto-sans/latin-600.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-500.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import '@fontsource/noto-sans-devanagari/devanagari-700.css';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

if (import.meta.env.DEV) {
  void import('@axe-core/react').then(({ default: axe }) => axe(React, ReactDOM, 1000));
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PrefsProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
      </PrefsProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
