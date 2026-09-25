import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, Clock3,
  Copy, Download, Eye, EyeOff, Folder, FolderOpen, GripVertical, Hash,
  FolderPlus, LayoutGrid, ListFilter, Pencil, Play, Plus, Radio, RotateCw, Search, Star, Trash2, X
} from 'lucide-react';
import './styles.css';

const emptyOrganization = { folders: [], order: { unfiled: [] }, records: {} };
const emptyWebhook = { enabled: true, lan: false, port: 17350, running: false, error: '', localUrl: 'http://127.0.0.1:17350', lanUrls: [] };
const emptyState = { sources: [], metadata: {}, organization: emptyOrganization, webhook: emptyWebhook, serverError: '' };
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
const sampleState = {
  sources: [
    { id: 'chrome', name: 'Chrome / Chromium', tabs: [
      { id: 1, slotId: 'chrome:1', windowId: 12, title: 'How to actually learn anything | The science of learning - YouTube', url: 'https://www.youtube.com/watch?v=V6yiyFXmJ7s', active: false },
      { id: 2, slotId: 'chrome:2', windowId: 12, title: 'Building a second brain: a practical guide - YouTube', url: 'https://www.youtube.com/watch?v=OP3dA2GcAh8', active: true },
      { id: 3, slotId: 'chrome:3', windowId: 32, title: 'A quiet weekend in Tokyo | slow living - YouTube', url: 'https://www.youtube.com/watch?v=0nTO4zSEpOs', active: false },
      { id: 4, slotId: 'chrome:4', windowId: 32, title: 'YouTube', url: 'https://www.youtube.com/feed/subscriptions', active: false }
    ] },
    { id: 'edge', name: 'Microsoft Edge', tabs: [
      { id: 5, slotId: 'edge:5', windowId: 33, title: 'Make the most of your time | a better workflow - YouTube', url: 'https://www.youtube.com/watch?v=luQSQuCHtcI', active: false },
      { id: 6, slotId: 'edge:6', windowId: 33, title: 'The art of doing nothing - YouTube', url: 'https://www.youtube.com/watch?v=6n3pFFPSlW4', active: false }
    ] }
  ],
  metadata: {
    'video:V6yiyFXmJ7s': { priority: true, tags: ['Learning', 'Watch later'], duration: 742 },
    'video:OP3dA2GcAh8': { watched: true, tags: ['Learning'], duration: 1260 },
    'video:luQSQuCHtcI': { priority: true, tags: ['Work'], duration: 598 },
    'video:6n3pFFPSlW4': { watched: true, duration: 905 }
  },
  organization: {
    folders: [{ id: 'learning', name: 'Learning' }, { id: 'inspiration', name: 'Inspiration' }],
    order: { learning: ['chrome:2', 'chrome:1'], inspiration: ['chrome:3', 'edge:6'], unfiled: ['chrome:4', 'edge:5'] },
    records: Object.fromEntries(['chrome:1', 'chrome:2', 'chrome:3', 'chrome:4', 'edge:5', 'edge:6'].map((id) => [id, { sourceId: id.split(':')[0] }]))
  },
  webhook: { ...emptyWebhook, running: true },
  serverError: ''
};

