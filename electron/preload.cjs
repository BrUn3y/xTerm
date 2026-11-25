const { contextBridge, ipcRenderer, webUtils } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('app:info'),
  setAppearance: theme => ipcRenderer.send('app:appearance', theme),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  droppedFilePaths: files => Array.from(files).slice(0,100).map(file => webUtils.getPathForFile(file)).filter(Boolean),
  reportTerminalView: (id, lines) => ipcRenderer.send('terminal:view', {id,lines}),
  createTerminal: options => ipcRenderer.invoke('terminal:create', options),
  write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
  respond: (id, data) => ipcRenderer.send('terminal:write', {id, data, response: true}),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  clearTerminal: id => ipcRenderer.send('terminal:clear', id),
  closeTerminal: id => ipcRenderer.invoke('terminal:close', id),
  navigate: (id, directory) => ipcRenderer.invoke('terminal:navigate', { id, directory }),
  onData: callback => subscribe('terminal:data', callback),
  onCwd: callback => subscribe('terminal:cwd', callback),
  onExit: callback => subscribe('terminal:exit', callback),
  onAgent: callback => subscribe('terminal:agent', callback),
  onSsh: callback => subscribe('terminal:ssh', callback),
  onControl: callback => subscribe('terminal:control', callback),
  remote: {
    state: () => ipcRenderer.invoke('remote:state'),
    start: options => ipcRenderer.invoke('remote:start', options),
    stop: () => ipcRenderer.invoke('remote:stop'),
    regenerate: () => ipcRenderer.invoke('remote:regenerate'),
    revoke: () => ipcRenderer.invoke('remote:revoke'),
    share: id => ipcRenderer.invoke('remote:share', id),
    remove: id => ipcRenderer.invoke('remote:remove', id),
    takeControl: id => ipcRenderer.invoke('remote:take-control', id),
    qr: link => ipcRenderer.invoke('remote:qr', link),
    onState: callback => subscribe('remote:state', callback),
  },
  onFilesChanged: callback => subscribe('files:changed', callback),
  onCommand: callback => subscribe('app:command', callback),
  listFiles: directory => ipcRenderer.invoke('files:list', directory),
  fileDetails: value => ipcRenderer.invoke('files:details', value),
  resolveLink: value => ipcRenderer.invoke('files:resolve-link', value),
  chooseFolder: () => ipcRenderer.invoke('files:choose'),
  revealFile: value => ipcRenderer.invoke('files:reveal', value),
  gitInfo: directory => ipcRenderer.invoke('git:info', directory),
  openExternal: url => ipcRenderer.invoke('app:external', url),
  windowAction: action => ipcRenderer.send('window:action', action),
});
