import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from 'node:http';
import { createConnectorServer, attachNetworkConnector, cleanTabs, isLoopback } from '../electron/connector.js';
import { createOrganization, reconcileTabs, createFolder, moveTab } from '../electron/organization.js';
import { publicSnapshot } from '../electron/webhook.js';

async function connect(url, hello) {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  const reply = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  const [bytes] = await reply;
  assert.equal(JSON.parse(bytes).type, 'connected');
  return socket;
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Connector did not reach the expected state');
}

test('multiple browser profiles keep duplicate tab IDs isolated and restore placements on reconnect', async (t) => {
  const sources = new Map();
  const organization = createOrganization();
  const watched = [];
  const durations = [];
  const server = createConnectorServer({
    host: '127.0.0.1', port: 0, sources, getDeviceName: () => 'Desktop', onChange: () => {},
    onSnapshot: (source, tabs) => { source.tabs = reconcileTabs(organization, source.id, tabs).tabs; },
    onWatched: (id) => watched.push(id), onDuration: (id, duration) => durations.push([id, duration])
  });
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `ws://127.0.0.1:${server.address().port}`;
  const chrome = await connect(url, { id: 'chrome-profile', name: 'Chrome', profileName: 'Personal' });
  const edge = await connect(url, { id: 'edge-profile', name: 'Microsoft Edge', deviceName: 'Office', profileName: 'Work' });
  const tab = { id: 1, windowId: 2, title: 'A video', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', active: true };
  chrome.send(JSON.stringify({ type: 'snapshot', tabs: [tab] }));
  edge.send(JSON.stringify({ type: 'snapshot', tabs: [tab] }));
  await waitFor(() => [...sources.values()].every((source) => source.tabs.length === 1));
  const chromeSlot = sources.get('chrome-profile').tabs[0].slotId;
  const edgeSlot = sources.get('edge-profile').tabs[0].slotId;
  assert.notEqual(chromeSlot, edgeSlot);
  const folder = createFolder(organization, 'Later');
  moveTab(organization, edgeSlot, folder.id);
  const snapshot = publicSnapshot({ sources, metadata: {}, organization });
  assert.equal(snapshot.tabs.find((item) => item.sourceId === 'edge-profile').sourceLabel, 'Office · Work');
  assert.equal(snapshot.sources.find((item) => item.id === 'chrome-profile').deviceName, 'Desktop');
  assert.equal(snapshot.sources[0].remote, false);

  const focus = once(edge, 'message');
  sources.get('edge-profile').socket.send(JSON.stringify({ type: 'focus', tabId: 1 }));
  assert.deepEqual(JSON.parse((await focus)[0]), { type: 'focus', tabId: 1 });

  const restored = await connect(url, { id: 'edge-profile', name: 'Microsoft Edge' });
  restored.send('null');
  restored.send(JSON.stringify({ type: 'snapshot', tabs: [{ ...tab, id: 50 }] }));
  await waitFor(() => sources.get('edge-profile')?.tabs[0]?.id === 50);
  assert.equal(sources.get('edge-profile').tabs[0].slotId, edgeSlot);
  assert.deepEqual(organization.order[folder.id], [edgeSlot]);
  assert.equal(sources.get('chrome-profile').tabs[0].slotId, chromeSlot);
  restored.send(JSON.stringify({ type: 'watched', videoId: 'dQw4w9WgXcQ' }));
  restored.send(JSON.stringify({ type: 'duration', videoId: 'dQw4w9WgXcQ', duration: 300 }));
  await waitFor(() => watched.length && durations.length);
  assert.deepEqual(durations, [['dQw4w9WgXcQ', 300]]);
  const closed = once(restored, 'close');
  restored.close();
  await closed;
  await waitFor(() => !sources.has('edge-profile'));
  assert.equal(sources.size, 1);
});

test('network connector requires a valid token and rejects sessions after token rotation', async (t) => {
  const sources = new Map();
  let token = 'a'.repeat(64);
  const http = createServer((_req, res) => res.end('ok'));
  const server = attachNetworkConnector(http, {
    sources, getToken: () => token, getDeviceName: () => 'Desktop', onChange: () => {},
    onSnapshot: (source, tabs) => { source.tabs = tabs; }, onWatched: () => {}, onDuration: () => {}
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    server.close();
    await new Promise((resolve) => http.close(resolve));
  });
  const url = `ws://127.0.0.1:${http.address().port}/connector`;
  for (const supplied of [undefined, 'wrong']) {
    const denied = new WebSocket(url);
    await once(denied, 'open');
    const close = once(denied, 'close');
    denied.send(JSON.stringify({ type: 'hello', id: 'denied', token: supplied }));
    assert.equal((await close)[0], 1008);
    assert.equal(sources.size, 0);
  }
  const allowed = await connect(url, { id: 'allowed', name: 'Brave', token });
  assert.equal(sources.size, 1);
  token = 'b'.repeat(64);
  const close = once(allowed, 'close');
  allowed.send(JSON.stringify({ type: 'ping' }));
  assert.equal((await close)[0], 1008);
  await waitFor(() => sources.size === 0);
  const refreshed = await connect(url, { id: 'allowed', name: 'Brave', token });
  assert.equal(sources.get('allowed').name, 'Brave');
  refreshed.close();
});

test('source classification uses the peer address and snapshots accept only unique YouTube tabs', () => {
  for (const address of ['127.0.0.1', '127.0.1.2', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(address), true);
  for (const address of ['192.168.1.10', '::ffff:192.168.1.10', '2001:db8::1']) assert.equal(isLoopback(address), false);
  const tab = { id: 1, windowId: 2, url: 'https://youtu.be/dQw4w9WgXcQ' };
  assert.equal(cleanTabs([tab, tab, null, { ...tab, id: 3, url: 'https://youtube.com.evil.example/' },
    { ...tab, id: 4, url: 'javascript://youtube.com/foo' }, { ...tab, id: -1 }]).length, 1);
});
