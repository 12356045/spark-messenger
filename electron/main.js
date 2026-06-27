const path = require('path');
const { app, clipboard, shell, dialog, nativeTheme, desktopCapturer } = require('electron');
const { SparkApp, WindowManager, TrayManager, IpcManager, Store, MenuManager, NotifyManager } = require('../engine');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch(e) {}

// ─── Initialize Engine ──────────────────────────────────────

const spark = new SparkApp({
    name: 'SPARK',
    version: '2.2.0',
    config: {
        windowBounds: { width: 1200, height: 800 },
        darkMode: true,
    },
});

app.name = 'SPARK';

const wm = new WindowManager(spark.bus);
const tray = new TrayManager(spark.bus);
const ipc = new IpcManager(spark.bus);
const store = new Store('spark-engine');
const menu = new MenuManager(spark.bus);
const notify = new NotifyManager(spark.bus);

const PRELOAD_PATH = path.join(__dirname, 'preload.js');

function getIconPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'icon.ico');
    }
    return path.join(__dirname, '..', 'icon.ico');
}

function getIconPathPng() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'icon.png');
    }
    return path.join(__dirname, '..', 'icon.png');
}

const ICON_PATH = process.platform === 'win32' ? getIconPath() : getIconPathPng();

// ─── Register IPC Handlers ─────────────────────────────────

function registerIpcHandlers() {
    // Window control
    ipc.on('window:minimize', (event) => {
        const win = require('electron').BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
    });
    ipc.on('window:maximize', (event) => {
        const win = require('electron').BrowserWindow.fromWebContents(event.sender);
        if (win) { win.isMaximized() ? win.unmaximize() : win.maximize(); }
    });
    ipc.on('window:close', (event) => {
        const win = require('electron').BrowserWindow.fromWebContents(event.sender);
        if (win) win.close();
    });
    ipc.on('window:hide', (event) => {
        const win = require('electron').BrowserWindow.fromWebContents(event.sender);
        if (win) win.hide();
    });
    ipc.handle('window:isMaximized', (event) => {
        const win = require('electron').BrowserWindow.fromWebContents(event.sender);
        return win?.isMaximized() || false;
    });

    // Clipboard
    ipc.handle('clipboard:readText', () => clipboard.readText());
    ipc.on('clipboard:writeText', (_, text) => clipboard.writeText(text));

    // Shell
    ipc.on('shell:openExternal', (_, url) => shell.openExternal(url));

    // Store
    ipc.handle('store:get', (_, key, fallback) => store.get(key, fallback));
    ipc.handle('store:set', (_, key, value) => store.set(key, value));
    ipc.handle('store:remove', (_, key) => store.remove(key));
    ipc.handle('store:has', (_, key) => store.has(key));
    ipc.handle('store:clear', () => store.clear());
    ipc.handle('store:getAll', () => store.getAll());

    // Notifications
    ipc.handle('notif:show', (_, opts) => {
        const result = notify.show(opts);
        return result ? { id: result.id } : null;
    });
    ipc.handle('notif:requestPermission', () => notify.requestPermission());

    // Dialogs
    ipc.handle('dialog:open', async (_, opts) => {
        const result = await dialog.showOpenDialog(opts);
        return result;
    });
    ipc.handle('dialog:save', async (_, opts) => {
        const result = await dialog.showSaveDialog(opts);
        return result;
    });
    ipc.handle('dialog:message', async (_, opts) => {
        const result = await dialog.showMessageBox(opts);
        return result;
    });
    ipc.handle('dialog:confirm', async (_, title, message) => {
        const result = await dialog.showMessageBox({
            type: 'question',
            title,
            message,
            buttons: ['Да', 'Нет'],
            defaultId: 0,
            cancelId: 1,
        });
        return result.response === 0;
    });

    // App info
    ipc.handle('app:getVersion', () => app.getVersion());
    ipc.handle('app:getName', () => app.getName());
    ipc.handle('app:getPath', (_, name) => app.getPath(name));
    ipc.handle('app:isDarkMode', () => nativeTheme.shouldUseDarkColors);
    ipc.handle('app:getLocale', () => app.getLocale());
    ipc.on('app:quit', () => app.quit());
    ipc.on('app:relaunch', () => app.relaunch({ args: process.argv.slice(1) }));

    // Screen sharing via desktopCapturer
    ipc.handle('screen:getSources', async () => {
        try {
            const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
            return sources.map(s => ({ id: s.id, name: s.name, thumbnailDataURL: s.thumbnail.toDataURL() }));
        } catch(e) {
            console.error('[ScreenShare]', e.message);
            return [];
        }
    });

    // Auto-updater
    if (autoUpdater) {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        ipc.handle('updater:checkForUpdates', async () => {
            try { return await autoUpdater.checkForUpdates(); } catch(e) { return null; }
        });
        ipc.handle('updater:downloadUpdate', async () => {
            try { await autoUpdater.downloadUpdate(); } catch(e) {}
        });
        ipc.on('updater:quitAndInstall', () => { autoUpdater.quitAndInstall(); });
        autoUpdater.on('update-available', () => {
            if (mainWindow) mainWindow.webContents.send('updater:update-available');
        });
        autoUpdater.on('update-downloaded', () => {
            if (mainWindow) mainWindow.webContents.send('updater:update-downloaded');
        });
        autoUpdater.on('error', (err) => {
            console.error('[Updater]', err.message);
        });
    }
}

