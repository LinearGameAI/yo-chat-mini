type Level = 'info' | 'warn' | 'error';
declare global {
  interface Window { __miniLog?: (stage: string, details?: unknown, level?: Level) => void }
}
export function startupLog(stage: string, details?: unknown, level: Level = 'info') {
  if (window.__miniLog) window.__miniLog(stage, details, level);
  else console[level](`[mini-startup] ${stage}`, details);
}
export function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, stack: error.stack,
    cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : undefined };
}
