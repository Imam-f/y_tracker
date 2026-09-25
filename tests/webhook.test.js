import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookServer, publicSnapshot } from '../electron/webhook.js';

test('authenticated webhook exposes ordered tabs, CSV, and validates commands', async (t) => {
  const tab = { id: 101, slotId: 'slot-a', windowId: 4, title: 'A "test" - YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', active: true };
  const sources = new Map([['profile', { id: 'profile', name: 'Chrome', tabs: [tab] }]]);
  const metadata = { 'video:dQw4w9WgXcQ': { watched: true, priority: false, tags: ['later'], duration: 213 } };
  const organization = { folders: [{ id: 'folder-a', name: 'Research' }], order: { 'folder-a': ['slot-a'], unfiled: [] } };
  let token = 'a'.repeat(64);
  const executed = [];
  const server = createWebhookServer({
    getToken: () => token,
    getSnapshot: () => publicSnapshot({ sources, metadata, organization }),
    execute: async (command) => { executed.push(command); return { accepted: command.action }; }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}` };
  const command = (value) => fetch(`${base}/webhook`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(value)
  });

  const denied = await fetch(`${base}/api/v1/health`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'unauthorized');

  const stateResponse = await fetch(`${base}/api/v1/state`, { headers });
  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.headers.get('access-control-allow-origin'), null);
  const snapshot = (await stateResponse.json()).data;
  assert.deepEqual(snapshot.folders.map((folder) => folder.name), ['Research', 'Unfiled']);
  assert.equal(snapshot.tabs[0].slotId, 'slot-a');
  assert.equal(snapshot.tabs[0].metadataKey, 'video:dQw4w9WgXcQ');
  assert.equal(snapshot.tabs[0].position, 1);
  assert.equal(snapshot.tabs[0].durationSeconds, 213);
  assert.deepEqual(snapshot.totals, { tabs: 1, folders: 1, sources: 1 });

  const csv = await fetch(`${base}/api/v1/export.csv`, { headers });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /"Research","1","A ""test"""/);

  const success = await command({ action: 'set_metadata', slotId: 'slot-a', watched: false, tags: [] });
  assert.equal(success.status, 200);
  assert.equal((await success.json()).data.accepted, 'set_metadata');
  assert.deepEqual(executed[0].tags, []);

  const invalid = await command({ action: 'set_metadata', slotId: 'slot-a', watched: 'yes' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'invalid_field');
  assert.equal(executed.length, 1);

  const unknown = await command({ action: 'launch_missiles' });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'invalid_action');

  const oversized = await command({ action: 'create_folder', name: 'x'.repeat(70000) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'body_too_large');

  const wrongMethod = await fetch(`${base}/webhook`, { headers });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');

  token = 'b'.repeat(64);
  assert.equal((await fetch(`${base}/api/v1/health`, { headers })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/health`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});