// ─── Main Window ───────────────────────────────────────────

let mainWindow = null;

function createMainWindow() {
    const bounds = store.get('windowBounds', { width: 1200, height: 800 });

    mainWindow = wm.create({
        id: 'main',
        width: bounds.width,
        height: bounds.height,
        minWidth: 800,
        minHeight: 600,
        title: 'SPARK',
        icon: ICON_PATH,
        backgroundColor: '#0a0a14',
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 16, y: 16 },
        preload: PRELOAD_PATH,
        file: path.join(__dirname, '..', 'index.html'),
        onClose: (e) => {
            // Save bounds before close
            if (mainWindow && !mainWindow.isDestroyed()) {
                store.set('windowBounds', mainWindow.getBounds());
            }
            mainWindow = null;
        },
    }).window;

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.setTitle('SPARK');
        mainWindow.webContents.send('app:ready', {
            version: spark.version,
            platform: process.platform,
            isDarkMode: nativeTheme.shouldUseDarkColors,
        });
    });

    mainWindow.webContents.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media' || permission === 'display-capture' || permission === 'screen-capture') {
            callback(true);
        } else {
            callback(false);
        }
    });

    return mainWindow;
}

// ─── Tray ──────────────────────────────────────────────────

function createTray() {
    return tray.create({
        id: 'main-tray',
        icon: ICON_PATH,
        tooltip: 'SPARK',
        onClick: () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) mainWindow.hide();
                else { mainWindow.show(); mainWindow.focus(); }
            }
        },
        menu: [
            { label: 'Открыть SPARK', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
            { separator: true },
            { label: 'Выход', click: () => app.quit() },
        ],
    });
}

// ─── App Menu ──────────────────────────────────────────────

function createAppMenu() {
    menu.buildDefaultMenu({
        appName: 'SPARK',
        repoUrl: 'https://github.com/12356045/spark-messenger',
    });
}

// ─── Engine Events ─────────────────────────────────────────

spark.bus.on('app:ready', () => {
    console.log('[SPARK Engine] App ready');
});

spark.bus.on('app:second-instance', (argv) => {
    console.log('[SPARK Engine] Second instance:', argv);
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

spark.bus.on('app:theme-changed', (theme) => {
    console.log('[SPARK Engine] Theme changed:', theme);
    if (mainWindow) mainWindow.webContents.send('app:theme-changed', theme);
});

spark.bus.on('wm:window-resize', (id, bounds) => {
    if (id === 'main') store.set('windowBounds', bounds);
});

// ─── Start ─────────────────────────────────────────────────

spark.whenReady().then(async () => {
    registerIpcHandlers();
    createMainWindow();
    createTray();
    createAppMenu();

    console.log('[SPARK Engine] v2.0.5 started');
    console.log('[SPARK Engine] Platform:', process.platform);
    console.log('[SPARK Engine] Node:', process.versions.node);
    console.log('[SPARK Engine] Electron:', process.versions.electron);

    if (autoUpdater && app.isPackaged) {
        setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
