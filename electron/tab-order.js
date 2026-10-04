// Shared by the desktop app and the renderer's development demo.
export function moveTabs(organization, slotIds, folderId, beforeId = null) {
  const destination = organization.order[folderId];
  if (!Array.isArray(destination) || !Array.isArray(slotIds) || !slotIds.length ||
    slotIds.some((id) => typeof id !== 'string' || !Object.hasOwn(organization.records, id))) return false;

  const ids = [...new Set(slotIds)];
  const moving = new Set(ids);
  // If the insertion point is selected too, anchor to the next stationary tab.
  const targetIndex = destination.indexOf(beforeId);
  const anchor = targetIndex < 0 ? null : destination.slice(targetIndex).find((id) => !moving.has(id));
  for (const entries of Object.values(organization.order)) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (moving.has(entries[index])) entries.splice(index, 1);
    }
  }
  const index = destination.indexOf(anchor);
  destination.splice(index < 0 ? destination.length : index, 0, ...ids);
  return true;
}
