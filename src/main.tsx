import { createRoot } from 'react-dom/client';
import './styles.css';
import { startupLog, errorDetails } from './lib/log';

startupLog('JS entry executed', { rootPresent: !!document.getElementById('root'), mode: import.meta.env.MODE });
startupLog('Loading App module');
void import('./App').then(({ default: App }) => {
  startupLog('App module loaded');
  const root = document.getElementById('root');
  if (!root) throw new Error('React root element is missing.');
  startupLog('React render requested');
  createRoot(root).render(<App />);
}).catch(error => startupLog('App startup failed', errorDetails(error), 'error'));
