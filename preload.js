const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {
  platform: process.platform,
  openExternal: (url) => shell.openExternal(url),
  // Setup
  checkiTunes: () => ipcRenderer.invoke('device:check-itunes'),
  checkDevMode: () => ipcRenderer.invoke('device:check-devmode'),
  enableDevMode: () => ipcRenderer.invoke('device:enable-devmode'),

  // Device
  checkStatus: () => ipcRenderer.invoke('device:status'),
  startTunnel: () => ipcRenderer.invoke('device:start-tunnel'),
  startTunnelElevated: () => ipcRenderer.invoke('device:start-tunnel-elevated'),
  autoMount: () => ipcRenderer.invoke('device:auto-mount'),
  setRsd: (host, port) => ipcRenderer.invoke('device:set-rsd', host, port),
  hasRsd: () => ipcRenderer.invoke('device:has-rsd'),
  setLocation: (lat, lng) => ipcRenderer.invoke('device:set-location', lat, lng),
  travelTo: (lat, lng) => ipcRenderer.invoke('device:travel-to', lat, lng),
  onTravelProgress: (callback) => ipcRenderer.on('travel-progress', (_event, data) => callback(data)),
  clearLocation: () => ipcRenderer.invoke('device:clear-location'),

  // Geocoding
  geocode: (query) => ipcRenderer.invoke('geocode', query),
  reverseGeocode: (lat, lng) => ipcRenderer.invoke('reverse-geocode', lat, lng),

  // Store
  getHome: () => ipcRenderer.invoke('store:get-home'),
  setHome: (lat, lng, label) => ipcRenderer.invoke('store:set-home', lat, lng, label),
  getFavorites: () => ipcRenderer.invoke('store:get-favorites'),
  addFavorite: (lat, lng, label) => ipcRenderer.invoke('store:add-favorite', lat, lng, label),
  removeFavorite: (index) => ipcRenderer.invoke('store:remove-favorite', index)
});
