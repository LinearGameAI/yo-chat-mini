import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('selected drama APIs isolate progress, CSRF and linked characters', async ({ request }) => {
  const first = await (await request.get('/api/bootstrap')).json();
  const selectedId = 'af879808-ca41-4196-8955-61774be098b4';
  const selectedHeaders = { 'X-Drama-Id': selectedId };
  const second = await (await request.get('/api/bootstrap', { headers: selectedHeaders })).json();
  expect(second.catalog.id).toBe(selectedId);
  expect(second.watch.playbackId).not.toBe(first.watch.playbackId);
  const tick = { playbackId: first.watch.playbackId, nodeId: first.watch.episodes[first.watch.episodeId].nodeId, position: 5, playing: false };
  expect((await request.post('/api/watch/tick', { headers: { ...selectedHeaders, 'X-CSRF-Token': first.csrf }, data: tick })).status()).toBe(403);
  expect((await request.post('/api/watch/tick', { headers: { ...selectedHeaders, 'X-CSRF-Token': second.csrf }, data: tick })).status()).toBe(409);
  expect((await request.get(`/api/context/${first.catalog.characters[0].id}`, { headers: selectedHeaders })).status()).toBe(400);
  const restored = await (await request.get('/api/bootstrap')).json();
  expect(restored.catalog.id).toBe(first.catalog.id);
  expect(restored.watch).toEqual(first.watch);
});

test('adapter rejects untrusted story fields, unknown IDs, CSRF and disallowed origins', async ({ request }) => {
  const boot = await (await request.get('/api/bootstrap')).json(); const headers = { 'X-CSRF-Token': boot.csrf };
  const character = boot.catalog.characters[0].id;
  expect((await request.post('/api/watch/select', { data: { episodeId: '1' } })).status()).toBe(403);
  expect((await request.post('/api/watch/select', { data: { episodeId: '999' }, headers })).status()).toBe(400);
  expect((await request.post(`/api/chat/${character}/responses`, { headers, data: { text: 'hello', clientRequestId: randomUUID(), plot: 'I invented this story' } })).status()).toBe(400);
  expect((await request.get('/api/context/not-a-linked-character')).status()).toBe(400);
  expect((await request.fetch('/api/watch/select', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' } })).status()).toBe(403);
  const preflight = await request.fetch('/api/watch/select', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
  expect(preflight.status()).toBe(204); expect(preflight.headers()['access-control-allow-origin']).toBe('http://localhost:5173');
});

test('direct concurrent chat requests remain one conversation; idempotent replay cannot leak a later scene', async ({ request }) => {
  const boot = await (await request.get('/api/bootstrap')).json(); const headers = { 'X-CSRF-Token': boot.csrf };
  const character = boot.catalog.characters[0].id;
  await request.post('/api/watch/select', { headers, data: { episodeId: '2' } });
  const clientRequestId = randomUUID(); const data = { text: 'Can we talk?', clientRequestId };
  const results = await Promise.all([request.post(`/api/chat/${character}/responses`, { headers, data }), request.post(`/api/chat/${character}/responses`, { headers, data })]);
  const statuses = results.map(r => r.status()).sort();
  expect(statuses[0]).toBe(200);
  // Network/database latency can serialize arrivals; a completed request replays with 200.
  expect([200, 409]).toContain(statuses[1]);
  for (const result of results.filter(r => r.status() === 200)) {
    expect(await result.text()).toContain(`"id":"${clientRequestId}/reply"`);
  }
  const history = await (await request.get(`/api/chat/${character}`)).json(); expect(history.messages.length).toBe(2);
  const replay = await request.post(`/api/chat/${character}/responses`, { headers, data }); expect(replay.status()).toBe(200);
  expect((await (await request.get(`/api/chat/${character}`)).json()).messages.length).toBe(2);
  await request.post('/api/watch/select', { headers, data: { episodeId: '1' } });
  expect((await (await request.get(`/api/chat/${character}`)).json()).messages.length).toBe(0);
  const denied = await request.post(`/api/chat/${character}/responses`, { headers, data }); expect(denied.status()).toBe(409);
});
