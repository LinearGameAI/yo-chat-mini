import { flowLog, flowError } from '../../shared/flow-log';
import { randomUUID } from '../../shared/uuid';
import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, Message, StoryContext } from '../../shared/types';
import { api } from '../lib/api';
import { isLoggedIn, loadConversation, loginWithTikTok, LoginRequired, logoutFromPlatform, sendReply } from '../lib/yoroll';
import { Icon } from './Icon';

export function Chat({ data, initialCharacter, onBack, onPlay }: { data: Bootstrap; initialCharacter?: string; onBack(): void; onPlay(): void }) {
  const [characterId, setCharacterId] = useState(data.catalog.characters.some(c => c.id === initialCharacter) ? initialCharacter! : data.catalog.characters[0].id);
  const character = data.catalog.characters.find(c => c.id === characterId)!;
  const [messages, setMessages] = useState<Message[]>([]); const [context, setContext] = useState<StoryContext>();
  const [text, setText] = useState(''); const [stream, setStream] = useState(''); const [pendingText, setPendingText] = useState('');
  const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [error, setError] = useState('');
  const [loggedIn, setLoggedIn] = useState(isLoggedIn); const [revision, setRevision] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const end = useRef<HTMLDivElement>(null); const request = useRef<AbortController | null>(null); const retry = useRef<{ text: string; id: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(loggedIn); setLoadFailed(false); setError(''); setMessages([]); retry.current = null;
    flowLog('Chat initialization started', { loggedIn, characterId, dramaId: data.catalog.id });
    if (loggedIn) void Promise.all([
      loadConversation(data.catalog.id, characterId, controller.signal),
      api<StoryContext>(`/context/${characterId}`, undefined, controller.signal),
    ]).then(([messages, context]) => { if (!controller.signal.aborted) { flowLog('Chat initialization completed', { messageCount: messages.length, factCount: context.facts.length }); setMessages(messages); setContext(context); setLoading(false); } }).catch(e => { if (!controller.signal.aborted) { flowError('Chat initialization failed', e); setError(e.message); setLoadFailed(true); setLoading(false); if (e instanceof LoginRequired) setLoggedIn(false); } });
    return () => { flowLog('Chat initialization cleanup: aborting active requests'); controller.abort(); request.current?.abort(); };
  }, [characterId, loggedIn, revision, data.catalog.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'instant', block: 'end' }); }, [messages, stream, pendingText]);
  useEffect(() => { if (input.current) { input.current.style.height = '44px'; input.current.style.height = `${Math.min(120, Math.max(44, input.current.scrollHeight))}px`; } }, [text]);
  async function send(value = text) {
    const content = value.trim(); if (!content || sending || loading || loadFailed || !loggedIn) return;
    flowLog('Chat send submitted', { characterId, retry: retry.current?.text === content });
    setError(''); setSending(true); setText(''); setPendingText(content); setStream('');
    const id = retry.current?.text === content ? retry.current.id : randomUUID(); retry.current = { text: content, id };
    const controller = new AbortController(); request.current = controller;
    try {
      await sendReply(data.catalog.id, characterId, content, id, setStream, controller.signal);
      const messages = await loadConversation(data.catalog.id, characterId, controller.signal);
      if (controller.signal.aborted) return;
      flowLog('Chat send completed and history reloaded', { messageCount: messages.length });
      setMessages(messages);
      setPendingText(''); setStream(''); retry.current = null;
    } catch (e) { flowError('Chat send failed', e, { aborted: controller.signal.aborted }); if (!controller.signal.aborted) { setError((e as Error).message); setText(content); setPendingText(''); setStream(''); if (e instanceof LoginRequired) setLoggedIn(false); } }
    finally { setSending(false); }
  }
  async function signIn() {
    const started = Date.now();
    flowLog('Chat sign-in submitted');
    setSigningIn(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try { await loginWithTikTok(controller.signal); if (!controller.signal.aborted) { flowLog('Chat sign-in completed', { elapsedMs: Date.now() - started }); setLoggedIn(true); } }
    catch (e) { flowError('Chat sign-in failed', e, { aborted: controller.signal.aborted, elapsedMs: Date.now() - started }); if (!controller.signal.aborted) { setError((e as Error).message); } }
    finally { setSigningIn(false); }
  }
  return <main className="chat-page">
    <img className="chat-background" src={character.image} alt="" /><div className="chat-scrim" />
    <header className="chat-header"><button className="icon-button" aria-label="Return to drama detail" onClick={onBack}><Icon name="back" size={22} /></button><div className="chat-title"><img src={character.image} alt="" /><h1>{character.name}</h1></div>
      <button className="chat-context" onClick={onPlay} aria-label="Continue watching"><Icon name="play" size={14} /><span>{data.catalog.episodes.find(e => e.id === data.watch.episodeId)?.title}</span></button>
    </header>
    {data.catalog.characters.length > 1 && <select aria-label="Choose a character" value={characterId} disabled={sending} onChange={e => setCharacterId(e.target.value)}>{data.catalog.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
    {!loggedIn && <form className="chat-login" onSubmit={e => { e.preventDefault(); void signIn(); }}>
      <h2>Continue with TikTok</h2><p>Use your TikTok account to chat with this character.</p>
      <button className="primary" type="submit" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Continue with TikTok'}</button>
    </form>}
    <div className={`chat-scroll ${messages.length || pendingText ? 'has-messages' : ''}`} role="log" aria-label="Chat messages" aria-live="polite"><div className="chat-messages">
      {loading && <p className="muted centered" role="status">Loading your conversation…</p>}
      {loggedIn && !loading && !messages.length && !pendingText && <div className="empty-chat"><p>{context?.facts.length ? 'Ask about the moment you just watched.' : 'Watch a little of the story, then talk about it together.'}</p></div>}
      {messages.map(m => <div className={`message ${m.role}`} key={m.id}>{m.role === 'assistant' && <img src={character.image} alt="" />}<p>{m.text}</p></div>)}
      {pendingText && <div className="message user"><p>{pendingText}</p></div>}
      {sending && <div className="message assistant"><img src={character.image} alt="" /><p>{stream || <span className="typing" aria-label="Preparing reply">•••</span>}</p></div>}
      <div ref={end} /></div>
    </div>
    <footer className="chat-footer">{error && <div className="error" role="alert">{error}{loggedIn && <button onClick={() => loadFailed ? setRevision(n => n + 1) : void send()} disabled={sending}>Retry</button>}</div>}
      {loggedIn && <button className="chat-signout" disabled={sending} onClick={() => { void logoutFromPlatform().catch(e => setError(e.message)); setLoggedIn(false); setMessages([]); setText(''); }}>Sign out</button>}
      <p className="mode-notice">{data.chatProvider === 'mock' ? 'Mock replies · Local conversation preview' : 'AI character · Replies may be inaccurate'}</p>
      {loggedIn && !loadFailed && !loading && !messages.length && !pendingText && <div className="suggestions">{['What just happened?', 'Can we talk about this moment?'].map(s => <button key={s} disabled={sending} onClick={() => void send(s)}>{s}</button>)}</div>}
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}><div className="input-shell"><textarea ref={input} aria-label={`Message ${character.name.split(' ')[0]}`} placeholder="Send a message…" maxLength={2000} rows={1} value={text} disabled={!loggedIn || loadFailed || sending || loading} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /></div><button type="submit" className="send-button" aria-label="Send message" disabled={!loggedIn || loadFailed || !text.trim() || sending || loading}><Icon name="send" size={18} /></button></form>
    </footer>
  </main>;
}
