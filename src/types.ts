export interface AppInfo {
  home: string; cwd: string; shell: string; platform: string; hostname: string;
  username: string; version: string; shells: string[];
}
export interface FileEntry { name: string; path: string; directory: boolean; symlink: boolean; size: number | null; modified: string | null; hidden: boolean }
export interface FileListing { cwd: string; parent: string; entries: FileEntry[]; total: number }
export interface GitHubRepository { owner: string; repo: string; url: string }
export interface GitInfo { branch: string; changed: number; github: GitHubRepository | null }
export type PaneStatus = 'connecting' | 'running' | 'exited' | 'error';
export interface AgentInfo {
  provider: string; name: string; model: string | null;
  modelSource: 'argument' | 'reported' | null;
  status: 'running' | 'working' | 'ready' | 'attention';
  activitySource: 'process' | 'terminal' | 'reported';
  pid: number | null; startedAt: number;
}
export interface SshInfo {
  pid: number; target: string; configuredHost: string | null; remoteHostname: string | null;
  user: string | null; port: number | null; jumpHost: string | null;
  endpoint: {address: string; port: number} | null;
  transportEndpoint: {address: string; port: number} | null;
  configStatus: 'static' | 'unavailable'; routing: 'direct' | 'proxy' | 'unknown';
  status: 'connecting' | 'unknown'; statusDetail: string;
  startedAt: number; durationKind: 'observed-process';
}
export interface EditorState { path: string; dirty: boolean }
export interface Pane { id: string; cwd: string; shell: string; status: PaneStatus; pid?: number; remoteControl?: boolean; agent?: AgentInfo | null; ssh?: SshInfo | null; editorPath?: string; editor?: EditorState | null }
export interface Tab { id: string; panes: Pane[]; activePane: string }
export interface Settings {
  font: string; fontSize: number; lineHeight: number; cursor: 'block' | 'bar' | 'underline';
  theme: 'light' | 'dark'; background: 'blueprint' | 'clean' | 'contours';
  showHidden: boolean; scrollback: number; motion: boolean;
}
export interface TerminalHandle {
  focus(): void; clear(): void; paste(text: string): void;
  find(value: string, previous?: boolean): boolean; clearSearch(): void;
}
export type RemotePermission = 'view' | 'commands';
export interface RemoteOptions { ids: string[]; provider: 'cloudflare'; permission: RemotePermission; hours: number }
export type RemoteState =
  | {status: 'disabled'; message: string}
  | {
    status: 'starting' | 'active'; provider: 'cloudflare'; permission: RemotePermission;
    ids: string[]; expiresAt: number; remaining: number;
    invitation: {link: string; expiresAt: number} | null;
    device: {label: string; connected: boolean} | null;
  };
export interface Desktop {
  info(): Promise<AppInfo>;
  setAppearance(theme: Settings['theme']): void;
  readClipboardText(): Promise<string>;
  droppedFilePaths(files: File[]): string[];
  reportTerminalView(id: string, lines: string[]): void;
  createTerminal(options: {id: string; cwd: string; shell: string; cols: number; rows: number; editorPath?: string}): Promise<{id: string; cwd: string; shell: string; pid: number}>;
  write(id: string, data: string): void; respond(id: string, data: string): void; resize(id: string, cols: number, rows: number): void;
  clearTerminal(id: string): void;
  closeTerminal(id: string): Promise<void>;
  navigate(id: string, directory: string): Promise<void>;
  openEditor(id: string | undefined, file: string): Promise<'not-text' | 'new-tab' | 'opened'>;
  saveEditor(id: string, file: string): Promise<void>;
  onData(callback: (event: {id: string; data: string}) => void): () => void;
  onCwd(callback: (event: {id: string; cwd: string}) => void): () => void;
  onExit(callback: (event: {id: string; exitCode: number}) => void): () => void;
  onAgent(callback: (event: {id: string; agent: AgentInfo | null}) => void): () => void;
  onSsh(callback: (event: {id: string; ssh: SshInfo | null}) => void): () => void;
  onControl(callback: (event: {id: string; remote: boolean}) => void): () => void;
  onEditor(callback: (event: {id: string; editor: EditorState | null}) => void): () => void;
  remote: {
    state(): Promise<RemoteState>; start(options: RemoteOptions): Promise<RemoteState>; stop(): Promise<RemoteState>;
    regenerate(): Promise<RemoteState>; revoke(): Promise<RemoteState>; share(id: string): Promise<RemoteState>;
    remove(id: string): Promise<RemoteState>; takeControl(id: string): Promise<void>; qr(link: string): Promise<string | null>;
    onState(callback: (state: RemoteState) => void): () => void;
  };
  onFilesChanged(callback: (event: {id: string; cwd: string}) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
  listFiles(directory: string): Promise<FileListing>;
  fileDetails(path: string): Promise<{size:number | null; modified:string | null}>;
  resolveLink(path: string): Promise<{directory:boolean; path:string}>;
  chooseFolder(): Promise<string | null>; revealFile(path: string): Promise<void>;
  gitInfo(directory: string): Promise<GitInfo | null>;
  openExternal(url: string): Promise<void>; windowAction(action: string): void;
}
declare global { interface Window { desktop?: Desktop } }
