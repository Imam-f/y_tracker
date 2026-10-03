// Shared by the options page and MV3 worker; no browser APIs are needed to validate settings.
globalThis.TabDeskSettings = {
  defaultAddress: 'ws://127.0.0.1:17349',
  normalize(input = {}) {
    const address = new URL(String(input.address || this.defaultAddress).trim());
    if (address.protocol === 'http:') address.protocol = 'ws:';
    if (address.protocol === 'https:') address.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(address.protocol) || address.username || address.password || address.search || address.hash) {
      throw new Error('Use a ws:// or wss:// app address without credentials or query parameters.');
    }
    const legacy = address.protocol === 'ws:' && address.hostname === '127.0.0.1' && address.port === '17349';
    if (address.pathname === '/') address.pathname = legacy ? '/' : '/connector';
    if (address.pathname !== (legacy ? '/' : '/connector')) throw new Error('The connector path must be /connector.');
    const token = String(input.token || '').trim();
    if (!legacy && !token) throw new Error('Paste the access token from the app’s Remote control settings.');
    const text = (value) => String(value || '').trim().slice(0, 60);
    return {
      address: legacy ? this.defaultAddress : address.href,
      token, deviceName: text(input.deviceName), profileName: text(input.profileName), browserName: text(input.browserName)
    };
  },
  permissionOrigin(address) {
    const url = new URL(address);
    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.hostname}/*`;
  }
};
