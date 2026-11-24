// Actual App; simulated IPC for deterministic UI lifecycle assertions only.
const events = new Map<string, Set<(value: any) => void>>();
const terminals = new Map<string, any>();
const emit = (name: string, value: any) => events.get(name)?.forEach(callback => callback(value));
const subscribe = (name: string) => (callback: (value: any) => void) => {
  const listeners = events.get(name) || new Set();
  listeners.add(callback); events.set(name, listeners);
  return () => {listeners.delete(callback);};
};
const ssh = (target: string, startedAt = Date.now() - 5000) => ({
  pid: target === 'production-alias' ? 200 : 300, target, configuredHost: 'server.example.test', remoteHostname: null,
  user: 'developer', port: 2222, jumpHost: 'jump.example.test',
  endpoint: null, transportEndpoint: {address: '2001:db8:0:0:0:0:0:1', port: 22},
  configStatus: 'static', routing: 'proxy', status: 'unknown',
  statusDetail: 'TCP established; authentication unknown', startedAt, durationKind: 'observed-process',
});
const harness = {provider: 'custom', name: 'Remote Harness', model: 'local/test-model', modelSource: 'reported',
  status: 'ready', activitySource: 'reported', pid: null, startedAt: Date.now() - 9000};
Object.assign(window, {
  sshTest: {
    terminals: () => [...terminals.values()], command: (command: string) => emit('command', command),
    ssh: (id: string, target: string | null, startedAt?: number) => emit('ssh', {id, ssh: target ? ssh(target, startedAt) : null}),
    agent: (id: string, active: boolean) => emit('agent', {id, agent: active ? harness : null}),
  },
  desktop: {
    updateState: async () => ({status: 'idle', dismissed: true}),
    onUpdateState: subscribe('updates'),
    info: async () => ({home: '/home/test', cwd: '/projects/test', shell: '/bin/bash', shells: ['/bin/bash'], platform: 'linux', hostname: 'local-machine', username: 'test', version: '0.4.0'}),
    setAppearance: () => {}, droppedFilePaths: () => [], reportTerminalView: () => {},
    createTerminal: async (options: any) => {
      const terminal = {...options, pid: 100 + terminals.size}; terminals.set(options.id, terminal);
      setTimeout(() => emit('ssh', {id: options.id, ssh: ssh('production-alias')}), 200);
      return terminal;
    },
    write: () => {}, resize: () => {}, closeTerminal: async (id: string) => {terminals.delete(id);},
    navigate: async () => {}, onData: subscribe('data'), onCwd: subscribe('cwd'), onExit: subscribe('exit'),
    onAgent: subscribe('agent'), onSsh: subscribe('ssh'), onFilesChanged: subscribe('files'), onCommand: subscribe('command'),
    listFiles: async (cwd: string) => ({cwd, parent: '/projects', entries: [], total: 0}), gitInfo: async () => null,
    chooseFolder: async () => null, openExternal: async () => {}, windowAction: () => {},
  },
});
await import('../../src/main');
export {};