const demoListeners = new Set();
function publishDemo() { demoListeners.forEach((callback) => callback({ ...sampleState, organization: structuredClone(sampleState.organization) })); }
const demoDesk = {
  getState: async () => sampleState,
  onState: (callback) => { demoListeners.add(callback); return () => demoListeners.delete(callback); },
  setMeta: async (key, patch) => {
    sampleState.metadata = { ...sampleState.metadata, [key]: { ...sampleState.metadata[key], ...patch } };
    publishDemo();
  },
  createFolder: async (name, parentId = null) => {
    if (!name.trim() || sampleState.organization.folders.some((folder) => (folder.parentId || null) === parentId && folder.name.toLowerCase() === name.trim().toLowerCase())) return false;
    const folder = { id: crypto.randomUUID(), name: name.trim(), parentId };
    sampleState.organization.folders.push(folder);
    sampleState.organization.order[folder.id] = [];
    publishDemo();
    return folder;
  },
  renameFolder: async (id, name) => {
    const folder = sampleState.organization.folders.find((item) => item.id === id);
    if (!folder || !name.trim()) return false;
    folder.name = name.trim(); publishDemo(); return true;
  },
  deleteFolder: async (id) => {
    sampleState.organization.order.unfiled.push(...sampleState.organization.order[id]);
    delete sampleState.organization.order[id];
    sampleState.organization.folders = sampleState.organization.folders.filter((folder) => folder.id !== id);
    publishDemo(); return true;
  },
  moveFolder: async (id, beforeId) => {
    const folders = sampleState.organization.folders;
    const index = folders.findIndex((folder) => folder.id === id);
    if (index < 0 || id === beforeId) return false;
    const [folder] = folders.splice(index, 1);
    const target = folders.findIndex((item) => item.id === beforeId);
    folders.splice(target < 0 ? folders.length : target, 0, folder);
    publishDemo(); return true;
  },
  moveTab: async (slotId, folderId, beforeId) => {
    const order = sampleState.organization.order;
    if (!order[folderId] || slotId === beforeId) return false;
    Object.values(order).forEach((ids) => { const index = ids.indexOf(slotId); if (index >= 0) ids.splice(index, 1); });
    const index = order[folderId].indexOf(beforeId);
    order[folderId].splice(index < 0 ? order[folderId].length : index, 0, slotId);
    publishDemo(); return true;
  },
  exportList: async (rows) => {
    const columns = ['Folder', 'Position', 'Title', 'URL', 'Browser', 'Duration', 'Watched', 'High priority', 'Tags'];
    const csv = [columns, ...rows.map((row) => columns.map((column) => row[column]))].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'youtube-tabs-demo.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return true;
  },
  focusTab: async () => true,
  getWebhookSecret: async () => 'example-development-token-keep-private-0123456789abcdef0123456789ab',
  setWebhookSettings: async (patch) => {
    sampleState.webhook = { ...sampleState.webhook, ...patch, running: patch.enabled ?? sampleState.webhook.enabled,
      localUrl: `http://127.0.0.1:${patch.port ?? sampleState.webhook.port}`,
      lanUrls: (patch.lan ?? sampleState.webhook.lan) ? [`http://192.168.1.42:${patch.port ?? sampleState.webhook.port}`] : [] };
    publishDemo();
    return sampleState.webhook;
  },
  rotateWebhookSecret: async () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
  copyText: async (text) => navigator.clipboard?.writeText(text),
  openApiDocs: async () => {},
  onNavigateView: () => () => {},
  openExtensionFolder: async () => ''
};
const desk = window.desk || (demo ? demoDesk : null);

function videoId(url) {
  try {
    const parsed = new URL(url);
    const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0]
      : parsed.pathname === '/watch' ? parsed.searchParams.get('v')
      : parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function tabKey(tab) {
  const id = videoId(tab.url);
  if (id) return `video:${id}`;
  try {
    const url = new URL(tab.url);
    return `page:${url.hostname}${url.pathname}${url.search}`.slice(0, 220);
  } catch { return `page:${tab.url}`.slice(0, 220); }
}

function cleanTitle(title) {
  return title.replace(/\s*[-–|]\s*YouTube\s*$/, '').trim() || 'YouTube';
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Duration unavailable';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatFolderWatchTime(items, metadata) {
  const known = items.reduce((total, tab) => total + (Number.isFinite(metadata[tab.key]?.duration) ? metadata[tab.key].duration : 0), 0);
  const unknown = items.filter((tab) => !Number.isFinite(metadata[tab.key]?.duration)).length;
  if (!known && unknown) return `${unknown} duration${unknown === 1 ? '' : 's'} unavailable`;
  return `${formatDuration(known)} watch time${unknown ? ` · ${unknown} unknown` : ''}`;
}

function getGroups(tabs, groupBy, metadata) {
  if (groupBy === 'status') return [
    { label: 'Unwatched', items: tabs.filter((tab) => !metadata[tab.key]?.watched) },
    { label: 'Watched', items: tabs.filter((tab) => metadata[tab.key]?.watched) }
  ].filter((group) => group.items.length);
  if (groupBy === 'priority') return [
    { label: 'High priority', items: tabs.filter((tab) => metadata[tab.key]?.priority) },
    { label: 'No priority', items: tabs.filter((tab) => !metadata[tab.key]?.priority) }
  ].filter((group) => group.items.length);
  if (groupBy === 'tags') {
    const tags = [...new Set(tabs.flatMap((tab) => metadata[tab.key]?.tags || []))].sort((a, b) => a.localeCompare(b));
    return [
      ...tags.map((tag) => ({ label: tag, items: tabs.filter((tab) => metadata[tab.key]?.tags?.includes(tag)) })),
      { label: 'Untagged', items: tabs.filter((tab) => !metadata[tab.key]?.tags?.length) }
    ].filter((group) => group.items.length);
  }
  return [{ label: 'All tabs', items: tabs }];
}

function getFolderSections(tabs, organization) {
  const lookup = new Map(tabs.map((tab) => [tab.slotId, tab]));
  const placed = new Set();
  const folders = new Map(organization.folders.map((folder) => [folder.id, folder]));
  function depth(folder) {
    let level = 0;
    let parentId = folder.parentId;
    const seen = new Set();
    while (parentId && folders.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId); level += 1; parentId = folders.get(parentId).parentId;
    }
    return level;
  }
  const sections = organization.folders.map((folder) => {
    const items = (organization.order[folder.id] || []).map((id) => lookup.get(id)).filter(Boolean);
    items.forEach((tab) => placed.add(tab.slotId));
    return { ...folder, depth: depth(folder), items };
  });
  const unfiled = (organization.order.unfiled || []).map((id) => lookup.get(id)).filter(Boolean);
  unfiled.forEach((tab) => placed.add(tab.slotId));
  sections.push({ id: 'unfiled', name: 'Unfiled', items: [...unfiled, ...tabs.filter((tab) => !placed.has(tab.slotId))] });
  return sections;
}

