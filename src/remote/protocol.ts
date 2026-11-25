import type { AgentInfo, RemotePermission } from '../types';

export interface Session {
  id: string;
  cwd: string;
  shell: string;
  status: 'running';
  control: boolean;
  agent: Pick<AgentInfo, 'name' | 'model' | 'status'> | null;
  ssh: {target: string} | null;
}

export interface State {
  type: 'state';
  expiresAt: number;
  remaining: number;
  permission: RemotePermission;
  sessions: Session[];
}

export type RemoteEvent = State
  | {type: 'snapshot'; id: string; subscription: number; sequence: number; data: string; cols: number; rows: number}
  | {type: 'output'; id: string; subscription: number; sequence: number; data: string}
  | {type: 'resize'; id: string; subscription: number; sequence: number; cols: number; rows: number}
  | {type: 'clear'; id: string; subscription: number; sequence: number}
  | {type: 'exit'; id: string; subscription: number; code?: number}
  | {type: 'notice'; text: string};
