/* ============================================================
   SPARK ENGINE — System Tray
   Tray management, context menus, tooltip
   ============================================================ */

const { Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');

class TrayManager {
    constructor(bus) {
        this._bus = bus;
        this._trays = new Map();
        this._idCounter = 0;
    }

    _genId() { return `tray_${++this._idCounter}`; }

    create(opts = {}) {
        const id = opts.id || this._genId();
        const iconPath = opts.icon || path.join(__dirname, '..', 'icon.png');

        let icon;
        try { icon = nativeImage.createFromPath(iconPath); } catch (e) {
            icon = nativeImage.createEmpty();
        }

        const tray = new Tray(icon);

        if (opts.tooltip) tray.setToolTip(opts.tooltip);

        const entry = { id, tray, opts, createdAt: Date.now() };
        this._trays.set(id, entry);

        if (opts.menu) this.setContextMenu(id, opts.menu);

        tray.on('click', (e) => {
            this._bus.emit('tray:click', id, e);
            if (opts.onClick) opts.onClick(e);
        });

        tray.on('double-click', (e) => {
            this._bus.emit('tray:double-click', id, e);
            if (opts.onDoubleClick) opts.onDoubleClick(e);
        });

        tray.on('right-click', (e) => {
            this._bus.emit('tray:right-click', id, e);
            if (opts.onRightClick) opts.onRightClick(e);
        });

        tray.on('balloon-click', () => {
            this._bus.emit('tray:balloon-click', id);
        });

        tray.on('mouse-enter', () => this._bus.emit('tray:mouse-enter', id));
        tray.on('mouse-leave', () => this._bus.emit('tray:mouse-leave', id));

        return { id, tray };
    }

    get(id) {
        return this._trays.get(id)?.tray || null;
    }

    setTooltip(id, tooltip) {
        const entry = this._trays.get(id);
        if (entry) entry.tray.setToolTip(tooltip);
    }

    setImage(id, iconPath) {
        const entry = this._trays.get(id);
        if (entry) {
            try {
                const icon = nativeImage.createFromPath(iconPath);
                entry.tray.setImage(icon);
            } catch (e) {}
        }
    }

    setContextMenu(id, template) {
        const entry = this._trays.get(id);
        if (!entry) return;

        const menu = Menu.buildFromTemplate(template.map(item => {
            if (item.separator) return { type: 'separator' };
            return {
                label: item.label,
                type: item.type || 'normal',
                checked: item.checked || false,
                enabled: item.enabled !== false,
                click: item.click ? () => item.click(id) : undefined,
            };
        }));

        entry.tray.setContextMenu(menu);
    }

    displayBalloon(id, opts) {
        const entry = this._trays.get(id);
        if (entry) {
            entry.tray.displayBalloon({
                title: opts.title || '',
                content: opts.content || '',
                icon: opts.icon ? nativeImage.createFromPath(opts.icon) : undefined,
                silent: opts.silent || false,
            });
        }
    }

    destroy(id) {
        const entry = this._trays.get(id);
        if (entry) {
            entry.tray.destroy();
            this._trays.delete(id);
        }
    }

    destroyAll() {
        this._trays.forEach(({ tray }) => tray.destroy());
        this._trays.clear();
    }
}

module.exports = { TrayManager };
