# Remote control API

YouTube Tab Desk accepts **inbound HTTP webhook commands** while the desktop app is running. You can read the current tab list, change watch status/priority/tags, organize folders, focus a browser tab, switch the app's view, or download the list as CSV. This is a request/response API: the app does not send outgoing webhooks.

## Enable and connect

1. Open **Remote control** at the bottom of the app sidebar.
2. Keep **Enable webhook** on. It is on by default and initially listens **only on this computer** at `http://127.0.0.1:17350`.
3. Copy the **Bearer token** from the modal. Every endpoint, including health and CSV export, requires it.
4. For access from another device on the same network, turn on **Allow local network** and use one of the displayed network URLs. If your OS firewall prompts you, allow the app on the network you intend to use. You can change the port in the same modal (range 1024–65535).

The base URL is `http://127.0.0.1:17350` locally, or `http://<computer-LAN-IP>:17350` when LAN access is enabled. The modal shows the current addresses. The browser connector uses a *different* local WebSocket port (`17349`); do not send API requests there.

Settings and the random 256-bit token are saved in `webhook.json` in the app's user-data directory. Turning the webhook off stops the HTTP listener; rotating the token immediately rejects the old token. Requests use plain HTTP, so use a trusted local network or put an HTTPS reverse proxy/tunnel in front of the app when accessing it over an untrusted network. Do not place the token in a URL or share it with a browser page.

## Request conventions

- **Version:** v1 (`/api/v1/*` reads, `/webhook` commands).
- **Authentication:** `Authorization: Bearer <token>` on every request. Header name is case-insensitive; the scheme is `Bearer`.
- **Command body:** `Content-Type: application/json`, a JSON object no larger than **64 KiB**. Fields are at the top level of the object, not inside a `payload` property.
- **Success:** HTTP 200 with `{ "ok": true, "data": ... }`, except CSV export which returns a file.
- **Failure:** non-2xx with `{ "ok": false, "error": { "code": "...", "message": "..." } }`.
- The API returns a snapshot of **currently open YouTube tabs** in connected Chromium browser profiles. A browser profile needs the Tab Desk connector installed and connected. Windows on other virtual desktops are included by the connector.
- No CORS headers are sent; call the API from a script, automation tool, server, or other HTTP client rather than a cross-origin webpage.

Set a token in a POSIX shell:

```sh
export TABDESK_TOKEN='paste-the-token-from-the-app'
curl -H "Authorization: Bearer $TABDESK_TOKEN" http://127.0.0.1:17350/api/v1/state
```

In PowerShell:

```powershell
$env:TABDESK_TOKEN = 'paste-the-token-from-the-app'
curl.exe -H "Authorization: Bearer $env:TABDESK_TOKEN" http://127.0.0.1:17350/api/v1/state
```

## Read endpoints

| Method | Path | Response `data` |
| --- | --- | --- |
| `GET` | `/api/v1/health` | `{ "status": "ok", "version": 1 }` |
| `GET` | `/api/v1/state` | Full snapshot: `sources`, `folders`, `tabs`, `totals` |
| `GET` | `/api/v1/tabs` | `{ "tabs": [...] }` |
| `GET` | `/api/v1/folders` | `{ "folders": [...] }` |
| `GET` | `/api/v1/export.csv` | CSV attachment (`text/csv; charset=utf-8`) of all open tabs in folder order |

For a CSV file:

```sh
curl -H "Authorization: Bearer $TABDESK_TOKEN" \
  http://127.0.0.1:17350/api/v1/export.csv -o youtube-tabs.csv
```

The CSV has a UTF-8 BOM and columns `Folder`, `Position`, `Title`, `URL`, `Browser`, `Duration`, `Watched`, `High priority`, `Tags`. Tags are joined with `; `. It includes every *open* tab even when the desktop app is showing a filtered view. Spreadsheet-style formula prefixes in cells are escaped.

### Snapshot shape

```json
{
  "ok": true,
  "data": {
    "sources": [
      { "id": "browser-profile-uuid", "name": "Chrome / Chromium", "tabCount": 1 }
    ],
    "folders": [
      { "id": "folder-uuid", "name": "Watch next", "tabCount": 1 },
      { "id": "unfiled", "name": "Unfiled", "tabCount": 0 }
    ],
    "tabs": [
      {
        "slotId": "persistent-tab-uuid",
        "sourceId": "browser-profile-uuid",
        "tabId": 123,
        "windowId": 7,
        "browser": "Chrome / Chromium",
        "title": "Example - YouTube",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "active": false,
        "videoId": "dQw4w9WgXcQ",
        "metadataKey": "video:dQw4w9WgXcQ",
        "watched": false,
        "priority": true,
        "tags": ["music", "later"],
        "durationSeconds": 213,
        "folderId": "folder-uuid",
        "folderName": "Watch next",
        "position": 1
      }
    ],
    "totals": { "tabs": 1, "folders": 1, "sources": 1 }
  }
}
```

`sources` contains only connected browser profiles. `folders` contains the user's folders in order, followed by the built-in `unfiled` folder. `tabs` follows that folder order, then tab order within each folder. `position` is **1-based among currently open tabs** in that folder. Folder counts and totals exclude closed tabs; user-created folders remain visible even when empty. `durationSeconds` is a positive number if playback duration is known, otherwise `null`. For non-video YouTube pages, `videoId` is `null` and `metadataKey` starts with `page:`.

