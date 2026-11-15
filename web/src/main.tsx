import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { registerServiceWorker, watchInstallPrompt } from './push.ts';
import { ToastProvider } from './ui.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
});

/** Last resort: a render error shouldn't leave the hub blank. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center-page">
        <div className="welcome">
          <h1>Something went wrong</h1>
          <p>Homebase hit a snag showing this screen. Reloading usually fixes it.</p>
          <button className="primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

watchInstallPrompt();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
