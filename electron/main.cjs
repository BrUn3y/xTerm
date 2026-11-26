const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, clipboard, powerMonitor, powerSaveBlocker } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const {createSessionManager, folder} = require('./sessions.cjs');
const {RemoteMode} = require('./remote.cjs');
const {toDataURL} = require('qrcode');
const {listDirectory, fileDetails, resolveLink} = require('./files.cjs');
const {gitInfo} = require('./git.cjs');
let window;
let agentPoll;
const send = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };
const sessions = createSessionManager({
  send, defaultCwd: () => app.isPackaged ? os.homedir() : process.cwd(), version: () => app.getVersion(),
});

const remote = new RemoteMode({
  sessions, notify: state => send('remote:state', state),
  assets: path.join(__dirname, '../dist/remote'),
  power: {start: () => powerSaveBlocker.start('prevent-app-suspension'), stop: id => powerSaveBlocker.stop(id)},
});

function closeWorkspace() {
  remote.stop();
  sessions.destroyAll();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 620,
    title: 'xTerm', backgroundColor: '#f3f2ed', titleBarStyle: 'hidden',
    show: process.env.XTERM_START_HIDDEN !== '1',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png'),
    trafficLightPosition: { x: 21, y: 21 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) closeWorkspace();
  });
  window.webContents.on('render-process-gone', closeWorkspace);
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.XTERM_DEV_URL;
    if (allowed ? !url.startsWith(allowed + '/') : !url.startsWith('file://')) event.preventDefault();
  });
  if (process.env.XTERM_DEV_URL) window.loadURL(process.env.XTERM_DEV_URL);
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
  window.on('closed', () => { window = null; closeWorkspace(); });
}

ipcMain.handle('app:info', () => ({
  home: os.homedir(), cwd: app.isPackaged ? os.homedir() : process.cwd(),
  shell: process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'),
  platform: process.platform, hostname: os.hostname().split('.')[0], username: os.userInfo().username,
  version: app.getVersion(), shells: process.platform === 'win32' ? ['powershell.exe', 'cmd.exe'] : ['/bin/zsh', '/bin/bash'].filter(fs.existsSync),
}));
ipcMain.on('app:appearance', (_event, theme) => {
  if (theme !== 'light' && theme !== 'dark') return;
  nativeTheme.themeSource = theme;
  if (window && !window.isDestroyed()) window.setBackgroundColor(theme === 'dark' ? '#20221f' : '#f3f2ed');
});
ipcMain.handle('clipboard:read-text', () => clipboard.readText());
ipcMain.handle('terminal:create', (_event, options) => sessions.create(options));
ipcMain.on('terminal:write', (_event, {id, data, response}) => sessions.write(id, data, null, response === true));
ipcMain.on('terminal:clear', (_event, id) => sessions.clear(id));
ipcMain.on('terminal:view', (_event, {id, lines}) => sessions.reportView(id, lines));
ipcMain.on('terminal:resize', (_event, {id, cols, rows}) => sessions.resize(id, cols, rows));
ipcMain.handle('terminal:close', (_event, id) => sessions.destroySession(id));
ipcMain.handle('terminal:navigate', (_event, {id, directory}) => sessions.navigate(id, directory));
ipcMain.handle('terminal:open-editor', (_event, {id, file}) => sessions.openEditor(id, file));
ipcMain.handle('terminal:save-editor', (_event, {id, file}) => sessions.saveEditor(id, file));
ipcMain.handle('remote:state', () => remote.state());
ipcMain.handle('remote:start', (_event, options) => remote.start(options));
ipcMain.handle('remote:stop', () => remote.stop());
ipcMain.handle('remote:regenerate', () => remote.regenerate());
ipcMain.handle('remote:revoke', () => remote.revoke());
ipcMain.handle('remote:share', (_event, id) => remote.share(id));
ipcMain.handle('remote:remove', (_event, id) => remote.remove(id));
ipcMain.handle('remote:take-control', (_event, id) => sessions.setController(id, null));
ipcMain.handle('remote:qr', (_event, link) => {
  if (remote.state().invitation?.link !== link || typeof link !== 'string') return null;
  return toDataURL(link, {width: 252, margin: 4, errorCorrectionLevel: 'M'});
});
ipcMain.handle('files:list', async (_event, directory) => {
  const cwd = await folder(directory);
  return listDirectory(cwd);
});
ipcMain.handle('files:details', (_event, value) => fileDetails(value));
ipcMain.handle('files:resolve-link', (_event, value) => resolveLink(value));
ipcMain.handle('files:choose', async () => {
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: 'Open folder in xTerm', buttonLabel: 'Open folder' });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('files:reveal', async (_event, value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return;
  await fsp.access(value); shell.showItemInFolder(value);
});
ipcMain.handle('git:info', async (_event, directory) => {
  try {
    return await gitInfo(await folder(directory));
  } catch { return null; }
});
ipcMain.handle('app:external', async (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
});
ipcMain.on('window:action', (_event, action) => {
  if (!window) return;
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
  if (action === 'close') window.close();
});

app.whenReady().then(() => {
  powerMonitor.on('resume', () => remote.tick());
  agentPoll = setInterval(() => void sessions.refreshAgents(), 900);
  agentPoll.unref();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'xTerm', submenu: [{ role: 'about', label: 'About xTerm' }, { type: 'separator' }, { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => send('app:command', 'settings') }, { type: 'separator' }, { role: 'hide', label: 'Hide xTerm' }, { role: 'hideOthers', label: 'Hide Others' }, { role: 'unhide', label: 'Show All' }, { type: 'separator' }, { role: 'quit', label: 'Quit xTerm' }] }] : []),
    { label: 'Shell', submenu: [
      { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => send('app:command', 'new-tab') },
      { label: 'Split pane', accelerator: 'CmdOrCtrl+D', click: () => send('app:command', 'split') },
      { label: 'Close session', accelerator: 'CmdOrCtrl+W', click: () => send('app:command', 'close-tab') },
      { label: 'Open folder…', accelerator: 'CmdOrCtrl+O', click: () => send('app:command', 'open-folder') },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo', label: 'Undo' }, { role: 'redo', label: 'Redo' }, { type: 'separator' }, { role: 'cut', label: 'Cut' }, { role: 'copy', label: 'Copy' }, { role: 'paste', label: 'Paste' }, { role: 'selectAll', label: 'Select All' }] },
    { label: 'View', submenu: [{ label: 'Search terminal', accelerator: 'CmdOrCtrl+F', click: () => send('app:command', 'search') }, { label: 'Command palette', accelerator: 'CmdOrCtrl+K', click: () => send('app:command', 'palette') }, { role: 'togglefullscreen', label: 'Toggle Full Screen' }, { role: 'toggleDevTools', label: 'Toggle Developer Tools' }] },
    { label: 'Window', submenu: [{ role: 'minimize', label: 'Minimize' }, { role: 'zoom', label: 'Zoom' }, { role: 'front', label: 'Bring All to Front' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { clearInterval(agentPoll); closeWorkspace(); });
