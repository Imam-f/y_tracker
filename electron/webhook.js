import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { makeCsv } from './export.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function videoId(url) {
  try {
    const parsed = new URL(url);
    const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0]
      : parsed.pathname === '/watch' ? parsed.searchParams.get('v')
      : parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

export function metadataKey(url) {
  const id = videoId(url);
  if (id) return `video:${id}`;
  try {
    const parsed = new URL(url);
    return `page:${parsed.hostname}${parsed.pathname}${parsed.search}`.slice(0, 220);
  } catch { return `page:${url}`.slice(0, 220); }
}

export function publicSnapshot({ sources, metadata, organization }) {
  const connected = Array.from(sources.values());
  const tabBySlot = new Map();
  for (const source of connected) {
    for (const tab of source.tabs) {
      const key = metadataKey(tab.url);
      const meta = metadata[key] || {};
      tabBySlot.set(tab.slotId, {
        slotId: tab.slotId,
        sourceId: source.id,
        tabId: tab.id,
        windowId: tab.windowId,
        browser: source.name,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        videoId: videoId(tab.url),
        metadataKey: key,
        watched: Boolean(meta.watched),
        priority: Boolean(meta.priority),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        durationSeconds: Number.isFinite(meta.duration) ? meta.duration : null
      });
    }
  }
  const placed = new Set();
  const folders = [...organization.folders, { id: 'unfiled', name: 'Unfiled' }].map((folder) => {
    const tabs = (organization.order[folder.id] || []).map((id) => tabBySlot.get(id))
      .filter((tab) => tab && !placed.has(tab.slotId));
    tabs.forEach((tab) => placed.add(tab.slotId));
    if (folder.id === 'unfiled') {
      for (const tab of tabBySlot.values()) if (!placed.has(tab.slotId)) tabs.push(tab);
    }
    return { id: folder.id, name: folder.name, tabs };
  });
  const tabs = folders.flatMap((folder) => folder.tabs.map((tab, index) => ({
    ...tab, folderId: folder.id, folderName: folder.name, position: index + 1
  })));
  return {
    sources: connected.map((source) => ({ id: source.id, name: source.name, tabCount: source.tabs.length })),
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name, tabCount: folder.tabs.length })),
    tabs,
    totals: { tabs: tabs.length, folders: organization.folders.length, sources: connected.length }
  };
}

function authorized(request, token) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function response(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readJson(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Use Content-Type: application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new ApiError(413, 'body_too_large', 'Request body must be at most 64 KiB.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Invalid JSON. */ }
  throw new ApiError(400, 'invalid_json', 'Expected a JSON object.');
}

const actions = new Set(['focus_tab', 'set_metadata', 'create_folder', 'rename_folder', 'delete_folder', 'move_folder', 'move_tab', 'show_view']);

function validateCommand(command) {
  if (!actions.has(command.action)) throw new ApiError(400, 'invalid_action', 'Unknown or missing action.');
  const text = (value, field) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 220) throw new ApiError(400, 'invalid_field', `${field} must be a nonempty string (max 220 characters).`);
  };
  const optionalId = (value, field) => { if (value !== undefined && value !== null) text(value, field); };
  switch (command.action) {
    case 'focus_tab':
      text(command.sourceId, 'sourceId');
      if (!Number.isInteger(command.tabId) || command.tabId < 0) throw new ApiError(400, 'invalid_field', 'tabId must be a nonnegative integer.');
      break;
    case 'set_metadata': {
      text(command.slotId, 'slotId');
      const fields = ['watched', 'priority', 'tags'].filter((key) => Object.hasOwn(command, key));
      if (!fields.length || (Object.hasOwn(command, 'watched') && typeof command.watched !== 'boolean') ||
        (Object.hasOwn(command, 'priority') && typeof command.priority !== 'boolean') ||
        (Object.hasOwn(command, 'tags') && (!Array.isArray(command.tags) || command.tags.length > 12 ||
          command.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 32)))) {
        throw new ApiError(400, 'invalid_field', 'Provide watched and/or priority as booleans, or tags as an array of up to 12 nonempty strings (max 32 characters each).');
      }
      break;
    }
    case 'create_folder': case 'rename_folder':
      if (command.action === 'rename_folder') text(command.folderId, 'folderId');
      text(command.name, 'name');
      if (command.name.trim().length > 48) throw new ApiError(400, 'invalid_field', 'name must be at most 48 characters.');
      break;
    case 'delete_folder': text(command.folderId, 'folderId'); break;
    case 'move_folder':
      text(command.folderId, 'folderId'); optionalId(command.beforeFolderId, 'beforeFolderId'); break;
    case 'move_tab':
      text(command.slotId, 'slotId'); text(command.folderId, 'folderId'); optionalId(command.beforeSlotId, 'beforeSlotId'); break;
    case 'show_view':
      if (!['all', 'folders', 'unwatched', 'watched', 'priority', 'tag'].includes(command.view)) throw new ApiError(400, 'invalid_field', 'view must be all, folders, unwatched, watched, priority, or tag.');
      if (command.view === 'tag') text(command.tag, 'tag');
      break;
  }
  return command;
}

function csvFromSnapshot(snapshot) {
  const duration = (seconds) => {
    if (seconds === null) return 'Duration unavailable';
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  };
  return makeCsv(snapshot.tabs.map((tab) => ({
    Folder: tab.folderName, Position: tab.position, Title: tab.title.replace(/\s*[-–|]\s*YouTube\s*$/, '').trim() || 'YouTube',
    URL: tab.url, Browser: tab.browser, Duration: duration(tab.durationSeconds),
    Watched: tab.watched ? 'Yes' : 'No', 'High priority': tab.priority ? 'Yes' : 'No', Tags: tab.tags.join('; ')
  })));
}

export function createWebhookServer({ getToken, getSnapshot, execute }) {
  return createServer(async (request, res) => {
    try {
      if (!authorized(request, getToken())) throw new ApiError(401, 'unauthorized', 'A valid Bearer token is required.');
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/api/v1/health') {
        return response(res, 200, { ok: true, data: { status: 'ok', version: 1 } });
      }
      if (request.method === 'GET' && pathname === '/api/v1/state') return response(res, 200, { ok: true, data: getSnapshot() });
      if (request.method === 'GET' && pathname === '/api/v1/tabs') return response(res, 200, { ok: true, data: { tabs: getSnapshot().tabs } });
      if (request.method === 'GET' && pathname === '/api/v1/folders') return response(res, 200, { ok: true, data: { folders: getSnapshot().folders } });
      if (request.method === 'GET' && pathname === '/api/v1/export.csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="youtube-tabs.csv"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        return res.end(csvFromSnapshot(getSnapshot()));
      }
      if (pathname === '/webhook' && request.method === 'POST') {
        const command = validateCommand(await readJson(request));
        return response(res, 200, { ok: true, data: await execute(command) });
      }
      if (['/webhook', '/api/v1/health', '/api/v1/state', '/api/v1/tabs', '/api/v1/folders', '/api/v1/export.csv'].includes(pathname)) {
        res.setHeader('Allow', pathname === '/webhook' ? 'POST' : 'GET');
        throw new ApiError(405, 'method_not_allowed', 'HTTP method not allowed for this path.');
      }
      throw new ApiError(404, 'not_found', 'Unknown endpoint.');
    } catch (error) {
      if (!res.headersSent) response(res, error instanceof ApiError ? error.status : 500, {
        ok: false, error: { code: error instanceof ApiError ? error.code : 'internal_error', message: error instanceof ApiError ? error.message : 'Unexpected server error.' }
      });
    }
  });
}
