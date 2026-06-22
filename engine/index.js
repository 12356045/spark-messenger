/* ============================================================
   SPARK ENGINE v2.0
   Node.js App Engine for Electron — Main Process
   All modules are optional — missing ones won't crash the app.
   ============================================================ */

function tryRequire(mod) {
    try { return require(mod); } catch (e) { return null; }
}

const appMod = tryRequire('./app');
const windowMod = tryRequire('./window');
const trayMod = tryRequire('./tray');
const ipcMod = tryRequire('./ipc');
const storeMod = tryRequire('./store');
const menuMod = tryRequire('./menu');
const notifyMod = tryRequire('./notify');
const updaterMod = tryRequire('./updater');

module.exports = {
    version: '2.0.2',
    SparkApp: appMod?.SparkApp || null,
    EventBus: appMod?.EventBus || null,
    Config: appMod?.Config || null,
    LifeCycle: appMod?.LifeCycle || null,
    WindowManager: windowMod?.WindowManager || null,
    TrayManager: trayMod?.TrayManager || null,
    IpcManager: ipcMod?.IpcManager || null,
    Store: storeMod?.Store || null,
    MenuManager: menuMod?.MenuManager || null,
    NotifyManager: notifyMod?.NotifyManager || null,
    Updater: updaterMod?.Updater || null,
};
