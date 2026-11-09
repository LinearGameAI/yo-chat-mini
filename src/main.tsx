import { createRoot } from 'react-dom/client';
import './styles.css';
import { startupLog, errorDetails } from './lib/log';
import { initializeSentry, reportException } from './lib/sentry';

initializeSentry();
startupLog('JS entry executed', { rootPresent: !!document.getElementById('root'), mode: import.meta.env.MODE });
startupLog('Loading App module');
void import('./App').then(({ default: App }) => {
  startupLog('App module loaded');
  const root = document.getElementById('root');
  if (!root) throw new Error('React root element is missing.');
  startupLog('React render requested');
  createRoot(root, {
    onUncaughtError(error) { reportException(error, 'react-render'); startupLog('React render failed', errorDetails(error), 'error'); },
    onCaughtError(error) { reportException(error, 'react-error-boundary'); },
  }).render(<App />);
}).catch(error => {
  reportException(error, 'app-startup');
  startupLog('App startup failed', errorDetails(error), 'error');
});
