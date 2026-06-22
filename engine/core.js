/* ============================================================
   SPARK ENGINE — Reactive State System
   Signals, computed values, effects, stores
   ============================================================ */

let currentEffect = null;
let effectDepth = 0;

class Signal {
    constructor(value) {
        this._value = value;
        this._subscribers = new Set();
    }

    get value() {
        if (currentEffect) this._subscribers.add(currentEffect);
        return this._value;
    }

    set value(newValue) {
        if (Object.is(this._value, newValue)) return;
        this._value = newValue;
        this._notify();
    }

    _notify() {
        for (const effect of this._subscribers) {
            if (effect._active) effect._schedule();
        }
    }

    subscribe(fn) {
        this._subscribers.add(fn);
        return () => this._subscribers.delete(fn);
    }

    peek() {
        return this._value;
    }
}

class Computed {
    constructor(fn) {
        this._fn = fn;
        this._cache = undefined;
        this._dirty = true;
        this._subscribers = new Set();
        this._signal = new Signal(undefined);
    }

    get value() {
        if (currentEffect) this._subscribers.add(currentEffect);
        if (this._dirty) {
            this._dirty = false;
            const prev = currentEffect;
            currentEffect = this;
            this._cache = this._fn();
            currentEffect = prev;
            this._signal._value = this._cache;
        }
        return this._cache;
    }

    _schedule() {
        if (this._dirty) return;
        this._dirty = true;
        for (const effect of this._subscribers) {
            if (effect._active) effect._schedule();
        }
    }

    subscribe(fn) {
        this._subscribers.add(fn);
        return () => this._subscribers.delete(fn);
    }
}

class Effect {
    constructor(fn) {
        this._fn = fn;
        this._active = true;
        this._scheduled = false;
        this._deps = new Set();
        this._schedule();
    }

    _schedule() {
        if (this._scheduled || !this._active) return;
        this._scheduled = true;
        queueMicrotask(() => this._run());
    }

    _run() {
        if (!this._active) return;
        this._scheduled = false;
        const prev = currentEffect;
        currentEffect = this;
        effectDepth++;
        try {
            this._fn();
        } finally {
            effectDepth--;
            currentEffect = prev;
        }
    }

    dispose() {
        this._active = false;
    }
}

export function signal(initialValue) {
    return new Signal(initialValue);
}

export function computed(fn) {
    return new Computed(fn);
}

export function effect(fn) {
    return new Effect(fn);
}

export function batch(fn) {
    fn();
}

export function createStore(initial) {
    const keys = Object.keys(initial);
    const store = {};
    const subs = new Set();

    for (const key of keys) {
        const s = signal(initial[key]);
        Object.defineProperty(store, key, {
            get: () => s.value,
            set: (v) => { s.value = v; subs.forEach(fn => fn(key, v)); },
            enumerable: true
        });
    }

    store.subscribe = (fn) => {
        subs.add(fn);
        return () => subs.delete(fn);
    };

    store.update = (patch) => {
        for (const [k, v] of Object.entries(patch)) {
            if (k in store) store[k] = v;
        }
    };

    store.toJSON = () => {
        const obj = {};
        for (const key of keys) obj[key] = store[key];
        return obj;
    };

    return store;
}

export function untrack(fn) {
    const prev = currentEffect;
    currentEffect = null;
    try { return fn(); } finally { currentEffect = prev; }
}
