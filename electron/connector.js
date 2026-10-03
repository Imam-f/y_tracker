import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

function validToken(supplied, expected) {
  if (typeof supplied !== 'string' || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isLoopback(address = '') {
  return address === '::1' || /^(?:::ffff:)?127\./.test(address);
}

export function cleanTabs(tabs) {
  const seen = new Set();
  return tabs.slice(0, 2000).filter((tab) => {
    if (!tab || !Number.isInteger(tab.id) || tab.id < 0 || !Number.isInteger(tab.windowId) ||
      typeof tab.url !== 'string' || tab.url.length > 2048 || seen.has(tab.id)) return false;
    try {
      const { protocol, hostname } = new URL(tab.url);
      if (!['http:', 'https:'].includes(protocol) ||
        !(hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be')) return false;
    } catch { return false; }
    seen.add(tab.id);
    return true;
  }).map((tab) => ({
    id: tab.id, windowId: tab.windowId, url: tab.url,
    title: String(tab.title || 'YouTube').slice(0, 300), active: Boolean(tab.active)
  }));
}

// Both the legacy local connector and authenticated network connector share this protocol.
export function createConnectorServer({ sources, getDeviceName, getToken, onChange, onSnapshot, onWatched, onDuration, ...options }) {
  const server = new WebSocketServer({ ...options, maxPayload: 8 * 1024 * 1024 });
  server.on('connection', (socket, request) => {
    let sourceId;
    let token;
    const handshakeTimer = setTimeout(() => socket.close(1008, 'Connector hello required'), 5000);
    socket.on('message', (bytes) => {
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;

      if (getToken && !validToken(sourceId ? token : message.token, getToken())) {
        socket.close(1008, 'Invalid access token');
        return;
      }
      if (!sourceId) {
        if (message.type !== 'hello' || typeof message.id !== 'string' || !message.id.trim() || message.id.length > 100) return;
        clearTimeout(handshakeTimer);
        sourceId = message.id;
        token = message.token;
        const remote = !isLoopback(request.socket.remoteAddress);
        const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;
        const existing = sources.get(sourceId);
        if (existing && existing.socket !== socket) existing.socket.close();
        sources.set(sourceId, {
          id: sourceId, name: text(message.name, 'Browser'),
          deviceName: text(message.deviceName, remote ? 'Remote device' : getDeviceName()),
          profileName: text(message.profileName, ''), remote, tabs: [], socket
        });
        socket.send(JSON.stringify({ type: 'connected', sourceId }));
        onChange();
        return;
      }
      const source = sources.get(sourceId);
      if (source?.socket !== socket) return;
      if (message.type === 'snapshot' && Array.isArray(message.tabs)) onSnapshot(source, cleanTabs(message.tabs));
      if (message.type === 'watched' && typeof message.videoId === 'string' && /^[\w-]{11}$/.test(message.videoId)) onWatched(message.videoId);
      if (message.type === 'duration' && typeof message.videoId === 'string' && /^[\w-]{11}$/.test(message.videoId) &&
        Number.isFinite(message.duration) && message.duration > 0 && message.duration <= 86400) onDuration(message.videoId, message.duration);
    });
    socket.on('close', () => {
      clearTimeout(handshakeTimer);
      if (sourceId && sources.get(sourceId)?.socket === socket) {
        sources.delete(sourceId);
        onChange();
      }
    });
    socket.on('error', () => {});
  });
  return server;
}

export function attachNetworkConnector(httpServer, options) {
  const server = createConnectorServer({ ...options, noServer: true });
  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname !== '/connector') { socket.destroy(); return; }
    server.handleUpgrade(request, socket, head, (webSocket) => server.emit('connection', webSocket, request));
  });
  return server;
}
