/* ============================================================
   SPARK ENGINE — Window Manager
   Create, manage, group, and control BrowserWindows
   ============================================================ */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const DEFAULT_WINDOW_OPTS = {
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    roundedCorners: true,
};

class WindowManager {
    constructor(bus) {
        this._bus = bus;
        this._windows = new Map();
        this._groups = new Map();
        this._idCounter = 0;

        this._init();
    }

    _init() {
        this._bus.on('app:window-all-closed', () => {
            if (process.platform !== 'darwin') this._bus.emit('wm:all-closed');
        });
    }

    _genId() { return `win_${++this._idCounter}`; }

    create(opts = {}) {
        const id = opts.id || this._genId();
        const config = { ...DEFAULT_WINDOW_OPTS, ...opts };

        if (opts.preload) {
            config.webPreferences = { ...config.webPreferences, preload: opts.preload };
        }
        if (opts.icon) {
            config.icon = opts.icon;
        }

        const win = new BrowserWindow(config);

        const entry = {
            id,
            window: win,
            config,
            createdAt: Date.now(),
            visible: false,
            bounds: null,
        };

        win.once('ready-to-show', () => {
            entry.visible = true;
            if (!opts.hidden) win.show();
            this._bus.emit('wm:window-ready', id, win);
        });

        win.on('show', () => { entry.visible = true; this._bus.emit('wm:window-show', id, win); });
        win.on('hide', () => { entry.visible = false; this._bus.emit('wm:window-hide', id, win); });

        win.on('close', (e) => {
            this._bus.emit('wm:window-close', id, e);
            if (opts.onClose) opts.onClose(e);
        });

        win.on('closed', () => {
            this._bus.emit('wm:window-closed', id);
            this._windows.delete(id);
        });

        win.on('focus', () => this._bus.emit('wm:window-focus', id, win));
        win.on('blur', () => this._bus.emit('wm:window-blur', id, win));
        win.on('maximize', () => this._bus.emit('wm:window-maximize', id, win));
        win.on('unmaximize', () => this._bus.emit('wm:window-unmaximize', id, win));
        win.on('minimize', () => this._bus.emit('wm:window-minimize', id, win));
        win.on('restore', () => this._bus.emit('wm:window-restore', id, win));

        win.on('resize', () => {
            const bounds = win.getBounds();
            entry.bounds = bounds;
            this._bus.emit('wm:window-resize', id, bounds);
        });

        this._windows.set(id, entry);

        if (opts.url) win.loadURL(opts.url);
        else if (opts.file) win.loadFile(opts.file);

        return { id, window: win };
    }

    get(id) {
        return this._windows.get(id)?.window || null;
    }

    getEntry(id) {
        return this._windows.get(id) || null;
    }

    getAll() {
        return Array.from(this._windows.entries()).map(([id, e]) => ({ id, window: e.window }));
    }

    getAllByGroup(group) {
        return Array.from(this._windows.entries())
            .filter(([, e]) => e.group === group)
            .map(([id, e]) => ({ id, window: e.window }));
    }

    focus(id) {
        const win = this.get(id);
        if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    }

    close(id) {
        const win = this.get(id);
        if (win && !win.isDestroyed()) win.close();
    }

    hide(id) {
        const win = this.get(id);
        if (win && !win.isDestroyed()) win.hide();
    }

    show(id) {
        const win = this.get(id);
        if (win && !win.isDestroyed()) win.show();
    }

    minimize(id) {
        const win = this.get(id);
        if (win) win.minimize();
    }

    maximize(id) {
        const win = this.get(id);
        if (win) {
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
        }
    }

    center(id) {
        const win = this.get(id);
        if (win) win.center();
    }

    setSize(id, width, height) {
        const win = this.get(id);
        if (win) win.setSize(width, height);
    }

    setBounds(id, bounds) {
        const win = this.get(id);
        if (win) win.setBounds(bounds);
    }

    setTitle(id, title) {
        const win = this.get(id);
        if (win) win.setTitle(title);
    }

    setAlwaysOnTop(id, flag) {
        const win = this.get(id);
        if (win) win.setAlwaysOnTop(flag);
    }

    setFullScreen(id, flag) {
        const win = this.get(id);
        if (win) win.setFullScreen(flag);
    }

    loadURL(id, url) {
        const win = this.get(id);
        if (win) win.loadURL(url);
    }

    loadFile(id, file) {
        const win = this.get(id);
        if (win) win.loadFile(file);
    }

    webContents(id) {
        const win = this.get(id);
        return win?.webContents || null;
    }

    send(id, channel, ...args) {
        const wc = this.webContents(id);
        if (wc) wc.send(channel, ...args);
    }

    broadcast(channel, ...args) {
        this._windows.forEach(({ window: win }) => {
            if (!win.isDestroyed()) win.webContents.send(channel, ...args);
        });
    }

    createGroup(name, ids) {
        this._groups.set(name, [...ids]);
    }

    closeGroup(name) {
        const ids = this._groups.get(name);
        if (ids) { ids.forEach(id => this.close(id)); this._groups.delete(name); }
    }

    hideGroup(name) {
        const ids = this._groups.get(name);
        if (ids) ids.forEach(id => this.hide(id));
    }

    showGroup(name) {
        const ids = this._groups.get(name);
        if (ids) ids.forEach(id => this.show(id));
    }

    focusGroup(name) {
        const ids = this._groups.get(name);
        if (ids) ids.forEach(id => this.focus(id));
    }

    get primaryDisplay() {
        return screen.getPrimaryDisplay();
    }

    getCursorScreenPoint() {
        return screen.getCursorScreenPoint();
    }
}

module.exports = { WindowManager };
