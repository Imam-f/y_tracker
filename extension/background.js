const ADDRESS = 'ws://127.0.0.1:17349';
let socket;
let sourceId;
let retryTimer;
let syncTimer;
let retryDelay = 2500;
let pendingWatched = new Set();

const ready = chrome.storage.local.get(['sourceId', 'pendingWatched']).then(async ({ sourceId: saved, pendingWatched: pending }) => {
  sourceId = saved || crypto.randomUUID();
  pendingWatched = new Set(Array.isArray(pending) ? pending : []);
  if (!saved) await chrome.storage.local.set({ sourceId });
});

function browserName() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('OPR/')) return 'Opera';
  if (ua.includes('Vivaldi/')) return 'Vivaldi';
  return 'Chrome / Chromium';
}

function isYouTube(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch { return false; }
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function syncTabs() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const tabs = await chrome.tabs.query({}); // All windows, including other virtual desktops.
  send({
    type: 'snapshot',
    tabs: tabs.filter((tab) => isYouTube(tab.url)).map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title,
      url: tab.url,
      active: tab.active
    }))
  });
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncTabs, 150);
}

async function connect() {
  await ready;
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  clearTimeout(retryTimer);
  let nextSocket;
  try {
    nextSocket = new WebSocket(ADDRESS);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = nextSocket;
  nextSocket.onopen = () => {
    if (socket !== nextSocket) return;
    retryDelay = 2500;
    send({ type: 'hello', id: sourceId, name: browserName() });
    for (const videoId of pendingWatched) send({ type: 'watched', videoId });
    pendingWatched.clear();
    chrome.storage.local.remove('pendingWatched');
    syncTabs();
  };
  nextSocket.onmessage = async ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'focus' && Number.isInteger(message.tabId)) {
      try {
        const tab = await chrome.tabs.get(message.tabId);
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch { syncTabs(); }
    }
  };
  nextSocket.onclose = () => {
    if (socket !== nextSocket) return;
    socket = undefined;
    scheduleReconnect();
  };
  nextSocket.onerror = () => {
    // Connection failures are reported asynchronously by the browser.
    // Closing here lets onclose own cleanup and retry scheduling.
    if (nextSocket.readyState === WebSocket.CONNECTING || nextSocket.readyState === WebSocket.OPEN) {
      nextSocket.close();
    }
  };
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60000);
}

chrome.tabs.onCreated.addListener(scheduleSync);
chrome.tabs.onRemoved.addListener(scheduleSync);
chrome.tabs.onUpdated.addListener(scheduleSync);
chrome.tabs.onAttached.addListener(scheduleSync);
chrome.tabs.onDetached.addListener(scheduleSync);
chrome.tabs.onActivated.addListener(scheduleSync);
chrome.windows.onCreated.addListener(scheduleSync);
chrome.windows.onRemoved.addListener(scheduleSync);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'duration' && /^[\w-]{11}$/.test(message.videoId || '') && Number.isFinite(message.duration) && message.duration > 0) {
    ready.then(() => send({ type: 'duration', videoId: message.videoId, duration: message.duration }));
  }
  if (message?.type === 'watched' && /^[\w-]{11}$/.test(message.videoId || '')) {
    ready.then(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        send({ type: 'watched', videoId: message.videoId });
      } else {
        pendingWatched.add(message.videoId);
        chrome.storage.local.set({ pendingWatched: [...pendingWatched] });
        connect();
      }
    });
  }
});

// Regular traffic keeps the MV3 worker alive while the desktop app is open.
setInterval(() => send({ type: 'ping' }), 20000);
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  connect();
  syncTabs();
});
connect();
