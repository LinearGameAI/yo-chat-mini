// SSE frame rules extracted from Yoroll's chatStream.ts; browser/server neutral.
export function parseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message'; const lines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value; else if (field === 'data') lines.push(value);
  }
  return lines.length || event !== 'message' ? { event, data: lines.join('\n') } : null;
}
export async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpMatchArray | null;
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const end = match.index!; const frame = parseFrame(buffer.slice(0, end));
        buffer = buffer.slice(end + match[0].length); if (frame) yield frame;
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
