import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, ChevronRight, CircleHelp, Command, CornerDownLeft, Folder, FolderOpen, Keyboard, LayoutGrid, ListTree, LoaderCircle, Minus, Moon, PanelLeftClose, PanelRightClose, PanelRightOpen, Plus, Search, Settings2, SlidersHorizontal, Square, SquareTerminal, Sun, TerminalSquare, Trash2, X, Zap } from 'lucide-react';
import TerminalPane from './components/TerminalPane';
import Explorer from './components/Explorer';
import SettingsPanel from './components/SettingsPanel';
import AgentCard from './components/AgentCard';
import {FILE_PATH_MIME} from './lib/dropped-paths.mjs';
import { basename, fonts, loadSettings, shortPath } from './settings';
import type { AppInfo, Pane, Settings, Tab, TerminalHandle } from './types';

const uid = () => crypto.randomUUID();
const quickCommands = [
  {name: 'Current directory', command: 'pwd', description: 'Show the current path'},
  {name: 'List files', command: 'ls -lah', description: 'Detailed file listing'},
  {name: 'Git status', command: 'git status', description: 'Changes in your repository'},
  {name: 'Git history', command: 'git log --oneline -10', description: 'Last 10 commits'},
  {name: 'Active processes', command: 'top', description: 'Interactive process monitor'},
];
type Overlay = 'settings' | 'palette' | 'help' | null;

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer && ['Files',FILE_PATH_MIME,'text/uri-list'].some(type => event.dataTransfer!.types.includes(type))) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {window.removeEventListener('dragover', preventFileNavigation);window.removeEventListener('drop', preventFileNavigation);};
  }, []);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [shell, setShell] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [explorer, setExplorer] = useState(true);
  const [search, setSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFound, setSearchFound] = useState(true);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [toast, setToast] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [splitDirection, setSplitDirection] = useState<'vertical' | 'horizontal'>('vertical');
  const [projects, setProjects] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem('xterm.projects') || '[]'); return Array.isArray(value) ? value.filter(p => typeof p === 'string').slice(0, 6) : []; } catch { return []; }
  });
  const handles = useRef(new Map<string, TerminalHandle>());
  const searchInput = useRef<HTMLInputElement>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const activePane = activeTab?.panes.find(pane => pane.id === activeTab.activePane) || activeTab?.panes[0];
  const cwd = activePane?.cwd || info?.cwd || '';
  const home = info?.home || '';
  const status = activePane?.status;
  const activeHandle = () => activePane && handles.current.get(activePane.id);
  const notify = useCallback((message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);
  const newTab = (directory = cwd, selectedShell = shell) => {
    if (tabs.reduce((n, tab) => n + tab.panes.length, 0) >= 24) { notify('You can open up to 24 sessions.'); return; }
    const pane: Pane = {id: uid(), cwd: directory, shell: selectedShell || info?.shell || '/bin/zsh', status: 'connecting'};
    const tab: Tab = {id: uid(), panes: [pane], activePane: pane.id};
    setTabs(current => [...current, tab]); setActiveTabId(tab.id); setSearch(false);
  };
  useEffect(() => {
    void window.desktop?.info().then(result => {
      setInfo(result);
      const savedShell = localStorage.getItem('xterm.shell');
      const initialShell = savedShell && [...result.shells, result.shell].includes(savedShell) ? savedShell : result.shell;
      setShell(initialShell);
      const pane: Pane = {id: uid(), cwd: result.cwd, shell: initialShell, status: 'connecting'};
      const tab: Tab = {id: uid(), panes: [pane], activePane: pane.id};
      setTabs([tab]); setActiveTabId(tab.id);
    }).catch(error => notify(`Could not connect to Electron: ${String(error)}`));
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => { localStorage.setItem('xterm.settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'dark' ? '#20221f' : '#f3f2ed');
    window.desktop?.setAppearance(settings.theme);
  }, [settings.theme]);
  const toggleTheme = () => setSettings(current => ({...current, theme: current.theme === 'light' ? 'dark' : 'light'}));
  useEffect(() => { localStorage.setItem('xterm.projects', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { if (shell) localStorage.setItem('xterm.shell', shell); }, [shell]);
  const updatePane = useCallback((id: string, update: Partial<Pane>) => {
    setTabs(current => current.map(tab => ({...tab, panes: tab.panes.map(pane => pane.id === id ? {...pane, ...update} : pane)})));
  }, []);
  useEffect(() => window.desktop?.onAgent(({id, agent}) => updatePane(id, {agent})), [updatePane]);
  const onHandle = useCallback((id: string, handle: TerminalHandle | null) => { if (handle) handles.current.set(id, handle); else handles.current.delete(id); }, []);
  const focusPane = (id: string) => setTabs(current => current.map(tab => tab.id === activeTabId ? {...tab, activePane: id} : tab));
  const closeTab = (id = activeTabId) => {
    const remaining = tabs.filter(tab => tab.id !== id);
    if (!remaining.length) {
      const pane: Pane = {id: uid(), cwd: info?.cwd || cwd, shell, status: 'connecting'};
      const tab = {id: uid(), panes: [pane], activePane: pane.id};
      setTabs([tab]); setActiveTabId(tab.id);
    } else {
      setTabs(remaining);
      if (activeTabId === id) setActiveTabId(remaining[Math.max(0, tabs.findIndex(tab => tab.id === id) - 1)].id);
    }
    setSearch(false);
  };
  const closePane = (id: string) => {
    if (activeTab?.panes.length === 1) { closeTab(); return; }
    setTabs(current => current.map(tab => tab.id === activeTabId ? {...tab, panes: tab.panes.filter(pane => pane.id !== id), activePane: tab.activePane === id ? tab.panes.find(pane => pane.id !== id)!.id : tab.activePane} : tab));
  };
  const restartPane = (id: string) => {
    const replacementId = uid();
    setTabs(current => current.map(tab => ({...tab, activePane: tab.activePane === id ? replacementId : tab.activePane, panes: tab.panes.map(pane => pane.id === id ? {...pane, id: replacementId, status: 'connecting', pid: undefined} : pane)})));
  };
  const split = () => {
    if (!activeTab || !activePane) return;
    if (activeTab.panes.length >= 2) { setSplitDirection(value => value === 'vertical' ? 'horizontal' : 'vertical'); return; }
    const pane: Pane = {id: uid(), cwd, shell, status: 'connecting'};
    setTabs(current => current.map(tab => tab.id === activeTabId ? {...tab, panes: [...tab.panes, pane], activePane: pane.id} : tab));
  };
  const navigate = (directory: string) => {
    if (!window.desktop || !activePane) return;
    if (activePane.status !== 'running') { newTab(directory); return; }
    void window.desktop.navigate(activePane.id, directory).catch(error => notify(String(error).replace(/^Error:.*?: /, '')));
    activeHandle()?.focus();
  };
  const chooseFolder = async (pin = false) => {
    try {
      const directory = await window.desktop?.chooseFolder();
      if (directory) { if (pin) setProjects(current => [...new Set([...current, directory])].slice(-6)); navigate(directory); }
    } catch (error) { notify(String(error)); }
  };
  const insertCommand = (command: string) => { setOverlay(null); activeHandle()?.paste(command); };
  const openSearch = () => { setSearch(true); requestAnimationFrame(() => searchInput.current?.focus()); };
  const runSearch = (value = searchQuery, previous = false) => { setSearchFound(!value || !!activeHandle()?.find(value, previous)); };
  const closeSearch = () => { setSearch(false); setSearchQuery(''); activeHandle()?.clearSearch(); activeHandle()?.focus(); };
  const showOverlay = (value: Overlay) => { setOverlay(value); setPaletteQuery(''); setPaletteIndex(0); };
  const actions = [
    {name: settings.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode', detail: 'Change the appearance of your entire workspace', shortcut: '', icon: settings.theme === 'light' ? Moon : Sun, run: toggleTheme},
    {name: 'New tab', detail: 'A new session of your shell', shortcut: '⌘ T', icon: Plus, run: () => newTab()},
    {name: 'Split terminal', detail: 'Two sessions, one workspace', shortcut: '⌘ D', icon: PanelLeftClose, run: split},
    {name: 'Open folder', detail: 'Navigate to another project', shortcut: '⌘ O', icon: FolderOpen, run: () => void chooseFolder()},
    {name: 'Clear terminal', detail: 'Clear visible scrollback', shortcut: '', icon: Trash2, run: () => activeHandle()?.clear()},
    {name: 'Preferences', detail: 'Fonts, colors, and behavior', shortcut: '⌘ ,', icon: SlidersHorizontal, run: () => setOverlay('settings')},
    {name: explorer ? 'Hide explorer' : 'Show explorer', detail: 'More room for what matters', shortcut: '⌘ B', icon: ListTree, run: () => setExplorer(value => !value)},
    ...quickCommands.map(command => ({name: command.name, detail: command.command, shortcut: 'insert ↵', icon: TerminalSquare, run: () => insertCommand(command.command)})),
  ].filter(action => `${action.name} ${action.detail}`.toLowerCase().includes(paletteQuery.toLowerCase()));
  const runAction = (index: number) => { const action = actions[index]; if (!action) return; setOverlay(null); action.run(); };
  const commandRef = useRef<(command: string) => void>(() => {});
  commandRef.current = command => {
    if (command === 'new-tab') newTab();
    else if (command === 'close-tab') activePane && closePane(activePane.id);
    else if (command === 'split') split();
    else if (command === 'settings') showOverlay('settings');
    else if (command === 'open-folder') void chooseFolder();
    else if (command === 'search') openSearch();
    else if (command === 'palette') showOverlay('palette');
  };
  useEffect(() => window.desktop?.onCommand(command => commandRef.current(command)), []);
  useEffect(() => {
    if (overlay === 'palette') paletteInput.current?.focus();
    else if (overlay) requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="dialog"] button')?.focus());
    else if (!overlay && !search) activeHandle()?.focus();
  }, [overlay]);
  useEffect(() => { setPaletteIndex(0); }, [paletteQuery]);
  useEffect(() => window.desktop?.onFilesChanged(event => { if (event.cwd === cwd) setRefreshKey(key => key + 1); }), [cwd]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOverlay(null); if (search) closeSearch(); else activeHandle()?.focus(); }
      if (event.key === 'Tab' && overlay) {
        const modal = document.querySelector('[role="dialog"]');
        const elements = modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]');
        if (elements?.length) {
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      if ((event.metaKey || event.ctrlKey && event.shiftKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); setExplorer(value => !value); }
      if ((event.metaKey || event.ctrlKey && event.shiftKey) && ['+','=','-'].includes(event.key)) { event.preventDefault(); setSettings(value => ({...value, fontSize: Math.max(10, Math.min(24, value.fontSize + (event.key === '-' ? -1 : 1)))})); }
      if (event.ctrlKey && event.key === 'Tab' && tabs.length) {
        event.preventDefault(); const index = tabs.findIndex(tab => tab.id === activeTabId); setActiveTabId(tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length].id);
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  const activeFont = fonts.find(font => font.value === settings.font)?.name || 'Monospace';
  const totalSessions = tabs.reduce((total, tab) => total + tab.panes.length, 0);
  return <div className={`app theme-${settings.theme}`}>
    <div className="titlebar"><div className="traffic-space">{info?.platform !== 'darwin' && <div className="window-buttons"><button title="Minimize" onClick={() => window.desktop?.windowAction('minimize')}><Minus size={12}/></button><button title="Maximize" onClick={() => window.desktop?.windowAction('maximize')}><Square size={10}/></button><button title="Close window" onClick={() => window.desktop?.windowAction('close')}><X size={12}/></button></div>}</div><span className="titlebar-center"><span className="titlebar-emblem">⌘</span> A SPACE TO CREATE</span><div className="titlebar-right"><span className="titlebar-version">v{info?.version || '0.4.0'}</span><button title="Command palette (⌘ K)" onClick={() => showOverlay('palette')}><Command size={12}/><span>K</span></button></div></div>
    <div className="app-body">
      <aside className="sidebar">
        <div className="brand"><div className="brand-symbol" aria-hidden="true">x<span>_</span></div><span>xTerm<span className="brand-dot">®</span></span><span className="brand-label">TERMINAL<br/>REIMAGINED</span></div>
        <div className="sidebar-nav"><button className="nav-item selected" onClick={() => { setOverlay(null); activeHandle()?.focus(); }}><SquareTerminal size={17}/><span>Terminal</span><span className="nav-count">{String(totalSessions || 1).padStart(2,'0')}</span></button><button className="nav-item" onClick={() => showOverlay('palette')}><LayoutGrid size={16}/><span>Commands</span><kbd>⌘ K</kbd></button></div>
        <div className="sidebar-section"><div className="sidebar-label"><span>WORKSPACES</span><button className="icon-button" title="Add workspace folder" onClick={() => void chooseFolder(true)}><Plus size={14}/></button></div>
          <button className="workspace-item active" title={cwd} onClick={() => activeHandle()?.focus()}><div className="workspace-icon"><Command size={16}/></div><span><strong>{basename(cwd) || 'My workspace'}</strong><small>Current workspace</small></span><span className="workspace-indicator"/></button>
          {info && <button className="workspace-shortcut" title={home} onClick={() => navigate(home)}><Folder size={14}/><span>Home folder</span><ArrowUpRight size={12}/></button>}
          {projects.filter(project => project !== home).map(project => <div className="pinned-project" key={project}><button className="workspace-shortcut" title={project} onClick={() => navigate(project)}><Folder size={14}/><span>{basename(project)}</span></button><button className="icon-button remove-project" title="Remove saved workspace" onClick={() => setProjects(current => current.filter(item => item !== project))}><X size={11}/></button></div>)}
        </div>
        <div className="sidebar-section sessions-section"><div className="sidebar-label"><span>SESSIONS</span><button className="icon-button" title="New session (⌘ T)" onClick={() => newTab()}><Plus size={14}/></button></div>
          <div className="session-list">{tabs.map((tab, index) => <button key={tab.id} className={`session-item ${tab.id === activeTabId ? 'selected' : ''}`} onClick={() => setActiveTabId(tab.id)}><span className="session-line"/><TerminalSquare size={14}/><span>{basename(tab.panes.find(pane => pane.id === tab.activePane)?.shell || shell)}<small>{tab.panes.length > 1 ? ' / split' : ` / ${String(index + 1).padStart(2,'0')}`}</small></span><i className={tab.panes.some(pane => pane.status === 'running') ? 'live-dot' : 'idle-dot'}/></button>)}</div>
          <button className="new-session" onClick={() => newTab()}><Plus size={13}/><span>New session</span><kbd>⌘ T</kbd></button>
        </div>
        <div className="harness-slot"><AgentCard agent={activePane?.agent || null}/></div>
        <div className="sidebar-footer"><button onClick={() => showOverlay('settings')}><Settings2 size={16}/><span>Preferences</span><kbd>⌘ ,</kbd></button><button className="help-button" title="Keyboard shortcuts" onClick={() => showOverlay('help')}><CircleHelp size={16}/></button></div>
      </aside>
      <main className="main-workspace">
        <header className="workspace-header"><div><div className="workspace-eyebrow"><span className="orange-square"/> YOUR SPACE. YOUR PACE.</div><div className="workspace-title"><h1>{basename(cwd) || 'My workspace'}<span>_</span></h1><span className="workspace-badge"><i className="live-dot"/> LOCAL</span></div></div><div className="workspace-header-actions"><button className="theme-toggle" type="button" title={settings.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} aria-label={settings.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} aria-pressed={settings.theme === 'dark'} onClick={toggleTheme}>{settings.theme === 'light' ? <Moon size={15}/> : <Sun size={15}/>}<span>{settings.theme === 'light' ? 'Dark mode' : 'Light mode'}</span></button><button className="open-folder-button" onClick={() => void chooseFolder()}><FolderOpen size={15}/><span>Open folder</span><ArrowUpRight size={14}/></button></div></header>
        <div className="workspace-toolbar"><div className="breadcrumb"><Folder size={13}/><span>{home && cwd ? shortPath(cwd, home).split('/').slice(0,-1).join('/') || '~' : '~'}</span><ChevronRight size={12}/><strong>{basename(cwd) || 'workspace'}</strong></div><div className="toolbar-actions"><button title="Search terminal (⌘ F)" className={`icon-button ${search ? 'active' : ''}`} onClick={openSearch}><Search size={15}/></button><button title="Split pane (⌘ D). Click again to change orientation." className="icon-button" onClick={split}><PanelLeftClose size={16}/></button><span className="toolbar-divider"/><button title="Appearance settings" className="icon-button" onClick={() => showOverlay('settings')}><SlidersHorizontal size={15}/></button><button title={explorer ? 'Hide explorer (⌘ B)' : 'Show explorer (⌘ B)'} className={`icon-button ${explorer ? 'active' : ''}`} onClick={() => setExplorer(!explorer)}>{explorer ? <PanelRightClose size={16}/> : <PanelRightOpen size={16}/>}</button></div></div>
        <div className="work-area">
          <div className={`terminal-workspace background-${settings.background} ${settings.motion ? '' : 'motion-off'} ${activePane?.agent?.status === 'working' ? 'agent-working' : ''}`}>
            <div className="terminal-tabs"><div className="tabs-scroll" role="tablist" aria-label="Terminal sessions">{tabs.map((tab, index) => <div key={tab.id} role="tab" aria-selected={tab.id === activeTabId} tabIndex={0} className={`terminal-tab ${tab.id === activeTabId ? 'active' : ''}`} onClick={() => setActiveTabId(tab.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setActiveTabId(tab.id); }}><TerminalSquare size={13}/><span>{basename(tab.panes.find(pane => pane.id === tab.activePane)?.cwd || '')}<small> {String(index + 1).padStart(2,'0')}</small></span><button title="Close tab" onClick={event => { event.stopPropagation(); closeTab(tab.id); }}><X size={12}/></button></div>)}</div><button className="tab-add" title="New tab (⌘ T)" onClick={() => newTab()}><Plus size={16}/></button><div className="tabs-end"><span>⌘</span><span>_</span></div></div>
            {search && <form className="terminal-search" onSubmit={event => { event.preventDefault(); runSearch(); }}><Search size={14}/><input ref={searchInput} aria-label="Search terminal" placeholder="Search terminal…" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); runSearch(event.target.value); }}/>{searchQuery && <span className={!searchFound ? 'search-no-match' : ''}>{searchFound ? 'Match found' : 'No results'}</span>}<button type="button" title="Previous match" onClick={() => runSearch(searchQuery, true)}><ChevronDown size={14} style={{transform:'rotate(180deg)'}}/></button><button type="submit" title="Next match"><ChevronDown size={14}/></button><button type="button" title="Close search" onClick={closeSearch}><X size={14}/></button></form>}
            <div className="terminal-panes">{tabs.map(tab => <div key={tab.id} className={`tab-panes split-${splitDirection}`} style={{display: tab.id === activeTabId ? 'flex' : 'none'}}>{tab.panes.map(pane => <TerminalPane key={pane.id} pane={pane} settings={settings} active={pane.id === tab.activePane} visible={tab.id === activeTabId} split={tab.panes.length > 1} onUpdate={updatePane} onHandle={onHandle} onFocus={focusPane} onClose={closePane} onRestart={restartPane}/>)}</div>)}{!tabs.length && <div className="connecting-state"><LoaderCircle className="spinning" size={25}/><h2>{window.desktop ? 'Preparing your workspace…' : 'Made for your desktop.'}</h2><p>{window.desktop ? 'Connecting to your local shell.' : 'Run npm run dev to open xTerm with your real shell.'}</p></div>}</div>
            <div className="terminal-bottom"><span><i className={status === 'running' ? 'live-dot' : 'idle-dot'}/>{status === 'running' ? 'Session connected' : status === 'connecting' ? 'Connecting…' : status === 'exited' ? 'Session ended' : status === 'error' ? 'Connection error' : 'Web preview'}</span><span className="terminal-bottom-hint">ONE IDEA. ONE COMMAND. <ArrowUpRight size={12}/></span><span>{activePane?.pid ? `PID ${activePane.pid}` : '—'}</span></div>
            <div className="terminal-artwork" aria-hidden="true"><div className="artwork-label">INPUT / OUTPUT<br/>ENDLESS POSSIBILITIES</div><div className="artwork-lines"/><span className="artwork-cross cross-one">+</span><span className="artwork-cross cross-two">+</span><div className="artwork-corner"/><div className="artwork-scan"/><span className="artwork-number">01</span></div>
          </div>
          {explorer && <Explorer cwd={cwd} home={home} settings={settings} onNavigate={navigate} onHidden={() => setSettings(value => ({...value, showHidden: !value.showHidden}))} onError={notify} refreshKey={refreshKey}/>}
        </div>
        <div className="quick-command-bar"><div><Zap size={13}/><span>QUICK ACCESS</span></div><button title="Insert pwd into terminal" onClick={() => insertCommand('pwd')}>pwd <ArrowUpRight size={11}/></button><button title="Insert ls -lah into terminal" onClick={() => insertCommand('ls -lah')}>ls -lah <ArrowUpRight size={11}/></button><button title="Insert git status into terminal" onClick={() => insertCommand('git status')}>git status <ArrowUpRight size={11}/></button><button className="all-commands" onClick={() => showOverlay('palette')}>All commands <ArrowRight size={13}/></button></div>
      </main>
    </div>
    <footer className="app-status"><div><span className="status-logo">x_</span><span>{info?.hostname || 'xTerm desktop'}</span><span className="status-divider">/</span><span>{basename(activePane?.shell || shell || 'zsh')}</span><span className="status-divider">/</span><span>{info?.platform === 'darwin' ? 'macOS' : info?.platform || 'Electron'}</span></div><div><button onClick={() => showOverlay('settings')}>{activeFont}<span className="status-divider">·</span>{settings.fontSize}px</button><span className="status-divider">/</span><span>UTF-8</span><span className="status-divider">/</span><span className="system-ready"><i className="live-dot"/>{status === 'running' ? 'SYSTEM READY' : 'XTERM / 01'}</span></div></footer>
    {toast && <div role="status" className="toast"><span>{toast}</span><button className="icon-button" title="Dismiss notification" onClick={() => setToast('')}><X size={13}/></button></div>}
    {overlay === 'settings' && <SettingsPanel settings={settings} info={info} shell={shell || '/bin/zsh'} onChange={setSettings} onShell={setShell} onClose={() => setOverlay(null)}/>}
    {overlay === 'palette' && <div className="modal-backdrop palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOverlay(null); }}><section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title"><div className="palette-heading"><Command size={16}/><span id="palette-title">YOUR NEXT MOVE</span><button className="icon-button" title="Close command palette" onClick={() => setOverlay(null)}><X size={16}/></button></div><div className="palette-input"><Search size={20}/><input ref={paletteInput} placeholder="What would you like to do?" aria-label="Search commands" value={paletteQuery} onChange={event => setPaletteQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteIndex(value => Math.min(value + 1, actions.length - 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex(value => Math.max(0, value - 1)); } else if (event.key === 'Enter') { event.preventDefault(); runAction(paletteIndex); } }}/><kbd>ESC</kbd></div><div className="palette-section-label">ACTIONS & COMMANDS <span>{String(actions.length).padStart(2,'0')}</span></div><div className="palette-list">{actions.map((action, index) => <button key={action.name} className={index === paletteIndex ? 'selected' : ''} onMouseEnter={() => setPaletteIndex(index)} onClick={() => runAction(index)}><span className="palette-action-icon"><action.icon size={17}/></span><span><strong>{action.name}</strong><small>{action.detail}</small></span><kbd>{action.shortcut}</kbd></button>)}{!actions.length && <div className="empty-state"><Search size={22}/><p>No matching commands.</p></div>}</div><div className="palette-footer"><span>↑ ↓ to navigate</span><span><CornerDownLeft size={12}/> to select</span><span>Commands are inserted, not executed.</span></div></section></div>}
    {overlay === 'help' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOverlay(null); }}><section className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-top"><span><Keyboard size={16}/> FIND YOUR KEYBOARD FLOW</span><button className="icon-button" title="Close help" onClick={() => setOverlay(null)}><X size={18}/></button></div><h2 id="help-title">Fewer clicks.<br/>More flow<span>↗</span></h2><div className="shortcut-list">{[['New tab','⌘ T'],['Split pane / change orientation','⌘ D'],['Close active pane','⌘ W'],['Open folder','⌘ O'],['Search terminal','⌘ F'],['Command palette','⌘ K'],['Toggle explorer','⌘ B'],['Preferences','⌘ ,'],['Increase / decrease font size','⌘ + / −'],['Next / previous tab','Ctrl ⇧ Tab'],['Interrupt a command','Ctrl C'],['Clear screen','Ctrl L']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p>Your shell keeps its history, aliases, completion, and familiar shortcuts. On Windows and Linux, use Ctrl for menu shortcuts and Ctrl + Shift to copy, resize fonts, and toggle the explorer.</p><button className="primary-button" onClick={() => setOverlay(null)}>Back to creating <ArrowUpRight size={15}/></button></section></div>}
  </div>;
}
