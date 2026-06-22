/* ============================================================
   SPARK ENGINE — Local Store
   Persistent key-value storage (JSON files in userData)
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
    constructor(name = 'store') {
        this._path = path.join(app.getPath('userData'), `${name}.json`);
        this._data = {};
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._path)) {
                this._data = JSON.parse(fs.readFileSync(this._path, 'utf-8'));
            }
        } catch (e) { console.warn('[Store] Load error:', e.message); }
    }

    _save() {
        try {
            const dir = path.dirname(this._path);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
        } catch (e) { console.warn('[Store] Save error:', e.message); }
    }

    get(key, fallback) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = this._data;
            for (const part of parts) {
                if (obj == null || typeof obj !== 'object') return fallback;
                obj = obj[part];
            }
            return obj !== undefined ? obj : fallback;
        }
        return key in this._data ? this._data[key] : fallback;
    }

    set(key, value) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = this._data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            this._data[key] = value;
        }
        this._save();
        return true;
    }

    has(key) {
        return key in this._data;
    }

    remove(key) {
        delete this._data[key];
        this._save();
    }

    clear() {
        this._data = {};
        this._save();
    }

    keys() {
        return Object.keys(this._data);
    }

    values() {
        return Object.values(this._data);
    }

    entries() {
        return Object.entries(this._data);
    }

    getAll() {
        return { ...this._data };
    }

    size() {
        return Object.keys(this._data).length;
    }

    update(key, fn) {
        const current = this.get(key);
        const next = fn(current);
        this.set(key, next);
        return next;
    }

    getMany(keys) {
        const result = {};
        for (const key of keys) {
            result[key] = this.get(key);
        }
        return result;
    }

    setMany(obj) {
        for (const [key, value] of Object.entries(obj)) {
            this.set(key, value);
        }
    }
}

module.exports = { Store };
