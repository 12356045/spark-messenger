/* ============================================================
   SPARK ENGINE — App Menu
   Native application menu builder
   ============================================================ */

const { Menu, shell } = require('electron');

class MenuManager {
    constructor(bus) {
        this._bus = bus;
        this._menus = new Map();
    }

    setApplicationMenu(template) {
        const menu = Menu.buildFromTemplate(this._buildTemplate(template));
        Menu.setApplicationMenu(menu);
    }

    _buildTemplate(template) {
        return template.map(item => {
            const built = {};

            if (item.separator) return { type: 'separator' };

            if (item.label) built.label = item.label;
            if (item.type) built.type = item.type;
            if (item.role) built.role = item.role;
            if (item.accelerator) built.accelerator = item.accelerator;
            if (item.checked !== undefined) built.checked = item.checked;
            if (item.enabled !== undefined) built.enabled = item.enabled;

            if (item.click) {
                built.click = (menuItem, browserWindow, event) => {
                    item.click(menuItem, browserWindow, event);
                };
            }

            if (item.submenu) {
                built.submenu = this._buildTemplate(item.submenu);
            }

            return built;
        });
    }

    createContextMenu(template) {
        return Menu.buildFromTemplate(this._buildTemplate(template));
    }

    showContextMenu(template) {
        const menu = this.createContextMenu(template);
        menu.popup();
        return menu;
    }

    buildDefaultMenu(options = {}) {
        const { appName = 'SparkApp', showAbout = true } = options;

        return this.setApplicationMenu([
            {
                label: appName,
                submenu: [
                    ...(showAbout ? [{ label: `О ${appName}`, role: 'about' }, { separator: true }] : []),
                    {
                        label: 'Настройки',
                        accelerator: 'CmdOrCtrl+,',
                        click: (win) => { if (win) win.webContents.send('menu:settings'); },
                    },
                    { separator: true },
                    { label: 'Скрыть', role: 'hide' },
                    { label: 'Скрыть остальные', role: 'hideOthers' },
                    { label: 'Показать все', role: 'unhide' },
                    { separator: true },
                    { label: 'Выход', role: 'quit' },
                ],
            },
            {
                label: 'Редактирование',
                submenu: [
                    { label: 'Отменить', role: 'undo' },
                    { label: 'Повторить', role: 'redo' },
                    { separator: true },
                    { label: 'Вырезать', role: 'cut' },
                    { label: 'Копировать', role: 'copy' },
                    { label: 'Вставить', role: 'paste' },
                    { label: 'Выбрать все', role: 'selectAll' },
                ],
            },
            {
                label: 'Вид',
                submenu: [
                    { label: 'Перезагрузить', role: 'reload' },
                    { label: 'Принудительная перезагрузка', role: 'forceReload' },
                    { label: 'Инструменты разработчика', role: 'toggleDevTools' },
                    { separator: true },
                    { label: 'Полный экран', role: 'togglefullscreen' },
                    { separator: true },
                    { label: 'Уменьшить', role: 'minimize' },
                    { label: 'Масштабировать', role: 'zoom' },
                ],
            },
            {
                label: 'Окно',
                submenu: [
                    { label: 'Свернуть', role: 'minimize' },
                    { label: 'Закрыть', role: 'close' },
                ],
            },
            {
                label: 'Справка',
                submenu: [
                    {
                        label: 'Открыть на GitHub',
                        click: () => { shell.openExternal(options.repoUrl || 'https://github.com'); },
                    },
                ],
            },
        ]);
    }
}

module.exports = { MenuManager };
