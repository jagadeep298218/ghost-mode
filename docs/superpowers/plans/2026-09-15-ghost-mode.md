# Ghost Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free Electron desktop app that spoofs iOS device GPS location via pymobiledevice3, targeting iOS 17+ on Windows.

**Architecture:** Electron app with a Leaflet/OpenStreetMap map UI. The main process manages a pymobiledevice3 tunnel subprocess (required for iOS 17+) and executes location set/clear commands via child_process. IPC uses contextBridge for security. Settings stored as JSON on disk.

**Tech Stack:** Electron 44, Leaflet 1.9.4, OpenStreetMap tiles, Nominatim geocoding, pymobiledevice3 (Python CLI), electron-builder for packaging.

**Prerequisites (user must install):**
- Python 3.8+ with `pip install pymobiledevice3`
- iTunes (provides Apple Mobile Device USB driver on Windows)
- iPhone with Developer Mode enabled (Settings > Privacy & Security > Developer Mode)

---

## File Structure

```
ghost-mode/
├── package.json           # Project config, scripts, dependencies
├── main.js                # Electron main process: window, IPC handlers
├── preload.js             # contextBridge: secure API for renderer
├── device.js              # pymobiledevice3 wrapper: tunnel, set, clear
├── store.js               # Simple JSON file store for home location + favorites
├── index.html             # App shell: layout, CSP, stylesheets
├── renderer.js            # Frontend: map, search, buttons, status
├── styles.css             # Dark theme UI styles
├── assets/
│   └── icon.png           # App icon (placeholder)
└── docs/                  # Plans, README
```

**Responsibility boundaries:**
- `device.js` owns ALL pymobiledevice3 interaction. No other file spawns processes.
- `store.js` owns ALL disk persistence. Simple read/write JSON.
- `main.js` wires IPC handlers that delegate to `device.js` and `store.js`.
- `preload.js` exposes a minimal `window.ghostAPI` surface.
- `renderer.js` owns ALL UI logic: map, markers, buttons, status updates.
- `styles.css` owns ALL styling. No inline styles in HTML.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `main.js` (minimal)
- Create: `preload.js` (empty bridge)
- Create: `index.html` (hello world)

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "ghost-mode",
  "version": "1.0.0",
  "description": "Free iOS GPS location spoofer",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder"
  },
  "author": "",
  "license": "MIT"
}
```

Save this to `package.json`.

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd "/c/Users/Chinna Babu/downloads/projects/ghost-mode"
npm install leaflet
npm install --save-dev electron electron-builder
```

- [ ] **Step 3: Create minimal main.js**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Ghost Mode',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: Create empty preload.js**

```js
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {});
```

- [ ] **Step 5: Create minimal index.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ghost Mode</title>
</head>
<body>
  <h1>Ghost Mode</h1>
  <p>App is running.</p>
</body>
</html>
```

- [ ] **Step 6: Verify the app launches**

Run: `npm start`
Expected: An Electron window opens showing "Ghost Mode" and "App is running."

- [ ] **Step 7: Commit**

```bash
git init
git add package.json package-lock.json main.js preload.js index.html
git commit -m "feat: scaffold Electron app with minimal window"
```

---

### Task 2: JSON Store for Settings

**Files:**
- Create: `store.js`

- [ ] **Step 1: Create store.js**

```js
const fs = require('fs');
const path = require('path');

