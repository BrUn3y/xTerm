// Real App with a simulated desktop bridge for deterministic async race tests.
const events = new Map<string, Set<(event: any) => void>>();
const terminals = new Map<string, {id: string; cwd: string; shell: string; pid: number}>();
const pending: {cwd: string; resolve(value: any): void; reject(error: Error): void}[] = [];
const emit = (name: string, value: any) => events.get(name)?.forEach(callback => callback(value));
const subscribe = (name: string) => (callback: (value: any) => void) => {
  const listeners = events.get(name) || new Set();
  listeners.add(callback); events.set(name, listeners);
  return () => {listeners.delete(callback);};
};
const info = {home: '/home/test', cwd: '/projects/alpha', shell: '/bin/bash', shells: ['/bin/bash'],
  platform: 'linux', hostname: 'test', username: 'test', version: '0.4.0'};
let manual = false, nextFolder = '';
const repository = (cwd: string) => cwd === '/projects/plain' ? null : {
  owner: 'test-owner', repo: cwd.split('/').pop(), url: `https://github.com/test-owner/${cwd.split('/').pop()}`,
};
const git = (cwd: string) => ({branch: 'main', changed: 0, github: repository(cwd)});
const external: string[] = [];
Object.assign(window, {
  githubTest: {
    terminals: () => [...terminals.values()],
    cwd: (id: string, cwd: string) => {const terminal = terminals.get(id)!; terminal.cwd = cwd; emit('cwd', {id, cwd});},
    folder: (cwd: string) => {nextFolder = cwd;},
    manual: (value: boolean) => {manual = value;},
    pending: () => pending.map(item => item.cwd),
    resolve: (cwd: string) => {for (let index = pending.length - 1; index >= 0; index--) if (pending[index].cwd === cwd) pending.splice(index, 1)[0].resolve(git(cwd));},
    reject: () => {pending.splice(0).forEach(item => item.reject(new Error('Unavailable')));},
    refresh: (cwd: string) => emit('files', {cwd}),
    command: (command: string) => emit('command', command),
    external: () => external,
  },
  desktop: {
    info: async () => info, setAppearance: () => {}, droppedFilePaths: () => [], reportTerminalView: () => {},
    createTerminal: async (options: any) => {const terminal = {...options, pid: 100 + terminals.size}; terminals.set(options.id, terminal); return terminal;},
    write: () => {}, resize: () => {}, closeTerminal: async (id: string) => {terminals.delete(id);},
    navigate: async (id: string, cwd: string) => {terminals.get(id)!.cwd = cwd; emit('cwd', {id, cwd});},
    onData: subscribe('data'), onCwd: subscribe('cwd'), onExit: subscribe('exit'),
    onAgent: subscribe('agent'), onSsh: subscribe('ssh'), onFilesChanged: subscribe('files'), onCommand: subscribe('command'),
    listFiles: async (cwd: string) => ({cwd, parent: '/projects', entries: [], total: 0}),
    gitInfo: (cwd: string) => manual ? new Promise((resolve, reject) => pending.push({cwd, resolve, reject})) : Promise.resolve(git(cwd)),
    chooseFolder: async () => nextFolder || null, openExternal: async (url: string) => {external.push(url);},
    windowAction: () => {},
  },
});
await import('../../src/main');
export {};
