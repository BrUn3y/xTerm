export interface AppInfo {
  home: string; cwd: string; shell: string; platform: string; hostname: string;
  username: string; version: string; shells: string[];
}
export interface FileEntry { name: string; path: string; directory: boolean; symlink: boolean; size: number | null; modified: string | null; hidden: boolean }
export interface FileListing { cwd: string; parent: string; entries: FileEntry[]; total: number }
export interface GitInfo { branch: string; changed: number }
export type PaneStatus = 'connecting' | 'running' | 'exited' | 'error';
export interface AgentInfo {
  provider: string; name: string; model: string | null;
  modelSource: 'argument' | 'reported' | null;
  status: 'running' | 'working' | 'ready' | 'attention';
  activitySource: 'process' | 'terminal' | 'reported';
  pid: number | null; startedAt: number;
}
export interface Pane { id: string; cwd: string; shell: string; status: PaneStatus; pid?: number; agent?: AgentInfo | null }
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
export interface Desktop {
  info(): Promise<AppInfo>;
  setAppearance(theme: Settings['theme']): void;
  createTerminal(options: {id: string; cwd: string; shell: string; cols: number; rows: number}): Promise<{id: string; cwd: string; shell: string; pid: number}>;
  write(id: string, data: string): void; resize(id: string, cols: number, rows: number): void;
  closeTerminal(id: string): Promise<void>;
  navigate(id: string, directory: string): Promise<void>;
  onData(callback: (event: {id: string; data: string}) => void): () => void;
  onCwd(callback: (event: {id: string; cwd: string}) => void): () => void;
  onExit(callback: (event: {id: string; exitCode: number}) => void): () => void;
  onAgent(callback: (event: {id: string; agent: AgentInfo | null}) => void): () => void;
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
