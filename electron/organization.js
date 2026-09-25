import { randomUUID } from 'node:crypto';

export const UNFILED = 'unfiled';

export function createOrganization(saved = {}) {
  const folders = Array.isArray(saved.folders) ? saved.folders.filter((folder) =>
    folder && typeof folder.id === 'string' && folder.id !== UNFILED && typeof folder.name === 'string'
  ).map((folder) => ({ id: folder.id, name: folder.name.slice(0, 48), parentId: typeof folder.parentId === 'string' ? folder.parentId : null })) : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  folders.forEach((folder) => { if (!folder.parentId || folder.parentId === folder.id || !folderIds.has(folder.parentId)) folder.parentId = null; });
  const records = saved.records && typeof saved.records === 'object' && !Array.isArray(saved.records) ? saved.records : {};
  const order = { [UNFILED]: [] };
  for (const id of [UNFILED, ...folders.map((folder) => folder.id)]) {
    const entries = saved.order?.[id];
    order[id] = Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : [];
  }
  return { folders, records, order };
}

export function reconcileTabs(organization, sourceId, tabs) {
  let changed = false;
  const used = new Set();
  const records = Object.entries(organization.records);
  const allPlaced = new Set(Object.values(organization.order).flat());
  const currentIds = new Set(tabs.map((tab) => tab.id));

  const assigned = tabs.map((tab) => {
    let slot = records.find(([id, record]) => !used.has(id) && record.sourceId === sourceId && record.tabId === tab.id)?.[0];
    if (!slot) {
      slot = records.find(([id, record]) => !used.has(id) && record.sourceId === sourceId &&
        record.url === tab.url && !currentIds.has(record.tabId))?.[0];
    }
    if (!slot) slot = randomUUID();
    used.add(slot);
    const old = organization.records[slot];
    if (!old || old.tabId !== tab.id || old.url !== tab.url) {
      organization.records[slot] = { sourceId, tabId: tab.id, url: tab.url };
      changed = true;
    }
    if (!allPlaced.has(slot)) {
      organization.order[UNFILED].push(slot);
      allPlaced.add(slot);
      changed = true;
    }
    return { ...tab, slotId: slot };
  });

  return { tabs: assigned, changed };
}

export function createFolder(organization, name, parentId = null) {
  const clean = typeof name === 'string' ? name.trim().slice(0, 48) : '';
  if (!clean || organization.folders.length >= 100 || (parentId !== null && !organization.folders.some((folder) => folder.id === parentId)) || organization.folders.some((folder) => folder.parentId === parentId && folder.name.toLowerCase() === clean.toLowerCase())) return null;
  const folder = { id: randomUUID(), name: clean, parentId };
  organization.folders.push(folder);
  organization.order[folder.id] = [];
  return folder;
}

export function renameFolder(organization, id, name) {
  const clean = typeof name === 'string' ? name.trim().slice(0, 48) : '';
  const folder = organization.folders.find((item) => item.id === id);
  if (!folder || !clean || organization.folders.some((item) => item.id !== id && item.parentId === folder.parentId && item.name.toLowerCase() === clean.toLowerCase())) return false;
  folder.name = clean;
  return true;
}

export function deleteFolder(organization, id) {
  if (!organization.folders.some((folder) => folder.id === id)) return false;
  organization.order[UNFILED].push(...(organization.order[id] || []));
  delete organization.order[id];
  organization.folders.forEach((folder) => { if (folder.parentId === id) folder.parentId = null; });
  organization.folders = organization.folders.filter((folder) => folder.id !== id);
  return true;
}

export function moveFolder(organization, id, beforeId) {
  const index = organization.folders.findIndex((folder) => folder.id === id);
  if (index < 0 || id === beforeId) return false;
  const [folder] = organization.folders.splice(index, 1);
  const targetIndex = organization.folders.findIndex((item) => item.id === beforeId);
  organization.folders.splice(targetIndex < 0 ? organization.folders.length : targetIndex, 0, folder);
  return true;
}

export function moveTab(organization, slotId, folderId, beforeId) {
  if (typeof slotId !== 'string' || !organization.records[slotId] || !organization.order[folderId] || slotId === beforeId) return false;
  for (const entries of Object.values(organization.order)) {
    const index = entries.indexOf(slotId);
    if (index >= 0) entries.splice(index, 1);
  }
  const destination = organization.order[folderId];
  const index = destination.indexOf(beforeId);
  destination.splice(index < 0 ? destination.length : index, 0, slotId);
  return true;
}