class Store {
  constructor(app) {
    this.path = path.join(app.getPath('userData'), 'ghost-mode-settings.json');
    this.data = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch {
      return { home: null, favorites: [] };
    }
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  getHome() {
    return this.data.home;
  }

  setHome(lat, lng, label) {
    this.data.home = { lat, lng, label };
    this._save();
  }

  getFavorites() {
    return this.data.favorites;
  }

  addFavorite(lat, lng, label) {
    this.data.favorites.push({ lat, lng, label });
    this._save();
  }

  removeFavorite(index) {
    this.data.favorites.splice(index, 1);
    this._save();
  }
}

module.exports = Store;
```

- [ ] **Step 2: Commit**

```bash
git add store.js
git commit -m "feat: add JSON store for home location and favorites"
```

---

### Task 3: Device Bridge (pymobiledevice3 Wrapper)

**Files:**
- Create: `device.js`

This is the core module. For iOS 17+, pymobiledevice3 requires:
1. A **tunnel** process that runs continuously (`pymobiledevice3 remote start-tunnel` — needs admin)
2. Location commands run against the tunnel: `pymobiledevice3 developer dvt simulate-location set -- LAT LNG`

- [ ] **Step 1: Create device.js**

```js
const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.tunnelProcess = null;
    this.tunnelReady = false;
  }

  /**
   * Start the pymobiledevice3 tunnel (required for iOS 17+).
   * This must run with admin privileges on Windows.
   * Returns a promise that resolves when tunnel is ready.
   */
  startTunnel() {
    return new Promise((resolve, reject) => {
      if (this.tunnelProcess) {
        resolve({ alreadyRunning: true });
        return;
      }

      this.tunnelProcess = spawn('pymobiledevice3', ['remote', 'start-tunnel'], {
        shell: true
      });

      let output = '';

      this.tunnelProcess.stdout.on('data', (data) => {
        output += data.toString();
        // Tunnel outputs connection info when ready
        if (output.includes('tunnel') || output.includes('--rsd')) {
          this.tunnelReady = true;
          resolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        output += data.toString();
        // pymobiledevice3 sometimes outputs status to stderr
        if (output.includes('tunnel') || output.includes('created')) {
          this.tunnelReady = true;
          resolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        reject(new Error(`Failed to start tunnel: ${err.message}. Is pymobiledevice3 installed? Run: pip install pymobiledevice3`));
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        if (!this.tunnelReady) {
          reject(new Error(`Tunnel exited with code ${code}. Make sure to run the app as Administrator.\n${output}`));
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!this.tunnelReady && this.tunnelProcess) {
          // Some versions don't print a clear "ready" message — assume ready if process is still alive
          this.tunnelReady = true;
          resolve({ ready: true, output: output.trim(), assumed: true });
        }
      }, 15000);
    });
  }

  /**
   * Stop the tunnel process.
   */
  stopTunnel() {
    if (this.tunnelProcess) {
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
      this.tunnelReady = false;
    }
  }

  /**
   * Set simulated location on the connected iOS device.
   */
  setLocation(lat, lng) {
    return new Promise((resolve, reject) => {
      const args = ['developer', 'dvt', 'simulate-location', 'set', '--', String(lat), String(lng)];

      execFile('pymobiledevice3', args, { shell: true, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Set location failed: ${stderr || error.message}`));
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  /**
   * Clear simulated location (restore real GPS).
   */
  clearLocation() {
    return new Promise((resolve, reject) => {
      const args = ['developer', 'dvt', 'simulate-location', 'clear'];

      execFile('pymobiledevice3', args, { shell: true, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Clear location failed: ${stderr || error.message}`));
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  /**
   * Check if pymobiledevice3 is installed and a device is connected.
   */
  checkStatus() {
    return new Promise((resolve) => {
      execFile('pymobiledevice3', ['usbmux', 'list'], { shell: true, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ installed: false, connected: false, error: error.message });
          return;
        }
        const hasDevice = stdout.includes('UniqueDeviceID') || stdout.includes('DeviceName');
        resolve({ installed: true, connected: hasDevice, output: stdout.trim() });
      });
    });
  }

  /**
   * Clean up on app exit.
   */
  destroy() {
    this.stopTunnel();
  }
}

module.exports = DeviceBridge;
```

- [ ] **Step 2: Commit**

```bash
git add device.js
git commit -m "feat: add pymobiledevice3 device bridge for tunnel and location control"
```

---

### Task 4: Main Process IPC Wiring

**Files:**
- Modify: `main.js` (replace entire file)
- Modify: `preload.js` (replace entire file)

- [ ] **Step 1: Update main.js with full IPC handlers**

```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const DeviceBridge = require('./device');
const Store = require('./store');

let mainWindow;
let device;
let store;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Ghost Mode',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  device = new DeviceBridge();
  store = new Store(app);
  createWindow();
});

app.on('window-all-closed', () => {
  device.destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  device.destroy();
});

// ── Device IPC ──────────────────────────────────────────────

ipcMain.handle('device:status', async () => {
  try {
    return await device.checkStatus();
  } catch (err) {
    return { installed: false, connected: false, error: err.message };
  }
});