`sourceId` identifies a browser profile; `tabId` is its current browser tab ID. `slotId` is the app's persistent identity for that *tab instance*, including duplicates of the same URL. Use `slotId` for folder placement and metadata commands. `tabId` may change after a browser restart; the app attempts to restore `slotId` by browser profile and URL. `metadataKey` is shared by tabs pointing at the same video (or normalized page), so changing watched/priority/tags for one such tab affects the others. The read API returns only open tabs; saved metadata and folder placements for closed tabs are not listed.

## Send commands to `/webhook`

All commands are `POST /webhook` with a JSON body. Example:

```sh
curl -X POST http://127.0.0.1:17350/webhook \
  -H "Authorization: Bearer $TABDESK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"create_folder","name":"Watch next"}'
```

PowerShell equivalent:

```powershell
$body = @{ action = 'create_folder'; name = 'Watch next' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:17350/webhook' -Method Post `
  -Headers @{ Authorization = "Bearer $env:TABDESK_TOKEN" } `
  -ContentType 'application/json' -Body $body
```

### Command reference

| `action` | Required fields | Optional fields | Result in `data` |
| --- | --- | --- | --- |
| `focus_tab` | `sourceId` string, `tabId` integer | — | `{ "sourceId", "tabId", "sent": true }` |
| `set_metadata` | `slotId` string **and at least one field to change** | `watched` boolean, `priority` boolean, `tags` array | `{ "tab": updatedTab }` |
| `create_folder` | `name` string | — | `{ "folder": { "id", "name" } }` |
| `rename_folder` | `folderId` string, `name` string | — | `{ "folder": { "id", "name" } }` |
| `delete_folder` | `folderId` string | — | `{ "folderId", "movedTo": "unfiled" }` |
| `move_folder` | `folderId` string | `beforeFolderId` string or `null` | `{ "folderId", "beforeFolderId" }` |
| `move_tab` | `slotId` string, `folderId` string | `beforeSlotId` string or `null` | `{ "tab": updatedTab }` |
| `show_view` | `view` string | `tag` string when `view` is `tag` | `{ "view", "tag"? }` |

**`focus_tab`** sends a focus command to the connected browser. Get `sourceId` and `tabId` from a fresh snapshot. It can switch the active tab and focus its browser window. Example:

```json
{ "action": "focus_tab", "sourceId": "browser-profile-uuid", "tabId": 123 }
```

**`set_metadata`** changes only the supplied fields, leaving other fields unchanged. `tags` *replaces* the full tag list; send `[]` to clear it. Up to 12 tags, each 1–32 characters; duplicate tags are removed. `watched` and `priority` are booleans. The target `slotId` must currently be open. Duration is observed from playback and cannot be set by this command. Example:

```json
{ "action": "set_metadata", "slotId": "persistent-tab-uuid", "watched": true, "priority": true, "tags": ["research", "soon"] }
```

**Folder names** must be nonempty, unique ignoring letter case, and at most 48 characters. At most 100 user folders are allowed. `unfiled` is a built-in folder ID; it can receive tabs but cannot be renamed, deleted, or reordered. Deleting a folder moves its saved tab placements to Unfiled; it does **not** close browser tabs.

**`move_folder`** places the folder *immediately before* `beforeFolderId`. Omit that field or set it to `null` to put the folder last (immediately before Unfiled):

```json
{ "action": "move_folder", "folderId": "folder-uuid", "beforeFolderId": null }
```

**`move_tab`** moves an open tab to `folderId`, immediately before `beforeSlotId`. The `beforeSlotId`, when given, must already belong to the destination folder. Omit it or set it to `null` to append the tab. Use `folderId: "unfiled"` to remove a tab from a named folder. Example:

```json
{ "action": "move_tab", "slotId": "persistent-tab-uuid", "folderId": "folder-uuid", "beforeSlotId": null }
```

**`show_view`** brings the desktop window to the foreground and selects a sidebar view. `view` can be `all`, `folders`, `unwatched`, `watched`, `priority`, or `tag`; `tag` requires the exact tag name to filter by. Example:

```json
{ "action": "show_view", "view": "tag", "tag": "research" }
```

## Errors and status codes

| HTTP status | Typical `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_action`, `invalid_field` | Invalid JSON object, action, or field |
| 401 | `unauthorized` | Missing or incorrect Bearer token |
| 404 | `not_found`, `tab_not_found`, `folder_not_found`, `position_not_found` | Path, open tab, folder, or insertion target missing |
| 405 | `method_not_allowed` | Endpoint exists but requires another method (`Allow` header lists it) |
| 409 | `folder_conflict`, `immutable_folder`, `window_unavailable` | Duplicate/invalid folder operation or app window unavailable |
| 413 | `body_too_large` | JSON body exceeds 64 KiB |
| 415 | `unsupported_media_type` | POST body is not `application/json` |
| 500 | `internal_error` | Unexpected app error (details are not returned over HTTP) |

Example failure:

```json
{ "ok": false, "error": { "code": "tab_not_found", "message": "No open tab has that slotId." } }
```

If the listener is off, the app is closed, the port is blocked, or the computer is not reachable, the connection itself will fail rather than returning one of these JSON errors. Check the status in **Remote control** in the app.
