/* ============================================================
   SPARK ENGINE — Auto Updater
   Check for updates, download and install
   ============================================================ */

let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    // electron-updater is optional
}

const { app } = require('electron');

class Updater {
    constructor(bus, options = {}) {
        this._bus = bus;
        this._available = !!autoUpdater;

        if (!autoUpdater) {
            console.warn('[Updater] electron-updater not installed, updater disabled');
            return;
        }

        this._options = {
            provider: options.provider || 'generic',
            url: options.url || '',
            autoDownload: options.autoDownload !== false,
            autoInstallOnAppQuit: options.autoInstallOnAppQuit !== false,
            ...options,
        };

        autoUpdater.autoDownload = this._options.autoDownload;
        autoUpdater.autoInstallOnAppQuit = this._options.autoInstallOnAppQuit;

        this._init();
    }

    _init() {
        autoUpdater.on('checking-for-update', () => {
            this._bus.emit('updater:checking');
        });

        autoUpdater.on('update-available', (info) => {
            this._bus.emit('updater:available', info);
        });

        autoUpdater.on('update-not-available', (info) => {
            this._bus.emit('updater:not-available', info);
        });

        autoUpdater.on('error', (err) => {
            this._bus.emit('updater:error', err);
        });

        autoUpdater.on('download-progress', (progress) => {
            this._bus.emit('updater:progress', progress);
        });

        autoUpdater.on('update-downloaded', (info) => {
            this._bus.emit('updater:downloaded', info);
        });
    }

    async checkForUpdates() {
        if (!autoUpdater) return null;
        try {
            return await autoUpdater.checkForUpdates();
        } catch (e) {
            this._bus.emit('updater:error', e);
            return null;
        }
    }

    async downloadUpdate() {
        if (!autoUpdater) return;
        try {
            await autoUpdater.downloadUpdate();
        } catch (e) {
            this._bus.emit('updater:error', e);
        }
    }

    quitAndInstall() {
        if (autoUpdater) autoUpdater.quitAndInstall();
    }

    setFeedURL(url) {
        if (autoUpdater) autoUpdater.setFeedURL({ provider: 'generic', url });
    }
}

module.exports = { Updater };
