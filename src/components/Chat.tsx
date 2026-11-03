import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, Message, StoryContext } from '../../shared/types';
import { api, streamReply } from '../lib/api';
import { Icon } from './Icon';

export function Chat({ data, initialCharacter, onBack }: { data: Bootstrap; initialCharacter?: string; onBack(): void }) {
  const [characterId, setCharacterId] = useState(data.catalog.characters.some(c => c.id === initialCharacter) ? initialCharacter! : data.catalog.characters[0].id);
  const character = data.catalog.characters.find(c => c.id === characterId)!;
  const [messages, setMessages] = useState<Message[]>([]); const [context, setContext] = useState<StoryContext>();
  const [text, setText] = useState(''); const [stream, setStream] = useState(''); const [pendingText, setPendingText] = useState('');
  const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null); const request = useRef<AbortController | null>(null); const retry = useRef<{ text: string; id: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void api<{ messages: Message[]; context: StoryContext }>(`/chat/${characterId}`, undefined, controller.signal).then(r => { setMessages(r.messages); setContext(r.context); setLoading(false); }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => { controller.abort(); request.current?.abort(); };
  }, [characterId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'instant', block: 'end' }); }, [messages, stream, pendingText]);
  useEffect(() => { if (input.current) { input.current.style.height = '44px'; input.current.style.height = `${Math.min(120, Math.max(44, input.current.scrollHeight))}px`; } }, [text]);
  async function send(value = text) {
    const content = value.trim(); if (!content || sending || loading) return;
    setError(''); setSending(true); setText(''); setPendingText(content); setStream('');
    const id = retry.current?.text === content ? retry.current.id : crypto.randomUUID(); retry.current = { text: content, id };
    const controller = new AbortController(); request.current = controller;
    try {
      await streamReply(characterId, content, id, (event, payload) => {
        if (event === 'response.delta') setStream(s => s + payload.text);
      }, controller.signal);
      const result = await api<{ messages: Message[]; context: StoryContext }>(`/chat/${characterId}`); setMessages(result.messages); setContext(result.context);
      setPendingText(''); setStream(''); retry.current = null;
    } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setText(content); setPendingText(''); setStream(''); } }
    finally { setSending(false); }
  }
  return <main className="chat-page">
    <img className="chat-background" src={character.image} alt="" /><div className="chat-scrim" />
    <header className="chat-header"><button className="icon-button" aria-label="Return to drama" onClick={onBack}><Icon name="back" size={22} /></button><div className="chat-title"><img src={character.image} alt="" /><h1>{character.name}</h1></div>
      <button className="chat-context" onClick={onBack} aria-label="Continue watching"><Icon name="play" size={14} /><span>{data.catalog.episodes.find(e => e.id === data.watch.episodeId)?.title}</span></button>
    </header>
    {data.catalog.characters.length > 1 && <select aria-label="Choose a character" value={characterId} disabled={sending} onChange={e => setCharacterId(e.target.value)}>{data.catalog.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
    <div className={`chat-scroll ${messages.length || pendingText ? 'has-messages' : ''}`} role="log" aria-label="Chat messages" aria-live="polite"><div className="chat-messages">
      {loading && <p className="muted centered" role="status">Loading your conversation…</p>}
      {!loading && !messages.length && !pendingText && <div className="empty-chat"><p>{context?.facts.length ? 'Ask about the moment you just watched.' : 'Watch a little of the story, then talk about it together.'}</p></div>}
      {messages.map(m => <div className={`message ${m.role}`} key={m.id}>{m.role === 'assistant' && <img src={character.image} alt="" />}<p>{m.text}</p></div>)}
      {pendingText && <div className="message user"><p>{pendingText}</p></div>}
      {sending && <div className="message assistant"><img src={character.image} alt="" /><p>{stream || <span className="typing" aria-label="Preparing reply">•••</span>}</p></div>}
      <div ref={end} /></div>
    </div>
    <footer className="chat-footer">{error && <div className="error" role="alert">{error}<button onClick={() => void send()} disabled={sending}>Retry</button></div>}
      <p className="mode-notice">{data.chatProvider === 'mock' ? 'Mock replies · Local conversation preview' : 'AI character · Replies may be inaccurate'}</p>
      {!loading && !messages.length && !pendingText && <div className="suggestions">{['What just happened?', 'Can we talk about this moment?'].map(s => <button key={s} disabled={sending} onClick={() => void send(s)}>{s}</button>)}</div>}
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}><div className="input-shell"><textarea ref={input} aria-label={`Message ${character.name.split(' ')[0]}`} placeholder="Send a message…" maxLength={2000} rows={1} value={text} disabled={sending || loading} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /></div><button type="submit" className="send-button" aria-label="Send message" disabled={!text.trim() || sending || loading}><Icon name="send" size={18} /></button></form>
    </footer>
  </main>;
}
