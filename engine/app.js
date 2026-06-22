/* ============================================================
   SPARK ENGINE — App Core
   Application lifecycle, EventBus, Config manager
   ============================================================ */

const { app, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── EventBus ───────────────────────────────────────────────

class EventBus {
    constructor() {
        this._listeners = new Map();
        this._onceListeners = new Map();
    }

    on(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(fn);
        return () => this.off(event, fn);
    }

    once(event, fn) {
        if (!this._onceListeners.has(event)) this._onceListeners.set(event, new Set());
        this._onceListeners.get(event).add(fn);
    }

    off(event, fn) {
        this._listeners.get(event)?.delete(fn);
        this._onceListeners.get(event)?.delete(fn);
    }

    emit(event, ...args) {
        const listeners = this._listeners.get(event);
        const once = this._onceListeners.get(event);
        if (listeners) listeners.forEach(fn => { try { fn(...args); } catch (e) { console.error(`[EventBus] Error in "${event}":`, e); } });
        if (once) { once.forEach(fn => { try { fn(...args); } catch (e) { console.error(`[EventBus] once error in "${event}":`, e); } }); this._onceListeners.delete(event); }
    }

    removeAll(event) {
        if (event) { this._listeners.delete(event); this._onceListeners.delete(event); }
        else { this._listeners.clear(); this._onceListeners.clear(); }
    }
}

// ─── Config Manager ─────────────────────────────────────────

class Config {
    constructor(defaults = {}) {
        this._path = path.join(app.getPath('userData'), 'config.json');
        this._data = { ...defaults };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._path)) {
                const raw = fs.readFileSync(this._path, 'utf-8');
                this._data = { ...this._data, ...JSON.parse(raw) };
            }
        } catch (e) { console.warn('[Config] Load error:', e.message); }
    }

    _save() {
        try {
            const dir = path.dirname(this._path);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
        } catch (e) { console.warn('[Config] Save error:', e.message); }
    }

    get(key, fallback) {
        return key in this._data ? this._data[key] : fallback;
    }

    set(key, value) {
        this._data[key] = value;
        this._save();
    }

    remove(key) {
        delete this._data[key];
        this._save();
    }

    getAll() {
        return { ...this._data };
    }

    clear() {
        this._data = {};
        this._save();
    }
}

// ─── LifeCycle ──────────────────────────────────────────────

class LifeCycle {
    constructor(bus) {
        this._bus = bus;
        this._ready = false;
        this._hooks = { beforeQuit: [], afterQuit: [], windowAllClosed: [] };
    }

    onBeforeQuit(fn) { this._hooks.beforeQuit.push(fn); }
    onAfterQuit(fn) { this._hooks.afterQuit.push(fn); }
    onWindowAllClosed(fn) { this._hooks.windowAllClosed.push(fn); }

    async _runBeforeQuit() {
        for (const fn of this._hooks.beforeQuit) { try { await fn(); } catch (e) { console.error('[LifeCycle] beforeQuit error:', e); } }
    }

    async _runAfterQuit() {
        for (const fn of this._hooks.afterQuit) { try { await fn(); } catch (e) { console.error('[LifeCycle] afterQuit error:', e); } }
    }
}

// ─── App (Main Engine Core) ─────────────────────────────────

class SparkApp {
    constructor(options = {}) {
        this.bus = new EventBus();
        this.config = new Config(options.config || {});
        this.lifecycle = new LifeCycle(this.bus);
        this.version = options.version || '2.0.2';
        this.name = options.name || 'SparkApp';

        this._init();
    }

    _init() {
        app.on('ready', () => {
            this._ready = true;
            this.bus.emit('app:ready');
        });

        app.on('window-all-closed', () => {
            this.bus.emit('app:window-all-closed');
            this.lifecycle._runBeforeQuit().then(() => {
                if (process.platform !== 'darwin') app.quit();
            });
        });

        app.on('activate', () => {
            this.bus.emit('app:activate');
        });

        app.on('before-quit', (e) => {
            this.bus.emit('app:before-quit', e);
        });

        app.on('will-quit', (e) => {
            this.bus.emit('app:will-quit', e);
            this.lifecycle._runAfterQuit();
        });

        app.on('second-instance', (e, argv) => {
            this.bus.emit('app:second-instance', argv);
        });

        nativeTheme.on('updated', () => {
            this.bus.emit('app:theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
        });
    }

    get isReady() { return this._ready; }
    get isDarkMode() { return nativeTheme.shouldUseDarkColors; }
    get platform() { return process.platform; }
    get isMac() { return process.platform === 'darwin'; }
    get isWindows() { return process.platform === 'win32'; }
    get isLinux() { return process.platform === 'linux'; }

    async whenReady() {
        if (this._ready) return;
        return new Promise(resolve => { this.bus.once('app:ready', resolve); });
    }

    quit() { app.quit(); }
    relaunch(opts) { app.relaunch(opts); }
    getPath(name) { return app.getPath(name); }
    setPath(name, p) { app.setPath(name, p); }
    getVersion() { return app.getVersion(); }
    getName() { return app.getName(); }

    async requestSingleInstanceLock() {
        const gotLock = app.requestSingleInstanceLock();
        if (!gotLock) { app.quit(); return false; }
        return true;
    }
}

module.exports = { SparkApp, EventBus, Config, LifeCycle };
