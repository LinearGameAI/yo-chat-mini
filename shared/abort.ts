function abortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

// Do not depend on throwIfAborted/AbortSignal.any/timeout in older WebViews.
export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

export function timedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error('The request timed out.');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);
  const onAbort = () => controller.abort(parent?.reason ?? abortError());
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', onAbort); },
  };
}
