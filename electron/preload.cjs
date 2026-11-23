const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('app:info'),
  setAppearance: theme => ipcRenderer.send('app:appearance', theme),
  createTerminal: options => ipcRenderer.invoke('terminal:create', options),
  write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  closeTerminal: id => ipcRenderer.invoke('terminal:close', id),
  navigate: (id, directory) => ipcRenderer.invoke('terminal:navigate', { id, directory }),
  onData: callback => subscribe('terminal:data', callback),
  onCwd: callback => subscribe('terminal:cwd', callback),
  onExit: callback => subscribe('terminal:exit', callback),
  onAgent: callback => subscribe('terminal:agent', callback),
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
