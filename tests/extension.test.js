import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const settingsScript = fs.readFileSync(new URL('../extension/settings.js', import.meta.url), 'utf8');
const workerScript = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

test('connector settings support local defaults and authenticated network addresses', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(settingsScript, context);
  const settings = context.TabDeskSettings;
  assert.equal(settings.normalize().address, 'ws://127.0.0.1:17349');
  const remote = settings.normalize({ address: 'http://192.168.1.5:17350', token: 'secret', deviceName: ' Laptop ' });
  assert.equal(remote.address, 'ws://192.168.1.5:17350/connector');
  assert.equal(remote.deviceName, 'Laptop');
  assert.equal(settings.normalize({ address: 'https://desk.example', token: 'secret' }).address, 'wss://desk.example/connector');
  assert.equal(settings.permissionOrigin(remote.address), 'http://192.168.1.5/*');
  assert.throws(() => settings.normalize({ address: 'ws://192.168.1.5:17350' }), /access token/);
  assert.throws(() => settings.normalize({ address: 'wss://desk.example/connector?token=secret', token: 'secret' }), /query/);
  assert.throws(() => settings.normalize({ address: 'ftp://desk.example', token: 'secret' }), /app address/);
});

test('worker sends configured source details, retains offline watch updates until authentication, and focuses the originating browser', async () => {
  const stored = {
    sourceId: 'profile', pendingWatched: ['dQw4w9WgXcQ'],
    connectorSettings: { address: 'ws://192.168.1.5:17350/connector', token: 'secret', deviceName: 'Laptop', profileName: 'Work', browserName: 'Brave' }
  };
  const sockets = [];
  const focusCalls = [];
  const listeners = {};
  const event = (name) => ({ addListener: (callback) => { listeners[name] = callback; } });
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    constructor(address) { this.address = address; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; }
  }
  const chrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])),
      set: async (value) => Object.assign(stored, value), remove: async (key) => { delete stored[key]; }
    }, onChanged: event('storage') },
    tabs: {
      query: async () => [{ id: 5, windowId: 6, url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }, { id: 7, windowId: 6, url: 'https://example.com' }],
      get: async (id) => ({ id, windowId: 6 }), update: async (id, options) => focusCalls.push(['tab', id, options])
    },
    windows: { update: async (id, options) => focusCalls.push(['window', id, options]) },
    runtime: { onMessage: event('message'), openOptionsPage: async () => {} },
    action: { onClicked: event('action') }, alarms: { create: () => {}, onAlarm: event('alarm') }
  };
  for (const name of ['onCreated', 'onRemoved', 'onUpdated', 'onAttached', 'onDetached', 'onActivated']) chrome.tabs[name] = event(name);
  chrome.windows.onCreated = event('windowCreated'); chrome.windows.onRemoved = event('windowRemoved');
  const context = vm.createContext({ chrome, URL, WebSocket: Socket, navigator: { userAgent: 'Chrome/1' },
    crypto: { randomUUID: () => 'new-profile' }, setInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
    importScripts: () => vm.runInContext(settingsScript, context) });
  vm.runInContext(workerScript, context);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  const socket = sockets[0];
  assert.equal(socket.address, stored.connectorSettings.address);
  socket.readyState = Socket.OPEN; socket.onopen();
  await flush();
  assert.deepEqual(socket.sent[0], { type: 'hello', id: 'profile', name: 'Brave', deviceName: 'Laptop', profileName: 'Work', token: 'secret' });
  assert.equal(socket.sent.find((message) => message.type === 'snapshot').tabs.length, 1);
  assert.deepEqual(stored.pendingWatched, ['dQw4w9WgXcQ']);
  listeners.message({ type: 'watched', videoId: 'abcdefghijk' });
  await flush();
  assert.equal(stored.pendingWatched.length, 2);
  await socket.onmessage({ data: JSON.stringify({ type: 'connected' }) });
  assert.equal(socket.sent.filter((message) => message.type === 'watched').length, 2);
  assert.equal(stored.pendingWatched, undefined);
  await socket.onmessage({ data: JSON.stringify({ type: 'focus', tabId: 5 }) });
  assert.equal(focusCalls[0][1], 5); assert.equal(focusCalls[1][1], 6);
  stored.connectorSettings = { address: 'ws://127.0.0.1:17349', deviceName: 'Desktop' };
  listeners.storage({ connectorSettings: { newValue: stored.connectorSettings } }, 'local');
  await flush();
  assert.equal(sockets[1].address, 'ws://127.0.0.1:17349');
  socket.onclose({ code: 1008 });
  assert.doesNotMatch(stored.connectionStatus, /rejected/);
});
