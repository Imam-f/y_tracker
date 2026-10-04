import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrganization, reconcileTabs, createFolder, moveTab, moveTabs, moveFolder, deleteFolder
} from '../electron/organization.js';

test('duplicate URLs remain separate tabs when moved, reordered, and restored', () => {
  const organization = createOrganization();
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXc';
  const first = reconcileTabs(organization, 'browser-a', [
    { id: 11, url }, { id: 12, url }, { id: 13, url: 'https://www.youtube.com/feed/subscriptions' }
  ]).tabs;
  const folder = createFolder(organization, 'Watch next');

  assert.ok(moveTab(organization, first[1].slotId, folder.id, null));
  assert.ok(moveTab(organization, first[0].slotId, folder.id, first[1].slotId));
  assert.deepEqual(organization.order[folder.id], [first[0].slotId, first[1].slotId]);

  const saved = createOrganization(JSON.parse(JSON.stringify(organization)));
  const restored = reconcileTabs(saved, 'browser-a', [
    { id: 201, url }, { id: 202, url }, { id: 203, url: first[2].url }
  ]).tabs;
  assert.deepEqual(restored.map((tab) => tab.slotId), first.map((tab) => tab.slotId));
  assert.deepEqual(saved.order[folder.id], [first[0].slotId, first[1].slotId]);

  assert.ok(deleteFolder(saved, folder.id));
  assert.deepEqual(saved.order.unfiled, [first[2].slotId, first[0].slotId, first[1].slotId]);
});

test('folders can be reordered independently of their tabs', () => {
  const organization = createOrganization();
  const one = createFolder(organization, 'One');
  const two = createFolder(organization, 'Two');
  const three = createFolder(organization, 'Three');
  assert.ok(moveFolder(organization, three.id, one.id));
  assert.deepEqual(organization.folders.map((folder) => folder.name), ['Three', 'One', 'Two']);
  assert.ok(moveFolder(organization, three.id, null));
  assert.deepEqual(organization.folders.map((folder) => folder.name), ['One', 'Two', 'Three']);
  assert.equal(createFolder(organization, 'one'), null);
});

test('folders support nested parents and orphan children when a parent is deleted', () => {
  const organization = createOrganization();
  const parent = createFolder(organization, 'Projects');
  const child = createFolder(organization, 'Research', parent.id);
  assert.equal(child.parentId, parent.id);
  assert.equal(createFolder(organization, 'research', parent.id), null);
  assert.ok(deleteFolder(organization, parent.id));
  assert.equal(organization.folders.find((folder) => folder.id === child.id).parentId, null);
});

function batchFixture() {
  const organization = createOrganization();
  const tabs = reconcileTabs(organization, 'browser-a', [1, 2, 3, 4, 5].map((id) => ({ id, url: `https://www.youtube.com/watch?v=${id}` }))).tabs;
  const folder = createFolder(organization, 'Destination');
  return { organization, folder, ids: tabs.map((tab) => tab.slotId) };
}

test('a direct folder drop moves the entire batch in order, including tabs from different folders', () => {
  const { organization, folder, ids } = batchFixture();
  const source = createFolder(organization, 'Source');
  moveTab(organization, ids[1], source.id, null);
  moveTab(organization, ids[4], folder.id, null);
  assert.ok(moveTabs(organization, [ids[0], ids[1], ids[2]], folder.id));
  assert.deepEqual(organization.order[folder.id], [ids[4], ids[0], ids[1], ids[2]]);
  assert.deepEqual(organization.order.unfiled, [ids[3]]);
  assert.deepEqual(organization.order[source.id], []);
  const restored = createOrganization(JSON.parse(JSON.stringify(organization)));
  assert.deepEqual(restored.order, organization.order);
});

test('batch row drops preserve order before an existing tab and at the end', () => {
  const { organization, folder, ids } = batchFixture();
  moveTab(organization, ids[4], folder.id, null);
  assert.ok(moveTabs(organization, [ids[0], ids[1]], folder.id, ids[4]));
  assert.deepEqual(organization.order[folder.id], [ids[0], ids[1], ids[4]]);
  assert.ok(moveTabs(organization, [ids[2], ids[3]], folder.id, null));
  assert.deepEqual(organization.order[folder.id], [ids[0], ids[1], ids[4], ids[2], ids[3]]);
});

test('batch reordering anchors to the next unselected tab and deduplicates dragged IDs', () => {
  const { organization, ids } = batchFixture();
  assert.ok(moveTabs(organization, [ids[0], ids[1], ids[0]], 'unfiled', ids[1]));
  assert.deepEqual(organization.order.unfiled, ids);
  assert.ok(moveTabs(organization, [ids[0], ids[1]], 'unfiled', ids[4]));
  assert.deepEqual(organization.order.unfiled, [ids[2], ids[3], ids[0], ids[1], ids[4]]);
  assert.ok(moveTabs(organization, [ids[0], ids[1]], 'unfiled', null));
  assert.deepEqual(organization.order.unfiled, [ids[2], ids[3], ids[4], ids[0], ids[1]]);
});

test('invalid batches leave all placements unchanged', () => {
  const { organization, folder, ids } = batchFixture();
  const original = structuredClone(organization);
  for (const input of [null, ids[0], [], [ids[0], 'missing'], [ids[0], null], ['toString']]) {
    assert.equal(moveTabs(organization, input, folder.id), false);
    assert.deepEqual(organization, original);
  }
  assert.equal(moveTabs(organization, [ids[0]], 'missing'), false);
  assert.deepEqual(organization, original);
});
