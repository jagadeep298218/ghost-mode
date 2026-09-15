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
