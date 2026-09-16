const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const DeviceBridge = require('./device');
const Store = require('./store');

let mainWindow;
let device;
let store;

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 620,
    title: 'Ghost Mode',
    backgroundColor: '#f7f5ed',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 20, y: 14 } }
      : { titleBarOverlay: { color: '#f7f5ed', symbolColor: '#213e32', height: 36 } }
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  device = new DeviceBridge();
  store = new Store(app);
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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

ipcMain.handle('device:check-itunes', async () => {
  try {
    return await device.checkiTunes();
  } catch (err) {
    return { installed: false, error: err.message };
  }
});

ipcMain.handle('device:check-devmode', async () => {
  try {
    return await device.checkDevMode();
  } catch (err) {
    return { enabled: false, error: err.message };
  }
});

ipcMain.handle('device:enable-devmode', async () => {
  try {
    return await device.enableDevMode();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('device:start-tunnel', async () => {
  try {
    return await device.startTunnel();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('device:start-tunnel-elevated', async () => {
  try {
    return await device.startTunnelElevated();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('device:auto-mount', async () => {
  try {
    return await device.autoMount();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('device:set-rsd', (_event, host, port) => {
  device.setRsd(host, port);
  return { ok: true, host, port };
});

ipcMain.handle('device:has-rsd', () => {
  return { hasRsd: device.hasRsd(), host: device.rsdHost, port: device.rsdPort };
});

ipcMain.handle('device:set-location', async (_event, lat, lng) => {
  try {
    return await device.setLocation(lat, lng);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('device:travel-to', async (_event, lat, lng) => {
  try {
    // Set up progress callback to send to renderer
    device._onTravelProgress = (curLat, curLng, progress) => {
      mainWindow.webContents.send('travel-progress', { lat: curLat, lng: curLng, progress });
    };
    const result = await device.travelTo(lat, lng);
    device._onTravelProgress = null;
    return result;
  } catch (err) {
    device._onTravelProgress = null;
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
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&dedupe=1&addressdetails=1`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GhostMode/1.0' }
  });
  return response.json();
});

ipcMain.handle('reverse-geocode', async (_event, lat, lng) => {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
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
