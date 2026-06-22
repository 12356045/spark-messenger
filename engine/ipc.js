/* ============================================================
   SPARK ENGINE — IPC Manager
   Register/handle IPC channels between main and renderer
   ============================================================ */

const { ipcMain } = require('electron');

class IpcManager {
    constructor(bus) {
        this._bus = bus;
        this._handlers = new Map();
        this._onceHandlers = new Map();
    }

    handle(channel, handler) {
        if (this._handlers.has(channel)) {
            ipcMain.removeHandler(channel);
        }
        ipcMain.handle(channel, async (event, ...args) => {
            this._bus.emit('ipc:invoke', channel, args);
            try {
                const result = await handler(event, ...args);
                return { ok: true, data: result };
            } catch (e) {
                return { ok: false, error: e.message || String(e) };
            }
        });
        this._handlers.set(channel, handler);
    }

    once(channel, handler) {
        if (this._onceHandlers.has(channel)) {
            ipcMain.removeHandler(channel);
        }
        ipcMain.once(channel, (event, ...args) => {
            handler(event, ...args);
            this._onceHandlers.delete(channel);
        });
        this._onceHandlers.set(channel, handler);
    }

    on(channel, handler) {
        ipcMain.on(channel, (event, ...args) => {
            handler(event, ...args);
        });
    }

    removeHandler(channel) {
        ipcMain.removeHandler(channel);
        this._handlers.delete(channel);
    }

    removeAll() {
        this._handlers.forEach((_, ch) => ipcMain.removeHandler(ch));
        this._handlers.clear();
        this._onceHandlers.clear();
    }

    sendTo(webContents, channel, ...args) {
        if (webContents && !webContents.isDestroyed()) {
            webContents.send(channel, ...args);
        }
    }

    broadcast(channel, ...args) {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, ...args);
            }
        });
    }
}

module.exports = { IpcManager };