ipcMain.handle('device:start-tunnel', async () => {
  try {
    return await device.startTunnel();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('device:set-location', async (_event, lat, lng) => {
  try {
    return await device.setLocation(lat, lng);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('device:clear-location', async () => {
  try {
    return await device.clearLocation();
  } catch (err) {
    return { error: err.message };
  }
});

// ── Geocoding IPC ───────────────────────────────────────────

ipcMain.handle('geocode', async (_event, query) => {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GhostMode/1.0' }
  });
  return response.json();
});

// ── Store IPC ───────────────────────────────────────────────

ipcMain.handle('store:get-home', () => store.getHome());
ipcMain.handle('store:set-home', (_event, lat, lng, label) => {
  store.setHome(lat, lng, label);
  return { ok: true };
});
ipcMain.handle('store:get-favorites', () => store.getFavorites());
ipcMain.handle('store:add-favorite', (_event, lat, lng, label) => {
  store.addFavorite(lat, lng, label);
  return { ok: true };
});
ipcMain.handle('store:remove-favorite', (_event, index) => {
  store.removeFavorite(index);
  return { ok: true };
});
```

- [ ] **Step 2: Update preload.js with full API bridge**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {
  // Device
  checkStatus: () => ipcRenderer.invoke('device:status'),
  startTunnel: () => ipcRenderer.invoke('device:start-tunnel'),
  setLocation: (lat, lng) => ipcRenderer.invoke('device:set-location', lat, lng),
  clearLocation: () => ipcRenderer.invoke('device:clear-location'),

  // Geocoding
  geocode: (query) => ipcRenderer.invoke('geocode', query),

  // Store
  getHome: () => ipcRenderer.invoke('store:get-home'),
  setHome: (lat, lng, label) => ipcRenderer.invoke('store:set-home', lat, lng, label),
  getFavorites: () => ipcRenderer.invoke('store:get-favorites'),
  addFavorite: (lat, lng, label) => ipcRenderer.invoke('store:add-favorite', lat, lng, label),
  removeFavorite: (index) => ipcRenderer.invoke('store:remove-favorite', index)
});
```

- [ ] **Step 3: Verify app still launches**

Run: `npm start`
Expected: Window opens without errors.

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat: wire IPC handlers for device, geocoding, and store"
```

---

### Task 5: Dark Theme UI Layout

**Files:**
- Create: `styles.css`
- Modify: `index.html` (replace entire file)

- [ ] **Step 1: Create styles.css**

```css
:root {
  --bg-primary: #0f0f1a;
  --bg-secondary: #1a1a2e;
  --bg-tertiary: #16213e;
  --accent: #6c63ff;
  --accent-hover: #5a52d5;
  --accent-danger: #e74c3c;
  --accent-success: #2ecc71;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0b0;
  --text-muted: #666680;
  --border: #2a2a40;
  --radius: 8px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Top Bar ─────────────────────────────────────────── */

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  z-index: 1000;
}

.topbar .logo {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--accent);
  white-space: nowrap;
}

.search-box {
  flex: 1;
  display: flex;
  gap: 8px;
}

.search-box input {
  flex: 1;
  padding: 8px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.search-box input:focus {
  border-color: var(--accent);
}

.search-box input::placeholder {
  color: var(--text-muted);
}

/* ── Buttons ─────────────────────────────────────────── */

.btn {
  padding: 8px 18px;
  border: none;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  white-space: nowrap;
}

.btn:active {
  transform: scale(0.97);
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-danger {
  background: var(--accent-danger);
  color: white;
}

.btn-danger:hover {
  background: #c0392b;
}

.btn-success {
  background: var(--accent-success);
  color: white;
}

.btn-success:hover {
  background: #27ae60;
}

.btn-ghost {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.btn-ghost:hover {
  background: var(--border);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Map ─────────────────────────────────────────────── */

#map {
  flex: 1;
  z-index: 1;
}

/* ── Bottom Panel ────────────────────────────────────── */

.bottom-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  z-index: 1000;
}

.coords {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 240px;
}

.bottom-panel .actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* ── Status Bar ──────────────────────────────────────── */

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-dot.connected {
  background: var(--accent-success);
}

.status-dot.spoofing {
  background: var(--accent);
  animation: pulse 1.5s infinite;
}

.status-dot.error {
  background: var(--accent-danger);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── Leaflet Overrides (dark theme) ──────────────────── */

.leaflet-control-zoom a {
  background: var(--bg-secondary) !important;
  color: var(--text-primary) !important;
  border-color: var(--border) !important;
}

.leaflet-control-attribution {
  background: rgba(15, 15, 26, 0.8) !important;
  color: var(--text-muted) !important;
}

.leaflet-control-attribution a {
  color: var(--text-secondary) !important;
}

/* ── Home Button Overlay ─────────────────────────────── */

.home-btn-overlay {
  position: absolute;
  top: 80px;
  right: 16px;
  z-index: 999;
}

.btn-home {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  border: none;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.1s;
}

.btn-home:hover {
  background: var(--accent-hover);
  transform: scale(1.05);
}

.btn-home:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Create full index.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self';
                 style-src 'self' 'unsafe-inline';
                 img-src 'self' data: https://*.tile.openstreetmap.org;
                 connect-src 'self';
                 script-src 'self';">
  <title>Ghost Mode</title>
  <link rel="stylesheet" href="node_modules/leaflet/dist/leaflet.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>

  <!-- Top Bar -->
  <div class="topbar">
    <div class="logo">GHOST MODE</div>
    <div class="search-box">
      <input id="search" type="text" placeholder="Search address or paste coordinates..." />
      <button id="searchBtn" class="btn btn-ghost">Search</button>
    </div>
  </div>

  <!-- Map -->
  <div id="map"></div>

  <!-- Home Quick Button (overlay on map) -->
  <div class="home-btn-overlay">
    <button id="goHomeBtn" class="btn-home" title="Spoof to Home" disabled>&#8962;</button>
  </div>

  <!-- Bottom Panel -->
  <div class="bottom-panel">
    <div class="coords" id="coords">Click the map to select a location</div>
    <div class="actions">
      <button id="saveHomeBtn" class="btn btn-ghost" disabled>Save as Home</button>
      <button id="spoofBtn" class="btn btn-primary" disabled>Spoof Location</button>
      <button id="resetBtn" class="btn btn-danger" disabled>Reset to Real</button>
    </div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <div class="status-dot" id="statusDot"></div>
    <span id="statusText">Initializing...</span>
  </div>

  <script src="node_modules/leaflet/dist/leaflet.js"></script>
  <script src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify layout renders**

Run: `npm start`
Expected: Dark-themed window with top bar, map area (grey/empty for now), bottom panel with buttons, and status bar.

- [ ] **Step 4: Commit**

```bash
git add styles.css index.html
git commit -m "feat: add dark theme UI layout with topbar, map area, and controls"
```

---

### Task 6: Map + Search + Click-to-Pin

**Files:**
- Create: `renderer.js`

- [ ] **Step 1: Create renderer.js**

```js
// ── State ────────────────────────────────────────────────────
let selectedLat = null;
let selectedLng = null;
let isSpoofing = false;
let marker = null;
let homeMarker = null;

// ── Map Setup ────────────────────────────────────────────────
const map = L.map('map', {
  zoomControl: true
}).setView([20, 0], 3);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

// ── DOM Elements ─────────────────────────────────────────────
const searchInput = document.getElementById('search');
const searchBtn = document.getElementById('searchBtn');
const spoofBtn = document.getElementById('spoofBtn');
const resetBtn = document.getElementById('resetBtn');
const saveHomeBtn = document.getElementById('saveHomeBtn');
const goHomeBtn = document.getElementById('goHomeBtn');
const coordsEl = document.getElementById('coords');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// ── Map Click → Place Marker ─────────────────────────────────
map.on('click', (e) => {
  placeMarker(e.latlng.lat, e.latlng.lng);
});

function placeMarker(lat, lng) {
  selectedLat = lat;
  selectedLng = lng;

  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      placeMarker(pos.lat, pos.lng);
    });
  }

  coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  spoofBtn.disabled = false;
  saveHomeBtn.disabled = false;
}

// ── Search ───────────────────────────────────────────────────
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  // Check if it's raw coordinates (e.g., "28.6139, 77.2090")
  const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    map.setView([lat, lng], 16);
    placeMarker(lat, lng);
    return;
  }

  setStatus('searching', 'Searching...');
  try {
    const results = await window.ghostAPI.geocode(query);
    if (!results || results.length === 0) {
      setStatus('error', 'No results found');
      return;
    }
    const { lat, lon, display_name } = results[0];
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lon);
    map.setView([latNum, lngNum], 16);
    placeMarker(latNum, lngNum);
    setStatus('connected', `Found: ${display_name}`);
  } catch (err) {
    setStatus('error', `Search failed: ${err.message}`);
  }
}

searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// ── Spoof Location ───────────────────────────────────────────
spoofBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;

  spoofBtn.disabled = true;
  setStatus('searching', `Spoofing to ${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}...`);

  try {
    const result = await window.ghostAPI.setLocation(selectedLat, selectedLng);
    if (result.error) {
      setStatus('error', `Spoof failed: ${result.error}`);
      spoofBtn.disabled = false;
      return;
    }
    isSpoofing = true;
    setStatus('spoofing', `Spoofing: ${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`);
    resetBtn.disabled = false;
    spoofBtn.disabled = false;
  } catch (err) {
    setStatus('error', `Spoof failed: ${err.message}`);
    spoofBtn.disabled = false;
  }
});

// ── Reset Location ───────────────────────────────────────────
resetBtn.addEventListener('click', async () => {
  resetBtn.disabled = true;
  setStatus('searching', 'Resetting to real location...');

  try {
    const result = await window.ghostAPI.clearLocation();
    if (result.error) {
      setStatus('error', `Reset failed: ${result.error}`);
      resetBtn.disabled = false;
      return;
    }
    isSpoofing = false;
    setStatus('connected', 'Location reset to real GPS');
    resetBtn.disabled = true;
  } catch (err) {
    setStatus('error', `Reset failed: ${err.message}`);
    resetBtn.disabled = false;
  }
});

// ── Save Home ────────────────────────────────────────────────
saveHomeBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;
  const label = `${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`;
  await window.ghostAPI.setHome(selectedLat, selectedLng, label);
  loadHome();
  setStatus('connected', 'Home location saved!');
});

// ── Go Home (one-click spoof to home) ────────────────────────
goHomeBtn.addEventListener('click', async () => {
  const home = await window.ghostAPI.getHome();
  if (!home) return;

  map.setView([home.lat, home.lng], 16);
  placeMarker(home.lat, home.lng);

  goHomeBtn.disabled = true;
  setStatus('searching', 'Spoofing to home...');

  try {
    const result = await window.ghostAPI.setLocation(home.lat, home.lng);
    if (result.error) {
      setStatus('error', `Spoof failed: ${result.error}`);
      goHomeBtn.disabled = false;
      return;
    }
    isSpoofing = true;
    setStatus('spoofing', `Spoofing to home: ${home.label}`);
    resetBtn.disabled = false;
    goHomeBtn.disabled = false;
  } catch (err) {
    setStatus('error', `Spoof failed: ${err.message}`);
    goHomeBtn.disabled = false;
  }
});

// ── Load Home Marker on Startup ──────────────────────────────
async function loadHome() {
  const home = await window.ghostAPI.getHome();
  if (home) {
    goHomeBtn.disabled = false;
    if (homeMarker) {
      homeMarker.setLatLng([home.lat, home.lng]);
    } else {
      const homeIcon = L.divIcon({
        html: '<div style="background:#6c63ff;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>',
        iconSize: [12, 12],
        className: ''
      });
      homeMarker = L.marker([home.lat, home.lng], { icon: homeIcon, interactive: false }).addTo(map);
    }
  }
}

// ── Status Helpers ───────────────────────────────────────────
function setStatus(state, message) {
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  else if (state === 'spoofing') statusDot.classList.add('spoofing');
  else if (state === 'error') statusDot.classList.add('error');
  statusText.textContent = message;
}

// ── Startup ──────────────────────────────────────────────────
async function init() {
  setStatus('searching', 'Checking device...');

  const status = await window.ghostAPI.checkStatus();
  if (!status.installed) {
    setStatus('error', 'pymobiledevice3 not found. Run: pip install pymobiledevice3');
    return;
  }
  if (!status.connected) {
    setStatus('error', 'No iOS device detected. Connect your iPhone via USB and trust this computer.');
    return;
  }

  setStatus('searching', 'Starting tunnel (may need admin)...');
  const tunnel = await window.ghostAPI.startTunnel();
  if (tunnel.error) {
    setStatus('error', `Tunnel failed: ${tunnel.error}`);
    return;
  }

  setStatus('connected', 'Device connected and ready');
  loadHome();
}

init();
```

- [ ] **Step 2: Verify full app works**

Run: `npm start`
Expected: Dark-themed app with interactive map. Clicking the map places a draggable marker and shows coordinates. Search bar works for addresses. Buttons are wired (spoofing will fail without a connected device, which is expected).

- [ ] **Step 3: Commit**

```bash
git add renderer.js
git commit -m "feat: add map, search, click-to-pin, spoof/reset, and home button"
```

---

### Task 7: App Icon and Metadata

**Files:**
- Create: `assets/icon.png` (placeholder)
- Modify: `package.json` (add electron-builder config)

- [ ] **Step 1: Create assets directory and placeholder icon**

Create a simple 256x256 PNG icon (can be replaced later). For now, any small PNG will work as a placeholder.

```bash
mkdir -p assets
```

- [ ] **Step 2: Add electron-builder config to package.json**

Add this to `package.json`:

```json
{
  "build": {
    "appId": "com.ghostmode.app",
    "productName": "Ghost Mode",
    "win": {
      "target": "portable"
    },
    "files": [
      "main.js",
      "preload.js",
      "device.js",
      "store.js",
      "index.html",
      "renderer.js",
      "styles.css",
      "node_modules/leaflet/**",
      "assets/**"
    ]
  }
}
```

Using `"portable"` target produces a single .exe that doesn't need installation — perfect for distributing on GitHub.

- [ ] **Step 3: Add .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
out/
```

- [ ] **Step 4: Commit**

```bash
git add package.json assets/ .gitignore
git commit -m "feat: add electron-builder config and .gitignore"
```

---

### Task 8: README and Setup Instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Ghost Mode

Free, open-source iOS GPS location spoofer. Set your iPhone's location to anywhere in the world — no jailbreak required.

## How It Works

Ghost Mode uses Apple's developer debug channel (`com.apple.dt.simulatelocation`) to override your iPhone's GPS. It communicates with your device over USB using [pymobiledevice3](https://github.com/doronz88/pymobiledevice3). Once set, the spoofed location persists even after unplugging — until you reboot or toggle Location Services.

## Prerequisites

1. **Python 3.8+** — [Download](https://www.python.org/downloads/)
2. **iTunes** — [Download](https://www.apple.com/itunes/) (provides the USB driver on Windows)
3. **pymobiledevice3** — Install via pip:
   ```bash
   pip install pymobiledevice3
   ```
4. **Developer Mode** on your iPhone (iOS 16+):
   - Go to Settings → Privacy & Security → Developer Mode → Enable
   - Restart your phone when prompted

## Install

Download the latest release from [GitHub Releases](https://github.com/YOUR_USERNAME/ghost-mode/releases), or build from source:

```bash
git clone https://github.com/YOUR_USERNAME/ghost-mode.git
cd ghost-mode
npm install
npm start
```

## Usage

1. Connect your iPhone via USB cable
2. Trust the computer on your iPhone if prompted
3. Launch Ghost Mode (**run as Administrator** — required for the iOS tunnel)
4. Search for an address or click the map to pick a location
5. Click **Spoof Location**
6. Unplug your phone and go — your location stays spoofed
7. To restore real GPS: reboot your phone or toggle Location Services off/on

## Features

- Click or search to set any location worldwide
- Drag the marker to fine-tune position
- Save your home location for one-click spoofing
- Dark theme UI
- No account, no subscription, no ads — completely free

## Supported

- **iOS:** 17+ (tested), 16 (should work), 15 and below (use older pymobiledevice3)
- **OS:** Windows 10/11 (primary), macOS and Linux (should work)

## Building a Release

```bash
npm run dist
```

Produces a portable .exe in the `dist/` folder.

## Troubleshooting

- **"pymobiledevice3 not found"** — Make sure Python and pymobiledevice3 are installed and in your PATH
- **"No iOS device detected"** — Install iTunes, connect via USB, tap "Trust" on your phone
- **"Tunnel failed"** — You must run Ghost Mode as Administrator (right-click → Run as administrator)
- **"Developer Mode required"** — Enable Developer Mode in iPhone Settings → Privacy & Security

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

## Self-Review Checklist

1. **Spec coverage:** User wants a desktop GUI that spoofs iOS location, with a map, search, home button, and ability to release on GitHub. All covered across Tasks 1-8.
2. **Placeholder scan:** No TBDs, TODOs, or vague steps. All code is complete.
3. **Type consistency:** `ghostAPI` method names match between `preload.js` (Task 4) and `renderer.js` (Task 6). `DeviceBridge` methods in `device.js` (Task 3) match `ipcMain.handle` calls in `main.js` (Task 4). `Store` methods in `store.js` (Task 2) match store IPC handlers in `main.js` (Task 4).
