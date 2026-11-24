import type { AgentInfo, Desktop } from '../../src/types';

const listeners = new Set<(event: {id: string; agent: AgentInfo | null}) => void>();
const unsubscribe = () => () => {};
window.desktop = {
  info: async () => ({home: '/home/test', cwd: '/work/xTerm', shell: '/bin/bash',
    platform: 'linux', hostname: 'preview', username: 'test', version: '0.5.0-beta.1',
    shells: ['/bin/bash']}),
  setAppearance: () => {},
  onAgent: callback => {listeners.add(callback); return () => {listeners.delete(callback);};},
  onData: unsubscribe, onCwd: unsubscribe, onExit: unsubscribe,
  onCommand: unsubscribe, onFilesChanged: unsubscribe, onSsh: unsubscribe,
  createTerminal: async value => {
    setTimeout(() => {
      for (const callback of listeners) callback({id: value.id, agent: {
        provider: 'bob', name: 'Bob', model: null, modelSource: null, status: 'running',
        activitySource: 'process', pid: 1234, startedAt: Date.now(),
      }});
    }, 100);
    return {...value, pid: 1234};
  },
  closeTerminal: async () => {}, write: () => {}, resize: () => {},
  reportTerminalView: () => {}, droppedFilePaths: () => [],
  listFiles: async cwd => ({cwd, parent: '/work', entries: [], total: 0}),
  gitInfo: async () => null, windowAction: () => {},
} as Desktop;

void import('../../src/main');
