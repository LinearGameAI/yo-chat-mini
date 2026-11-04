import { readSse } from '../../shared/sse';
let csrf = '';
export function setCsrf(value: string) { csrf = value; }
const base = import.meta.env.VITE_API_BASE_URL || '';
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const url = `${base}/api${path}`;
  const method = body === undefined ? 'GET' : 'POST';
  console.info('[yo-chat-mini] API request', { method, url, pageOrigin: window.location.origin });
  let response: Response;
  try {
    response = await fetch(url, { method, credentials: 'include', signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    console.error('[yo-chat-mini] API network failure', { method, url, error });
    throw error;
  }
  const contentType = response.headers.get('content-type') ?? '';
  console.info('[yo-chat-mini] API response', { method, url, status: response.status, ok: response.ok, contentType });
  let data: any;
  try { data = await response.json(); }
  catch (error) {
    console.error('[yo-chat-mini] API returned non-JSON response', { method, url, status: response.status, contentType, error });
    throw new Error(`API ${path} returned ${contentType || 'an unknown content type'} instead of JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) { console.error('[yo-chat-mini] API error response', { method, url, status: response.status, error: data?.error }); throw new Error(data.error || `Request failed (${response.status})`); }
  return data;
}
export function keepProgress(body: unknown) {
  void fetch(`${base}/api/watch/tick`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) }).catch(() => {});
}
export async function streamReply(character: string, text: string, clientRequestId: string, onEvent: (event: string, data: any) => void, signal: AbortSignal) {
  const response = await fetch(`${base}/api/chat/${encodeURIComponent(character)}/responses`, { method: 'POST', signal, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ text, clientRequestId }) });
  if (!response.ok) throw new Error((await response.json()).error || 'Could not send the message.');
  if (!response.body) throw new Error('Streaming is not supported in this browser.');
  let completed = false;
  for await (const frame of readSse(response.body)) {
    const data = JSON.parse(frame.data);
    if (frame.event === 'response.failed') throw new Error(data.message);
    if (frame.event === 'response.completed') completed = true;
    onEvent(frame.event, data);
  }
  if (!completed) throw new Error('The connection ended before the reply finished. Retry your message.');
}
