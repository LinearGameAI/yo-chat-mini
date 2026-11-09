import { init, captureException, globalHandlersIntegration, dedupeIntegration, linkedErrorsIntegration, type BrowserOptions } from '@sentry/browser';
import { startupLog, errorDetails } from './log';

// A browser DSN is a public ingest address. Keep the project's default in the
// bundle so H5 and uploaded Minis packages work without another deployment secret.
// An explicit empty VITE_SENTRY_DSN disables reporting (useful for automated tests).
const dsn = import.meta.env.VITE_SENTRY_DSN ?? 'https://14f2c969a37f0936942f527f5767c029@o4512322216984576.ingest.us.sentry.io/4512384603324416';
let enabled = false;

export function errorOnlyOptions(): BrowserOptions {
  return {
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    defaultIntegrations: false,
    integrations: [globalHandlersIntegration({ onerror: true, onunhandledrejection: true }), linkedErrorsIntegration(), dedupeIntegration()],
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
      urlQueryParams: false, stackFrameVariables: false, frameContextLines: 0,
    },
    sendClientReports: false,
    maxBreadcrumbs: 0,
    tracePropagationTargets: [],
    beforeSend(event) {
      // captureMessage can include a synthetic exception stack in newer SDKs.
      // Reject message events explicitly rather than mistaking them for errors.
      if (event.message !== undefined || !event.exception?.values?.length) return null;
      delete event.breadcrumbs;
      delete event.user;
      delete event.request;
      delete event.extra;
      return event;
    },
    beforeSendTransaction: () => null,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  };
}

export function initializeSentry() {
  if (!dsn) { startupLog('Sentry disabled: VITE_SENTRY_DSN is not configured'); return; }
  try {
    init(errorOnlyOptions());
    enabled = true;
    startupLog('Sentry error monitoring initialized');
  } catch (error) {
    startupLog('Sentry initialization failed', errorDetails(error), 'warn');
  }
}

export function reportException(error: unknown, source: string) {
  if (!enabled) return;
  captureException(error, { tags: { source } });
}
