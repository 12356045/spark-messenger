/* ============================================================
   SPARK ENGINE — Preload Bridge
   Exposes safe APIs to renderer via contextBridge
   ============================================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('SparkEngine', {
    version: '2.0.2',

    // ─── IPC ────────────────────────────────────────────────
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, fn) => {
        const handler = (event, ...args) => fn(...args);
        ipcRenderer.on(channel, handler);
        return () => ipcRenderer.removeListener(channel, handler);
    },
    once: (channel, fn) => {
        ipcRenderer.once(channel, (event, ...args) => fn(...args));
    },

    // ─── Window control (renderer-side) ─────────────────────
    window: {
        minimize: () => ipcRenderer.send('window:minimize'),
        maximize: () => ipcRenderer.send('window:maximize'),
        close: () => ipcRenderer.send('window:close'),
        hide: () => ipcRenderer.send('window:hide'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    },

    // ─── System ─────────────────────────────────────────────
    platform: process.platform,
    arch: process.arch,

    clipboard: {
        readText: () => ipcRenderer.invoke('clipboard:readText'),
        writeText: (text) => ipcRenderer.send('clipboard:writeText', text),
    },

    shell: {
        openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    },

    // ─── Store ──────────────────────────────────────────────
    store: {
        get: (key, fallback) => ipcRenderer.invoke('store:get', key, fallback),
        set: (key, value) => ipcRenderer.invoke('store:set', key, value),
        remove: (key) => ipcRenderer.invoke('store:remove', key),
        has: (key) => ipcRenderer.invoke('store:has', key),
        clear: () => ipcRenderer.invoke('store:clear'),
        getAll: () => ipcRenderer.invoke('store:getAll'),
    },

    // ─── Notifications ──────────────────────────────────────
    notify: {
        show: (opts) => ipcRenderer.invoke('notif:show', opts),
        requestPermission: () => ipcRenderer.invoke('notif:requestPermission'),
    },

    // ─── Dialogs ────────────────────────────────────────────
    dialog: {
        open: (opts) => ipcRenderer.invoke('dialog:open', opts),
        save: (opts) => ipcRenderer.invoke('dialog:save', opts),
        message: (opts) => ipcRenderer.invoke('dialog:message', opts),
        confirm: (title, message) => ipcRenderer.invoke('dialog:confirm', title, message),
    },

    // ─── App info ───────────────────────────────────────────
    app: {
        getVersion: () => ipcRenderer.invoke('app:getVersion'),
        getName: () => ipcRenderer.invoke('app:getName'),
        getPath: (name) => ipcRenderer.invoke('app:getPath', name),
        isDarkMode: () => ipcRenderer.invoke('app:isDarkMode'),
        getLocale: () => ipcRenderer.invoke('app:getLocale'),
        quit: () => ipcRenderer.send('app:quit'),
        relaunch: () => ipcRenderer.send('app:relaunch'),
    },

    // ─── Updater ────────────────────────────────────────────
    updater: {
        checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
        downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
        quitAndInstall: () => ipcRenderer.send('updater:quitAndInstall'),
    },
});
