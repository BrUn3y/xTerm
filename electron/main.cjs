const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const { createShellIntegration, CwdTracker, quote } = require('./shell.cjs');
const { AgentMonitor, parseProcessTable, findHarness } = require('./agents.cjs');
const {listDirectory, fileDetails, resolveLink} = require('./files.cjs');
const {gitInfo} = require('./git.cjs');
const exec = promisify(execFile);
const sessions = new Map();
let window;
let pollingAgents = false;
let agentPoll;

async function refreshAgents() {
  if (pollingAgents || !sessions.size || process.platform === 'win32') return;
  pollingAgents = true;
  try {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pgid=,tpgid=,stat=,pcpu=,args='], {timeout: 1600, maxBuffer: 4 * 1024 * 1024});
    const processes = parseProcessTable(stdout);
    for (const session of sessions.values()) session.agentMonitor.setProcess(findHarness(session.process.pid, processes));
  } catch { /* Keep existing state on a transient process-list failure. */ }
  finally { pollingAgents = false; }
}

const send = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };
const folder = async value => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('The path must be absolute.');
  const resolved = await fsp.realpath(value);
  if (!(await fsp.stat(resolved)).isDirectory()) throw new Error('The path is not a directory.');
  return resolved;
};

function watchSession(session) {
  session.watcher?.close();
  clearTimeout(session.watchTimer);
  try {
    session.watcher = fs.watch(session.cwd, () => {
      clearTimeout(session.watchTimer);
      session.watchTimer = setTimeout(() => send('files:changed', { id: session.id, cwd: session.cwd }), 180);
    });
    session.watcher.on('error', () => {});
  } catch { /* Remote or inaccessible directories may not support watching. */ }
}
function destroySession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.agentMonitor?.reset();
  session.watcher?.close();
  clearTimeout(session.watchTimer);
  try { session.process.kill(); } catch { /* Already exited. */ }
  try { session.integration.cleanup(); } catch (error) { console.warn('Could not remove the temporary shell directory:', error.code); }
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
    if (isMainFrame && !isInPlace) for (const id of sessions.keys()) destroySession(id);
  });
  window.webContents.on('render-process-gone', () => { for (const id of sessions.keys()) destroySession(id); });
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.XTERM_DEV_URL;
    if (allowed ? !url.startsWith(allowed + '/') : !url.startsWith('file://')) event.preventDefault();
  });
  if (process.env.XTERM_DEV_URL) window.loadURL(process.env.XTERM_DEV_URL);
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
  window.on('closed', () => { for (const id of sessions.keys()) destroySession(id); window = null; });
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
ipcMain.handle('terminal:create', async (_event, options) => {
  if (!options || typeof options.id !== 'string' || !/^[\w-]{1,80}$/.test(options.id) || sessions.has(options.id)) throw new Error('Invalid session.');
  if (sessions.size >= 24) throw new Error('A maximum of 24 sessions can be open.');
  const cwd = await folder(options.cwd || (app.isPackaged ? os.homedir() : process.cwd()));
  const shellPath = options.shell || process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const allowedShells = new Set([process.env.SHELL, '/bin/zsh', '/bin/bash', 'powershell.exe', 'cmd.exe']);
  if (!allowedShells.has(shellPath)) throw new Error('Shell is not available.');
  const integration = createShellIntegration(shellPath);
  try {
    const processPty = pty.spawn(shellPath, integration.args, {
      name: 'xterm-256color', cols: Math.min(500, Math.max(10, options.cols || 100)), rows: Math.min(300, Math.max(3, options.rows || 30)),
      cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'xTerm', TERM_PROGRAM_VERSION: app.getVersion(), ...integration.env },
    });
    const session = { id: options.id, process: processPty, cwd, integration, shell: path.basename(shellPath), atPrompt: path.basename(shellPath) === 'zsh' ? false : null };
    session.agentMonitor = new AgentMonitor(agent => send('terminal:agent', {id: session.id, agent}));
    sessions.set(session.id, session);
    const tracker = new CwdTracker(async newCwd => {
      if (newCwd === session.cwd || !sessions.has(session.id)) return;
      try {
        const valid = await folder(newCwd);
        if (!sessions.has(session.id)) return;
        session.cwd = valid;
        watchSession(session);
        send('terminal:cwd', { id: session.id, cwd: valid });
      } catch { /* The directory may have disappeared between prompts. */ }
    }, atPrompt => { session.atPrompt = atPrompt; if (atPrompt) session.agentMonitor.reset(); });
    processPty.onData(data => { session.agentMonitor.observeOutput(data); tracker.push(data); send('terminal:data', { id: session.id, data }); });
    processPty.onExit(({ exitCode, signal }) => { send('terminal:exit', { id: session.id, exitCode, signal }); destroySession(session.id); });
    watchSession(session);
    return { id: session.id, cwd, shell: session.shell, pid: processPty.pid };
  } catch (error) { integration.cleanup(); throw error; }
});
ipcMain.on('terminal:write', (_event, { id, data }) => {
  if (typeof data === 'string' && data.length <= 1_048_576) {
    const session = sessions.get(id);
    session?.agentMonitor.observeInput(data);
    session?.process.write(data);
  }
});
ipcMain.on('terminal:view', (_event, {id,lines}) => {
  if (Array.isArray(lines) && lines.length <= 8 && lines.every(line=>typeof line === 'string' && line.length <= 1000)) {
    sessions.get(id)?.agentMonitor.observeScreen(lines.join('\n'));
  }
});
ipcMain.on('terminal:resize', (_event, { id, cols, rows }) => {
  if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 500) {
    try { sessions.get(id)?.process.resize(cols, rows); } catch { /* Resized after exit. */ }
  }
});
ipcMain.handle('terminal:close', (_event, id) => destroySession(id));
ipcMain.handle('terminal:navigate', async (_event, { id, directory }) => {
  const session = sessions.get(id);
  if (!session) throw new Error('The session is no longer active.');
  const target = await folder(directory);
  if (session.atPrompt === false) throw new Error('A process is running. Return to the prompt or open another tab to change folders.');
  const command = session.shell === 'powershell.exe' ? `Set-Location -LiteralPath ${quote(target)}` : session.shell === 'cmd.exe' ? `cd /d "${target}"` : `cd -- ${quote(target)}`;
  session.process.write(`\x15${command}\r`);
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
  agentPoll = setInterval(() => void refreshAgents(), 900);
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
app.on('before-quit', () => { clearInterval(agentPoll); for (const id of sessions.keys()) destroySession(id); });
