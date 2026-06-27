const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    windowMinimize: () => ipcRenderer.send('window:minimize'),
    windowMaximize: () => ipcRenderer.send('window:maximize'),
    windowClose: () => ipcRenderer.send('window:close'),
    windowHide: () => ipcRenderer.send('window:hide'),
    windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    getScreenSources: () => ipcRenderer.invoke('screen:getSources'),
    isElectron: true,
});
