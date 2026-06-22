/* ============================================================
   SPARK ENGINE — Native Notifications
   Cross-platform desktop notifications
   ============================================================ */

const { Notification, nativeImage } = require('electron');
const path = require('path');

class NotifyManager {
    constructor(bus) {
        this._bus = bus;
        this._notifications = new Map();
        this._idCounter = 0;
        this._permission = Notification.isSupported() ? 'granted' : 'denied';
    }

    get isSupported() { return Notification.isSupported(); }
    get permission() { return this._permission; }

    async requestPermission() {
        if (!this.isSupported) { this._permission = 'denied'; return 'denied'; }
        this._permission = 'granted';
        return 'granted';
    }

    show(opts = {}) {
        if (!this.isSupported) return null;

        const id = opts.id || `notif_${++this._idCounter}`;

        let icon;
        if (opts.icon) {
            try { icon = nativeImage.createFromPath(opts.icon); } catch (e) { icon = undefined; }
        }

        const notification = new Notification({
            title: opts.title || 'SPARK',
            body: opts.body || '',
            subtitle: opts.subtitle,
            silent: opts.silent || false,
            icon,
            timeoutType: opts.timeout || 'default',
        });

        notification.on('show', () => this._bus.emit('notif:show', id));
        notification.on('click', () => {
            this._bus.emit('notif:click', id);
            if (opts.onClick) opts.onClick();
        });
        notification.on('close', () => {
            this._bus.emit('notif:close', id);
            this._notifications.delete(id);
            if (opts.onClose) opts.onClose();
        });
        notification.on('action', (e, index) => {
            this._bus.emit('notif:action', id, index);
            if (opts.onAction) opts.onAction(index);
        });

        notification.show();
        this._notifications.set(id, { notification, opts, createdAt: Date.now() });

        return { id, notification };
    }

    close(id) {
        const entry = this._notifications.get(id);
        if (entry) {
            entry.notification.close();
            this._notifications.delete(id);
        }
    }

    closeAll() {
        this._notifications.forEach(({ notification }) => notification.close());
        this._notifications.clear();
    }

    update(id, opts) {
        const entry = this._notifications.get(id);
        if (entry) {
            if (opts.title !== undefined) entry.notification.title = opts.title;
            if (opts.body !== undefined) entry.notification.body = opts.body;
        }
    }
}

module.exports = { NotifyManager };