function App() {
  const [data, setData] = useState(demo ? sampleState : emptyState);
  const [view, setView] = useState({ type: 'all' });
  const [groupBy, setGroupBy] = useState('none');
  const [query, setQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showRemote, setShowRemote] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [collapsedFolderIds, setCollapsedFolderIds] = useState(() => new Set());

  useEffect(() => {
    if (!desk) return;
    const unsubscribe = desk.onState(setData);
    const unsubscribeNavigate = desk.onNavigateView?.((remoteView) => { setView(remoteView); setQuery(''); });
    desk.getState().then(setData);
    return () => { unsubscribe(); unsubscribeNavigate?.(); };
  }, []);

  const tabs = useMemo(() => {
    const windowNumbers = new Map();
    return data.sources.flatMap((source) => source.tabs.map((tab) => {
      const windowKey = `${source.id}:${tab.windowId}`;
      if (!windowNumbers.has(windowKey)) {
        const count = [...windowNumbers.keys()].filter((key) => key.startsWith(`${source.id}:`)).length;
        windowNumbers.set(windowKey, count + 1);
      }
      return { ...tab, slotId: tab.slotId || `${source.id}:${tab.id}`, sourceId: source.id, browser: source.name, windowNumber: windowNumbers.get(windowKey), key: tabKey(tab), video: videoId(tab.url) };
    }));
  }, [data.sources]);

  const counts = useMemo(() => ({
    all: tabs.length,
    unwatched: tabs.filter((tab) => !data.metadata[tab.key]?.watched).length,
    watched: tabs.filter((tab) => data.metadata[tab.key]?.watched).length,
    priority: tabs.filter((tab) => data.metadata[tab.key]?.priority).length
  }), [tabs, data.metadata]);

  const tags = useMemo(() => [...new Set(tabs.flatMap((tab) => data.metadata[tab.key]?.tags || []))].sort((a, b) => a.localeCompare(b)), [tabs, data.metadata]);

  const filtered = useMemo(() => tabs.filter((tab) => {
    const meta = data.metadata[tab.key] || {};
    if (view.type === 'watched' && !meta.watched) return false;
    if (view.type === 'unwatched' && meta.watched) return false;
    if (view.type === 'priority' && !meta.priority) return false;
    if (view.type === 'tag' && !meta.tags?.includes(view.value)) return false;
    const text = `${tab.title} ${tab.url} ${tab.browser} ${(meta.tags || []).join(' ')}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [tabs, data.metadata, view, query]);

  const groups = useMemo(() => getGroups(filtered, groupBy, data.metadata), [filtered, groupBy, data.metadata]);
  const organization = data.organization || emptyOrganization;
  const folderSections = useMemo(() => getFolderSections(tabs, organization), [tabs, organization]);
  const viewLabel = view.type === 'all' ? 'YouTube tabs' : view.type === 'folders' ? 'Folders' : view.type === 'tag' ? view.value :
    view.type === 'priority' ? 'High priority' : view.type === 'watched' ? 'Watched' : 'Unwatched';

  function update(key, patch) {
    desk?.setMeta(key, patch);
  }

  async function exportList() {
    setExporting(true);
    setExportError('');
    const rows = folderSections.flatMap((section) => section.items.map((tab, index) => {
      const meta = data.metadata[tab.key] || {};
      return {
        Folder: section.name, Position: index + 1, Title: cleanTitle(tab.title), URL: tab.url,
        Duration: formatDuration(meta.duration),
        Browser: tab.browser, Watched: meta.watched ? 'Yes' : 'No',
        'High priority': meta.priority ? 'Yes' : 'No', Tags: (meta.tags || []).join('; ')
      };
    }));
    try { await desk?.exportList(rows); } catch { setExportError('Could not export the list. Please try again.'); }
    setExporting(false);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Play size={16} fill="currentColor" strokeWidth={2.5} /></div><span>tabdesk<span className="brand-dot">.</span></span></div>
        <div className="sidebar-content">
          <div className="nav-label">LIBRARY</div>
          <nav className="nav-list" aria-label="Library">
            <NavItem icon={LayoutGrid} label="All tabs" count={counts.all} active={view.type === 'all'} onClick={() => setView({ type: 'all' })} />
            <NavItem icon={Folder} label="Folders" count={organization.folders.length} active={view.type === 'folders'} onClick={() => setView({ type: 'folders' })} />
            <NavItem icon={Clock3} label="Unwatched" count={counts.unwatched} active={view.type === 'unwatched'} onClick={() => setView({ type: 'unwatched' })} />
            <NavItem icon={CheckCheck} label="Watched" count={counts.watched} active={view.type === 'watched'} onClick={() => setView({ type: 'watched' })} />
            <NavItem icon={Star} label="High priority" count={counts.priority} active={view.type === 'priority'} onClick={() => setView({ type: 'priority' })} />
          </nav>
          <div className="tag-nav-header"><span className="nav-label">TAGS</span><span className="tag-total">{tags.length}</span></div>
          <nav className="nav-list tag-nav" aria-label="Tags">
            {tags.length ? tags.map((tag) => <NavItem key={tag} icon={Hash} label={tag} count={tabs.filter((tab) => data.metadata[tab.key]?.tags?.includes(tag)).length} active={view.type === 'tag' && view.value === tag} onClick={() => setView({ type: 'tag', value: tag })} />) : <p className="no-tags">Tags you add will show up here.</p>}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="connection"><span className={`status-dot ${data.sources.length ? 'online' : ''}`} /><div><strong>{data.sources.length ? `${data.sources.length} browser ${data.sources.length === 1 ? 'connection' : 'connections'}` : 'No browser connected'}</strong><small>{data.sources.length ? 'Tabs are syncing' : 'Set up the connector'}</small></div></div>
          <button className="help-link remote-link" onClick={() => setShowRemote(true)}><Radio size={15} /> Remote control <span className={`remote-mini-dot ${data.webhook?.running ? 'on' : ''}`} /></button>
          <button className="help-link" onClick={() => setShowHelp(true)}><CircleHelp size={15} /> Setup & help</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="page-header">
          <div><div className="eyebrow">YOUR WORKSPACE</div><div className="heading-line"><h1>{viewLabel}</h1><span className="heading-count">{view.type === 'folders' ? tabs.length : filtered.length}</span></div><p>{view.type === 'folders' ? 'Drag tabs into folders and arrange them in the order you want.' : 'Keep your YouTube tabs in one place, across every window and desktop.'}</p></div>
          <div className="header-actions"><button className="export-button" disabled={!tabs.length || exporting} onClick={exportList}><Download size={16} /> {exporting ? 'Exporting...' : 'Export CSV'}</button><button className="header-help" onClick={() => setShowHelp(true)} title="Setup & help" aria-label="Setup & help"><CircleHelp size={18} /></button></div>
        </header>

        {data.serverError && <div className="error-banner">{data.serverError}</div>}
        {exportError && <div className="error-banner">{exportError}</div>}

        {view.type === 'folders' ? <><FoldersView sections={folderSections} folders={organization.folders} metadata={data.metadata} update={update} desk={desk} collapsedIds={collapsedFolderIds} setCollapsedIds={setCollapsedFolderIds} /><footer className="page-footer">{tabs.length} open YouTube {tabs.length === 1 ? 'tab' : 'tabs'} · {organization.folders.length} {organization.folders.length === 1 ? 'folder' : 'folders'}</footer></> : tabs.length > 0 ? <>
          <div className="toolbar">
            <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, tags, links..." aria-label="Search tabs" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}</label>
            <div className="group-control"><ListFilter size={16} /><span>Group by</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} aria-label="Group by"><option value="none">None</option><option value="status">Watch status</option><option value="priority">Priority</option><option value="tags">Tags</option></select><ChevronDown size={14} className="select-chevron" /></div>
          </div>

          {filtered.length ? <div className="groups">{groups.map((group) => <section className="tab-group" key={group.label}><div className="group-heading"><h2>{group.label}</h2><span>{group.items.length}</span><div className="group-rule" /></div><div className="tab-list">{group.items.map((tab) => <TabRow key={`${tab.sourceId}:${tab.id}`} tab={tab} meta={data.metadata[tab.key] || {}} update={update} focus={() => desk?.focusTab(tab.sourceId, tab.id)} />)}</div></section>)}</div> : <div className="filtered-empty"><Search size={25} /><h2>No matching tabs</h2><p>Try a different search or choose another view.</p><button onClick={() => { setQuery(''); setView({ type: 'all' }); }}>Show all tabs</button></div>}
          <footer className="page-footer">{tabs.length} open YouTube {tabs.length === 1 ? 'tab' : 'tabs'} · {data.sources.length} {data.sources.length === 1 ? 'browser' : 'browsers'} connected</footer>
        </> : <EmptyState connected={data.sources.length > 0} openHelp={() => setShowHelp(true)} openFolder={() => desk?.openExtensionFolder()} />}
      </main>

      {showHelp && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false); }}><div className="help-modal" role="dialog" aria-modal="true" aria-label="Connect a browser"><button className="modal-close" onClick={() => setShowHelp(false)} aria-label="Close"><X size={18} /></button><div className="modal-icon"><FolderOpen size={22} /></div><h2>Connect your browser</h2><p className="modal-intro">Add the connector to each Chrome, Edge, Brave, or other Chromium profile you want to track.</p><ol className="steps"><li><span>01</span><p>Open <strong>chrome://extensions</strong> (or <strong>edge://extensions</strong>) and turn on <strong>Developer mode</strong>.</p></li><li><span>02</span><p>Click <strong>Load unpacked</strong> and select the extension folder.</p></li><li><span>03</span><p>Leave this app open. Tabs from every window and virtual desktop will appear automatically.</p></li></ol><button className="primary-button" onClick={() => desk?.openExtensionFolder()}><FolderOpen size={17} /> Open extension folder <ArrowUpRight size={16} /></button><div className="modal-note">Your data stays on this computer. The connector only talks to the local app.</div></div></div>}
      {showRemote && <RemoteModal settings={data.webhook || emptyWebhook} desk={desk} close={() => setShowRemote(false)} />}
    </div>
  );
}

function RemoteModal({ settings, desk, close }) {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [port, setPort] = useState(String(settings.port));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { desk?.getWebhookSecret().then(setToken).catch(() => setError('Could not load the access token.')); }, [desk]);
  useEffect(() => setPort(String(settings.port)), [settings.port]);

  async function changeSettings(patch) {
    setBusy(true); setError('');
    try { await desk?.setWebhookSettings(patch); } catch (failure) { setError(failure.message || 'Could not update remote control.'); }
    setBusy(false);
  }

  async function copy(value, label) {
    try { await desk?.copyText(value); setCopied(label); setTimeout(() => setCopied(''), 1800); }
    catch { setError('Could not copy to clipboard.'); }
  }

  async function rotate() {
    setError('');
    try { setToken(await desk?.rotateWebhookSecret()); setVisible(false); } catch { setError('Could not rotate the token.'); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="help-modal remote-modal" role="dialog" aria-modal="true" aria-label="Remote control settings">
      <button className="modal-close" onClick={close} aria-label="Close"><X size={18} /></button>
      <div className="modal-icon"><Radio size={21} /></div>
      <h2>Remote control</h2>
      <p className="modal-intro">Send authenticated HTTP commands to organize tabs and control the app from another device.</p>
      <div className="remote-status"><span className={`status-dot ${settings.running ? 'online' : ''}`} /><strong>{settings.running ? 'Listening' : settings.enabled ? 'Unavailable' : 'Off'}</strong><span>{settings.running ? (settings.lan ? 'Local network' : 'This computer') : ''}</span></div>
      {(settings.error || error) && <div className="remote-error">{error || settings.error}</div>}
      <label className="remote-setting"><span><strong>Enable webhook</strong><small>Accept API requests while the app is open</small></span><input type="checkbox" aria-label="Enable webhook" checked={settings.enabled} disabled={busy} onChange={(event) => changeSettings({ enabled: event.target.checked })} /></label>
      <label className="remote-setting"><span><strong>Allow local network</strong><small>Listen on all network interfaces, not just this computer</small></span><input type="checkbox" aria-label="Allow local network" checked={settings.lan} disabled={busy} onChange={(event) => changeSettings({ lan: event.target.checked })} /></label>
      <form className="remote-port" onSubmit={(event) => { event.preventDefault(); changeSettings({ port: Number(port) }); }}><label htmlFor="remote-port-input">Port</label><input id="remote-port-input" type="number" min="1024" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /><button disabled={busy || Number(port) === settings.port} type="submit">Apply</button></form>
      <div className="remote-field-label">ENDPOINT</div>
      <div className="remote-value"><code>{settings.localUrl}/webhook</code><button onClick={() => copy(`${settings.localUrl}/webhook`, 'endpoint')} aria-label="Copy endpoint"><Copy size={15} /></button></div>
      {settings.lan && settings.lanUrls.map((url) => <div className="remote-value" key={url}><code>{url}/webhook</code><button onClick={() => copy(`${url}/webhook`, 'endpoint')} aria-label={`Copy ${url} endpoint`}><Copy size={15} /></button></div>)}
      <div className="remote-field-label">BEARER TOKEN</div>
      <div className="remote-value"><code>{visible ? token : '••••••••••••••••••••••••••••••••'}</code><button onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide token' : 'Show token'}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button><button onClick={() => copy(token, 'token')} aria-label="Copy token"><Copy size={15} /></button></div>
      <div className="remote-bottom"><button className="rotate-token" onClick={rotate}><RotateCw size={14} /> Rotate token</button>{copied && <span>Copied {copied}</span>}</div>
      <button className="remote-docs" onClick={() => desk?.openApiDocs()}><FolderOpen size={16} /> Open API documentation <ArrowUpRight size={15} /></button>
      <div className="modal-note">Keep the token private. Rotating it immediately invalidates old clients.</div>
    </div>
  </div>;
}

function FoldersView({ sections, folders, metadata, update, desk, collapsedIds, setCollapsedIds }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [over, setOver] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [creatingParentId, setCreatingParentId] = useState(null);

  useEffect(() => {
    const visibleIds = new Set(sections.flatMap((section) => section.items.map((tab) => tab.slotId)));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [sections]);

  function clearDrag() { setOver(null); }

  function toggleFolder(id) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectTab(section, index, event) {
    if (event.target.closest('button, input, form')) return;
    const id = section.items[index].slotId;
    const additive = event.ctrlKey || event.metaKey;
    setSelectedIds((current) => {
      const next = new Set(additive ? current : []);
      if (event.shiftKey && selectionAnchor?.sectionId === section.id) {
        const start = Math.min(selectionAnchor.index, index);
        const end = Math.max(selectionAnchor.index, index);
        section.items.slice(start, end + 1).forEach((tab) => next.add(tab.slotId));
      } else if (additive && current.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (!event.shiftKey) setSelectionAnchor({ sectionId: section.id, index });
  }

  async function addFolder(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (!await desk?.createFolder(name, creatingParentId)) {
      setFolderError('That folder name is already in use.');
      return;
    }
    setNewName(''); setCreating(false); setCreatingParentId(null); setFolderError('');
  }

  async function saveName(event, id) {
    event?.preventDefault();
    if (editingId !== id) return;
    if (!await desk?.renameFolder(id, editName)) {
      setFolderError('Enter a unique folder name.');
      return;
    }
    setEditingId(null); setFolderError('');
  }

  function startTabDrag(event, tab) {
    if (!selectedIds.has(tab.slotId)) {
      setSelectedIds(new Set([tab.slotId]));
      setSelectionAnchor({ sectionId: null, index: null });
    }
    event.dataTransfer.effectAllowed = 'move';
    const draggedIds = selectedIds.has(tab.slotId) ? [...selectedIds] : [tab.slotId];
    event.dataTransfer.setData('application/x-tabdesk-tab', tab.slotId);
    event.dataTransfer.setData('application/x-tabdesk-tabs', JSON.stringify(draggedIds));
    event.dataTransfer.setData('text/plain', tab.url);
  }

  function startFolderDrag(event, id) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tabdesk-folder', id);
    event.dataTransfer.setData('text/plain', id);
  }

  function accepts(event, type) { return event.dataTransfer.types.includes(`application/x-tabdesk-${type}`); }

  function rowDragOver(event, tab) {
    if (!accepts(event, 'tab')) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setOver({ type: 'tab', id: tab.slotId, edge: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
  }

  async function rowDrop(event, tab, index, section) {
    if (!accepts(event, 'tab')) return;
    event.preventDefault(); event.stopPropagation();
    const rawIds = event.dataTransfer.getData('application/x-tabdesk-tabs');
    let slotIds = [event.dataTransfer.getData('application/x-tabdesk-tab')];
    try { if (rawIds) slotIds = JSON.parse(rawIds); } catch { /* Ignore malformed drag data. */ }
    const bounds = event.currentTarget.getBoundingClientRect();
    const beforeId = event.clientY < bounds.top + bounds.height / 2 ? tab.slotId : section.items[index + 1]?.slotId || null;
    const movedIds = slotIds.filter((id) => id && id !== tab.slotId).reverse();
    for (const id of movedIds) await desk?.moveTab(id, section.id, beforeId);
    clearDrag();
  }

  function headerDragOver(event, section, index) {
    if (!accepts(event, 'folder') || section.id === 'unfiled') return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setOver({ type: 'folder', id: section.id, edge: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
  }

  function headerDrop(event, section, index) {
    if (!accepts(event, 'folder') || section.id === 'unfiled') return;
    event.preventDefault(); event.stopPropagation();
    const draggedId = event.dataTransfer.getData('application/x-tabdesk-folder');
    const bounds = event.currentTarget.getBoundingClientRect();
    const beforeId = event.clientY < bounds.top + bounds.height / 2 ? section.id : folders[index + 1]?.id || null;
    desk?.moveFolder(draggedId, beforeId);
    clearDrag();
  }

  return <div className="folders-view">
     <div className="folder-toolbar"><span>{folders.length} {folders.length === 1 ? 'folder' : 'folders'} · {sections.reduce((total, section) => total + section.items.length, 0)} tabs</span><div className="folder-toolbar-actions">{selectedIds.size > 0 && <><span className="selection-count">{selectedIds.size} selected</span><button className="clear-selection" onClick={() => { setSelectedIds(new Set()); setSelectionAnchor(null); }}>Clear selection</button></>}{creating ? <form className="folder-create-form" onSubmit={addFolder}><input autoFocus maxLength={48} placeholder={creatingParentId ? 'Subfolder name' : 'Folder name'} aria-label={creatingParentId ? 'New subfolder name' : 'New folder name'} value={newName} onChange={(event) => { setNewName(event.target.value); setFolderError(''); }} onKeyDown={(event) => { if (event.key === 'Escape') { setCreating(false); setCreatingParentId(null); setNewName(''); } }} /><button type="submit" aria-label="Save folder"><Check size={16} /></button><button type="button" onClick={() => { setCreating(false); setCreatingParentId(null); setNewName(''); setFolderError(''); }} aria-label="Cancel"><X size={16} /></button></form> : <button className="new-folder-button" onClick={() => { setCreating(true); setCreatingParentId(null); }}><Plus size={16} /> New folder</button>}</div></div>
    {folderError && <p className="folder-error">{folderError}</p>}
    {sections.map((section, index) => {
      const unfiled = section.id === 'unfiled';
       return <section className={`folder-section ${over?.type === 'section' && over.id === section.id ? 'folder-drop-target' : ''} ${over?.type === 'folder' && over.id === section.id ? `folder-drop-${over.edge}` : ''}`} style={{ marginLeft: `${Math.min(section.depth || 0, 6) * 24}px` }} key={section.id}
        onDragOver={(event) => { if (accepts(event, 'tab')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver({ type: 'section', id: section.id }); } }}
        onDrop={(event) => { if (accepts(event, 'tab')) { event.preventDefault(); desk?.moveTab(event.dataTransfer.getData('application/x-tabdesk-tab'), section.id, null); clearDrag(); } }}
        onDragEnd={clearDrag}>
        <div className="folder-heading" role="button" tabIndex={0} aria-expanded={!collapsedIds.has(section.id)} onClick={(event) => { if (!event.target.closest('button, input, form')) toggleFolder(section.id); }} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, input, form')) { event.preventDefault(); toggleFolder(section.id); } }} onDragOver={(event) => headerDragOver(event, section, index)} onDrop={(event) => headerDrop(event, section, index)}>
          <ChevronDown className={`folder-collapse-icon ${collapsedIds.has(section.id) ? 'is-collapsed' : ''}`} size={15} aria-hidden="true" />
          <span className={`folder-icon ${unfiled ? 'unfiled-icon' : ''}`}><Folder size={16} /></span>
          {editingId === section.id ? <form className="folder-rename-form" onSubmit={(event) => saveName(event, section.id)}><input autoFocus maxLength={48} value={editName} onChange={(event) => setEditName(event.target.value)} aria-label="Rename folder" onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null); }} /><button aria-label="Save folder name"><Check size={15} /></button></form> : <h2>{section.name}</h2>}
           <span className="folder-count">{section.items.length}</span><span className="folder-watch-time" title="Sum of known video durations">{formatFolderWatchTime(section.items, metadata)}</span>
          <div className="folder-spacer" />
           {!unfiled && <div className="folder-controls"><button title="New subfolder" aria-label={`New subfolder in ${section.name}`} onClick={() => { setCreating(true); setCreatingParentId(section.id); setNewName(''); setFolderError(''); }}><FolderPlus size={15} /></button><button title="Rename folder" aria-label={`Rename ${section.name}`} onClick={() => { setEditingId(section.id); setEditName(section.name); setFolderError(''); }}><Pencil size={15} /></button><button title="Delete folder; tabs move to Unfiled" aria-label={`Delete ${section.name}`} onClick={() => desk?.deleteFolder(section.id)}><Trash2 size={15} /></button><button className="folder-grip" draggable onDragStart={(event) => startFolderDrag(event, section.id)} onDragEnd={clearDrag} onKeyDown={(event) => { if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); desk?.moveFolder(section.id, folders[index - 1].id); } if (event.key === 'ArrowDown' && index < folders.length - 1) { event.preventDefault(); desk?.moveFolder(section.id, folders[index + 2]?.id || null); } }} title="Drag to reorder folders; arrow keys also work" aria-label={`Reorder ${section.name}`}><GripVertical size={17} /></button></div>}
        </div>
          {!collapsedIds.has(section.id) && (section.items.length ? <div className="folder-tab-list" role="listbox" aria-label={`${section.name} tabs`}>{section.items.map((tab, tabIndex) => <TabRow key={tab.slotId} tab={tab} meta={metadata[tab.key] || {}} update={update} focus={() => desk?.focusTab(tab.sourceId, tab.id)} selected={selectedIds.has(tab.slotId)} onSelect={(event) => selectTab(section, tabIndex, event)} dragProps={{
          onDragStart: (event) => startTabDrag(event, tab), onDragEnd: clearDrag,
          onDragOver: (event) => rowDragOver(event, tab),
          onDrop: (event) => rowDrop(event, tab, tabIndex, section),
          indicator: over?.type === 'tab' && over.id === tab.slotId ? over.edge : null,
          onKeyDown: (event) => {
            if (event.key === 'ArrowUp' && tabIndex > 0) { event.preventDefault(); desk?.moveTab(tab.slotId, section.id, section.items[tabIndex - 1].slotId); }
            if (event.key === 'ArrowDown' && tabIndex < section.items.length - 1) { event.preventDefault(); desk?.moveTab(tab.slotId, section.id, section.items[tabIndex + 2]?.slotId || null); }
          }
        }} />)}</div> : <div className="folder-empty">{unfiled ? 'No unfiled tabs. Drag a tab here to move it out of a folder.' : 'Drop tabs here to add them to this folder.'}</div>)}
      </section>;
    })}
  </div>;
}

function NavItem({ icon: Icon, label, count, active, onClick }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={active ? 2.3 : 1.9} /><span>{label}</span><span className="nav-count">{count}</span></button>;
}

function EmptyState({ connected, openHelp, openFolder }) {
  return <div className="empty-area"><div className="empty-illustration"><div className="empty-back" /><div className="empty-front"><Play size={23} fill="currentColor" /></div><div className="empty-line one" /><div className="empty-line two" /></div><h2>{connected ? 'No YouTube tabs open' : 'Your tabs, all together.'}</h2><p>{connected ? 'Open a YouTube page in your connected browser. It will show up here automatically.' : 'Connect your browser once to see every YouTube tab across your windows and virtual desktops.'}</p>{!connected && <div className="empty-actions"><button className="primary-button" onClick={openFolder}><FolderOpen size={17} /> Open extension folder</button><button className="text-button" onClick={openHelp}>How to connect <ArrowUpRight size={16} /></button></div>}</div>;
}

function TabRow({ tab, meta, update, focus, selected, onSelect, dragProps }) {
  const [editing, setEditing] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const tags = meta.tags || [];

  function addTag(event) {
    event.preventDefault();
    const tag = tagInput.trim().slice(0, 32);
    if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) update(tab.key, { tags: [...tags, tag] });
    setTagInput('');
    setEditing(false);
  }

  return <article className={`tab-row ${dragProps ? 'draggable-row' : ''} ${selected ? 'tab-selected' : ''} ${dragProps?.indicator ? `tab-drop-${dragProps.indicator}` : ''}`} role="option" aria-selected={selected} draggable={Boolean(dragProps)} onClick={onSelect} onDragStart={dragProps?.onDragStart} onDragEnd={dragProps?.onDragEnd} onDragOver={dragProps?.onDragOver} onDrop={dragProps?.onDrop}>
    {dragProps && <button className="tab-grip" title="Drag to reorder or move; arrow keys reorder" aria-label={`Reorder ${cleanTitle(tab.title)}`} onKeyDown={dragProps.onKeyDown}><GripVertical size={17} /></button>}
    <button className={`thumbnail ${!tab.video || imageFailed ? 'thumbnail-placeholder' : ''}`} onClick={focus} aria-label={`Switch to ${cleanTitle(tab.title)}`} title="Switch to tab">{tab.video && !imageFailed ? <img src={`https://i.ytimg.com/vi/${tab.video}/mqdefault.jpg`} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <Play size={23} fill="currentColor" />}</button>
     <div className="tab-info"><button className="tab-title" onClick={focus} title={cleanTitle(tab.title)}>{cleanTitle(tab.title)} <ArrowUpRight size={14} /></button><div className="tab-meta"><span>{tab.browser}</span><span className="meta-separator">·</span><span>Window {tab.windowNumber}</span>{tab.active && <><span className="meta-separator">·</span><span className="active-label">Active tab</span></>}<span className="meta-separator">·</span><span className="duration-label">{formatDuration(meta.duration)}</span></div><div className="tag-line">{tags.map((tag) => <span className="tag-chip" key={tag}><Hash size={11} />{tag}<button onClick={() => update(tab.key, { tags: tags.filter((item) => item !== tag) })} aria-label={`Remove ${tag} tag`}><X size={12} /></button></span>)}{editing ? <form className="tag-form" onSubmit={addTag}><input autoFocus value={tagInput} onChange={(event) => setTagInput(event.target.value)} maxLength={32} placeholder="Tag name" aria-label="New tag name" onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false); }} /><button type="submit" aria-label="Add tag"><Check size={14} /></button></form> : <button className="add-tag" onClick={() => setEditing(true)}><Plus size={13} /> Tag</button>}</div></div>
    <div className="row-actions"><button className={`priority-button ${meta.priority ? 'selected' : ''}`} onClick={() => update(tab.key, { priority: !meta.priority })} aria-label={meta.priority ? 'Remove high priority' : 'Mark high priority'} title={meta.priority ? 'Remove high priority' : 'Mark high priority'}><Star size={18} fill={meta.priority ? 'currentColor' : 'none'} /></button><button className={`watched-button ${meta.watched ? 'is-watched' : ''}`} onClick={() => update(tab.key, { watched: !meta.watched })} aria-label={meta.watched ? 'Mark unwatched' : 'Mark watched'}><span className="watch-check"><Check size={13} strokeWidth={3} /></span>{meta.watched ? 'Watched' : 'Mark watched'}</button></div>
  </article>;
}

createRoot(document.getElementById('root')).render(<App />);
