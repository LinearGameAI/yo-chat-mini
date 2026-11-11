import { flowLog, flowError } from './flow-log.js';
import { z } from 'zod';
import { readSse } from './sse.js';
import { AppError } from './story.js';

export interface YorollClient {
  baseUrl: string;
  accessToken: string;
  deviceId: string;
  language?: string;
}

async function request(client: YorollClient, endpoint: string, body: unknown, signal: AbortSignal, stream = false) {
  const url = new URL(`${client.baseUrl.replace(/\/$/, '')}/${endpoint}`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new AppError(500, 'Yoroll chat must use HTTPS.');
  }
  const started = Date.now();
  flowLog('Chat POST started', { origin: url.origin, path: url.pathname, stream });
  try {
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal,
    headers: {
      'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${client.accessToken}`, 'Accept-Language': client.language || 'en',
      'X-Client-Type': 'web', 'X-Client-Platform': 'web', 'X-Client-Version': '0.1.0',
      'X-Device-Id': client.deviceId,
    },
    body: JSON.stringify(body),
  });
  flowLog('Chat POST response received', { path: url.pathname, status: response.status, contentType: response.headers.get('content-type'), elapsedMs: Date.now() - started });
  return response;
  } catch (error) { flowError('Chat POST failed', error, { path: url.pathname, aborted: signal.aborted, elapsedMs: Date.now() - started }); throw error; }
}

function upstreamError(status: number, code?: string): AppError {
  if (status === 401) return new AppError(401, 'Yoroll chat login has expired. Please sign in again.');
  if (code === 'insufficient_credits') return new AppError(402, 'Not enough Yoroll credits to send this message.');
  if (status === 429 || code === 'rate_limited') return new AppError(429, 'Yoroll chat is busy. Please try again shortly.');
  return new AppError(502, 'Yoroll chat could not complete this reply. Please retry.');
}

export function createYorollConversation(client: YorollClient, companionId: string, signal: AbortSignal): Promise<string> {
  return openYorollConversation(client, companionId, signal, true);
}

// Resolve the current chat on the server, including after a new WebView or device login.
export function resumeYorollConversation(client: YorollClient, companionId: string, signal: AbortSignal): Promise<string> {
  return openYorollConversation(client, companionId, signal, false);
}

async function openYorollConversation(client: YorollClient, companionId: string, signal: AbortSignal, startNew: boolean): Promise<string> {
  const response = await request(client, `companions/${encodeURIComponent(companionId)}/conversations`, { startNew }, signal);
  if (!response.ok) { await response.body?.cancel(); throw upstreamError(response.status); }
  const data = z.object({ conversation: z.object({ id: z.string().min(1) }) }).safeParse(await response.json());
  if (!data.success) throw new AppError(502, 'Yoroll returned an invalid conversation.');
  return data.data.conversation.id;
}

const blockSchema = z.object({ type: z.string(), text: z.string().optional() });
const messageSchema = z.object({ id: z.string().min(1), text: z.string().optional(), blocks: z.array(blockSchema).optional() });
type Block = z.infer<typeof blockSchema>;
function blockText(blocks: Block[]): string {
  return blocks.filter(block => ['dialog', 'voiceover', 'thought'].includes(block.type) && block.text)
    .map(block => block.text).join('\n\n');
}

// Yield complete text snapshots: block.updated replaces a block rather than appending it.
export async function* streamYorollReply(client: YorollClient, conversationId: string,
  input: { text: string; clientRequestId: string; model?: string }, signal: AbortSignal) {
  const response = await request(client, `conversations/${encodeURIComponent(conversationId)}/responses`,
    { ...input, streamFormat: 'blocks' }, signal, true);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw upstreamError(response.status, data?.error?.code);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new AppError(502, 'Yoroll did not return a chat stream.');
  }
  const blocks = new Map<number, Block>();
  let text = ''; let sawBlocks = false;
  for await (const frame of readSse(response.body)) {
    if (!['block.updated', 'text.delta', 'response.completed', 'response.failed'].includes(frame.event)) continue;
    let data: unknown;
    try { data = JSON.parse(frame.data); }
    catch { throw new AppError(502, 'Yoroll returned an invalid chat event.'); }
    if (frame.event === 'response.failed') {
      flowLog('Chat SSE failure event received');
      const failure = z.object({ code: z.string() });
      const parsed = z.union([failure, z.object({ error: failure })]).safeParse(data);
      const code = parsed.success ? ('error' in parsed.data ? parsed.data.error.code : parsed.data.code) : undefined;
      throw upstreamError(502, code);
    }
    if (frame.event === 'response.completed') {
      flowLog('Chat SSE completion event received');
      const parsed = z.object({ userMessage: messageSchema, replyMessage: messageSchema }).safeParse(data);
      if (!parsed.success) throw new AppError(502, 'Yoroll returned an invalid completed reply.');
      const message = parsed.data.replyMessage;
      const finalText = message.blocks?.length ? blockText(message.blocks) : message.text;
      if (!finalText?.trim()) throw new AppError(502, 'Yoroll returned an empty reply.');
      if (finalText !== text) yield finalText;
      return;
    }
    if (frame.event === 'block.updated') {
      const parsed = z.object({ messageId: z.string().min(1), blockIndex: z.number().int().nonnegative(), block: blockSchema, complete: z.boolean() }).safeParse(data);
      if (!parsed.success) throw new AppError(502, 'Yoroll returned an invalid message block.');
      sawBlocks = true;
      blocks.set(parsed.data.blockIndex, parsed.data.block);
      const snapshot = blockText([...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block));
      if (snapshot !== text) { text = snapshot; yield text; }
    } else if (!sawBlocks) {
      const parsed = z.object({ text: z.string() }).safeParse(data);
      if (!parsed.success) throw new AppError(502, 'Yoroll returned an invalid text delta.');
      text += parsed.data.text;
      if (parsed.data.text) yield text;
    }
  }
  throw new AppError(502, 'Yoroll chat was interrupted before the reply completed. Retry your message.');
}
