# YouTube Tab Desk

A small Electron desktop app for organizing open YouTube tabs across browser windows and virtual desktops. Supports Chromium-based browsers (Chrome, Edge, Brave, etc.) through a local browser connector.

## Run

1. Install [Node.js](https://nodejs.org/) (version 20 or newer).
2. Run `npm install` and `npm run dev`.
3. In each browser profile you want to track, open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder. The app's **Open extension folder** button opens the correct folder for you.

The connector queries tabs in **all browser windows**, including windows on other virtual desktops. Install it once per browser profile. The app and extension communicate only over `127.0.0.1:17349`; the desktop app needs to be running for tabs to appear.

## Remote control

Open **Remote control** in the sidebar to copy the webhook URL and Bearer token. The authenticated API listens on `127.0.0.1:17350` by default; enable **Allow local network** to accept commands from another device. See the [complete remote API reference](docs/REMOTE_API.md) for endpoints, action schemas, examples, CSV export, and errors. The documentation is also included with the Windows installer.

Use the sidebar to filter by watch status, priority, or tag. Use **Group by** to organize the visible tabs. In **Folders**, create folders and drag tabs between them or reorder tabs and folders; tabs outside a folder appear in **Unfiled**. Deleting a folder moves its tabs to Unfiled. Click **Export CSV** to save all open tabs in folder order, with their URLs, watched state, priority, and tags. Click a title or thumbnail to switch to that browser tab. Watch status can be changed manually and is also marked automatically when a video reaches 80% playback. Labels and folders are saved locally in the Electron app's user-data folder. Folder placements follow a tab through app restarts, and restored browser tabs are matched by browser profile and URL.

To create a Windows installer, run `npm run dist`. The unpacked browser connector is included with the installer.
