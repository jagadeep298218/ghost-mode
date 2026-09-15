const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {
  // Device
  checkStatus: () => ipcRenderer.invoke('device:status'),
  startTunnel: () => ipcRenderer.invoke('device:start-tunnel'),
  setRsd: (host, port) => ipcRenderer.invoke('device:set-rsd', host, port),
  hasRsd: () => ipcRenderer.invoke('device:has-rsd'),
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
