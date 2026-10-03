const fields = ['address', 'token', 'deviceName', 'profileName', 'browserName'];
const result = document.getElementById('result');
const status = document.getElementById('status');
const save = document.getElementById('save');

function showStatus(value) { status.textContent = value || 'Waiting for the desktop app'; }
chrome.storage.local.get(['connectorSettings', 'connectionStatus']).then((saved) => {
  for (const field of fields) document.getElementById(field).value = saved.connectorSettings?.[field] || (field === 'address' ? TabDeskSettings.defaultAddress : '');
  showStatus(saved.connectionStatus);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.connectionStatus) showStatus(changes.connectionStatus.newValue);
});

document.getElementById('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  result.textContent = ''; result.className = '';
  try {
    const settings = TabDeskSettings.normalize(Object.fromEntries(fields.map((field) => [field, document.getElementById(field).value])));
    // Request access only to the receiving host, and only as part of this user action.
    const allowed = await chrome.permissions.request({ origins: [TabDeskSettings.permissionOrigin(settings.address)] });
    if (!allowed) throw new Error('Host access is required to connect to this app address.');
    save.disabled = true;
    const previous = await chrome.storage.local.get('connectorSettings');
    await chrome.storage.local.set({ connectorSettings: settings });
    if (JSON.stringify(previous.connectorSettings) === JSON.stringify(settings)) await chrome.runtime.sendMessage({ type: 'reconnect' });
    result.textContent = 'Settings saved. Connecting…';
  } catch (error) { result.textContent = error.message; result.className = 'error'; }
  finally { save.disabled = false; }
});

document.getElementById('reset').addEventListener('click', () => {
  document.getElementById('address').value = TabDeskSettings.defaultAddress;
  document.getElementById('token').value = '';
  document.getElementById('settings').requestSubmit();
});
