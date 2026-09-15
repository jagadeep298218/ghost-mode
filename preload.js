const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {});
