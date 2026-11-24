import { useEffect, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUp, ArrowUpRight, Braces, Check, ChevronRight, Code2, Copy, Ellipsis, Eye, EyeOff, File, FileCode2, FileJson, FileText, Folder, FolderOpen, GitBranch, Image, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import type { FileEntry, FileListing, GitInfo, Settings } from '../types';
import { basename, formatSize, shortPath } from '../settings';
import {FILE_PATH_MIME} from '../lib/dropped-paths.mjs';
interface Props { cwd: string; home: string; settings: Settings; onNavigate(path: string): void; onHidden(): void; onError(message: string): void; refreshKey: number }
function FileIcon({file}: {file: FileEntry}) {
  if (file.directory) return <Folder size={16} className="file-folder"/>;
  if (/\.(tsx?|jsx?|mjs|cjs|py|sh|css|html|rs|go)$/.test(file.name)) return <FileCode2 size={15} className={/\.[jt]sx?$/.test(file.name) ? 'file-code' : ''}/>;
  if (/\.(json|ya?ml|toml)$/.test(file.name)) return <FileJson size={15} className="file-json"/>;
  if (/\.(png|jpe?g|svg|webp|gif|ico)$/.test(file.name)) return <Image size={15}/>;
  if (/\.(md|txt|log)$/.test(file.name)) return <FileText size={15}/>;
  return <File size={15}/>;
}
export default function Explorer({cwd, home, settings, onNavigate, onHidden, onError, refreshKey}: Props) {
  const [listing, setListing] = useState<FileListing | null>(null);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [menu, setMenu] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    if (!window.desktop || !cwd) return;
    setLoading(true); setError('');
    setSelected(null);
    void window.desktop.listFiles(cwd).then(result => { if (alive) setListing(result); }).catch(err => { if (alive) { setError(String(err).replace(/^Error:.*?: /, '')); setListing(null); } }).finally(() => { if (alive) setLoading(false); });
    setGit(null);
    void window.desktop.gitInfo(cwd).then(result => { if (alive) setGit(result); }).catch(() => { if (alive) setGit(null); });
    return () => { alive = false; };
  }, [cwd, refresh, refreshKey]);
  useEffect(() => { setQuery(''); }, [cwd]);
  useEffect(() => {
    let alive = true;
    if (!selected || selected.directory || selected.symlink || !window.desktop) return;
    const selectedPath = selected.path;
    void window.desktop.fileDetails(selectedPath).then(details => {
      if (alive) setSelected(current => current?.path === selectedPath ? {...current,...details} : current);
    }).catch(() => { /* Keep unavailable metadata blank. */ });
    return () => {alive = false;};
  }, [selected?.path]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  const entries = listing?.entries.filter(file => (settings.showHidden || !file.hidden) && file.name.toLowerCase().includes(query.toLowerCase())) || [];
  const folders = entries.filter(file => file.directory).length;
  const openEntry = async (file: FileEntry) => {
    if (file.directory) { onNavigate(file.path); return; }
    try {
      if (file.symlink) {
        const target = await window.desktop?.resolveLink(file.path);
        if (target?.directory) { onNavigate(target.path); return; }
      }
      await window.desktop?.revealFile(file.path);
    } catch (error) { onError(String(error)); }
  };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { onError('Could not copy the path.'); } };
  return <aside className="explorer">
    <header className="explorer-header"><div><span className="section-code">CONTEXT / 02</span><h3>Explorer<span>.</span></h3></div><span className="square-code"><FolderOpen size={18}/></span></header>
    <div className="explorer-tools"><span>CURRENT DIRECTORY</span><div><button className={`icon-button ${searchOpen ? 'active' : ''}`} title="Search files" onClick={() => setSearchOpen(!searchOpen)}><Search size={14}/></button><button className="icon-button" title="Refresh files" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} className={loading ? 'spinning' : ''}/></button><div className="menu-anchor"><button className="icon-button" title="Explorer options" onClick={() => setMenu(!menu)}><Ellipsis size={17}/></button>{menu && <><div className="menu-dismiss" onClick={() => setMenu(false)}/><div className="dropdown-menu"><button onClick={() => { onHidden(); setMenu(false); }}>{settings.showHidden ? <EyeOff size={14}/> : <Eye size={14}/>} {settings.showHidden ? 'Hide hidden files' : 'Show hidden files'}</button><button onClick={() => { void copy(cwd); setMenu(false); }}><Copy size={14}/> Copy path</button><button onClick={() => { void window.desktop?.revealFile(cwd).catch(err => onError(String(err))); setMenu(false); }}><ArrowUpRight size={14}/> Show in Finder</button></div></>}</div></div></div>
    <div className="explorer-location"><button className="icon-button" title="Go to parent folder" disabled={!listing || listing.parent === cwd} onClick={() => listing && onNavigate(listing.parent)}><ArrowUp size={14}/></button><FolderOpen size={15}/><span title={cwd}>{basename(cwd) || 'workspace'}</span><ChevronRight size={13}/></div>
    <div className="explorer-path" title={cwd}>{shortPath(cwd, home) || 'Waiting for connection…'}</div>
    {searchOpen && <div className="file-search"><Search size={13}/><input ref={searchRef} aria-label="Filter files" placeholder="Filter files…" value={query} onChange={event => setQuery(event.target.value)}/><button className="icon-button" title="Close filter" onClick={() => { setSearchOpen(false); setQuery(''); }}><X size={12}/></button></div>}
    <div className="file-list-heading"><span>NAME</span><ArrowDownAZ size={13}/></div>
    <div className="file-list" aria-label="Files in the current directory">
      {error && <div className="empty-state"><Folder size={24}/><strong>Could not open this folder</strong><p>{error}</p><button className="text-button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
      {!error && !entries.length && <div className="empty-state">{loading ? <LoaderCircle size={22} className="spinning"/> : <FolderOpen size={25}/>}<p>{loading ? 'Reading folder…' : query ? 'No matching files.' : 'This folder is empty.'}</p></div>}
      {entries.map(file => <button key={file.path} draggable onDragStart={event => {event.dataTransfer.setData(FILE_PATH_MIME,JSON.stringify([file.path]));event.dataTransfer.setData('text/plain',file.path);event.dataTransfer.effectAllowed='copy';}} className={`file-row ${selected?.path === file.path ? 'selected' : ''} ${file.hidden ? 'hidden-file' : ''}`} title={`${file.name}${file.directory ? ' · Double-click to open' : file.symlink ? ' · Double-click to open link' : ' · Double-click to show in Finder'}`} onClick={() => setSelected(file)} onDoubleClick={() => void openEntry(file)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void openEntry(file); } }}><FileIcon file={file}/><span>{file.name}</span>{file.directory ? <ChevronRight size={12} className="file-chevron"/> : <small>{file.name.includes('.') ? file.name.split('.').pop() : '—'}</small>}</button>)}
    </div>
    <div className="explorer-count"><span><i className="live-dot"/> In sync with your shell</span><span>{entries.length} items</span></div>
    {selected ? <div className="file-detail"><div className="file-detail-label"><span>SELECTION</span><button className="icon-button" title="Deselect file" onClick={() => setSelected(null)}><X size={12}/></button></div><div className="detail-filename"><FileIcon file={selected}/><strong>{selected.name}</strong></div><div className="file-detail-meta"><span>{selected.directory ? 'Folder' : selected.symlink ? 'Symbolic link' : selected.size === null ? '—' : formatSize(selected.size)}</span><span>{selected.modified ? new Date(selected.modified).toLocaleDateString('en-US', {day:'2-digit',month:'short'}) : '—'}</span></div><button className="detail-copy" onClick={() => void copy(selected.path)}>{copied ? <Check size={12}/> : <Copy size={12}/>} {copied ? 'Path copied' : 'Copy path'}<ArrowUpRight size={12}/></button></div> : <div className="directory-summary"><div><Folder size={15}/><span>{folders} folders</span></div><div><FileText size={15}/><span>{entries.length - folders} files</span></div></div>}
    <div className="git-card"><div className="git-card-title"><GitBranch size={14}/><span>VERSION CONTROL</span>{git && <i className="live-dot"/>}</div><div className="git-card-content"><strong>{git?.branch || 'No repository'}</strong><span>{git ? git.changed ? `${git.changed} changes` : 'Up to date' : 'Something new starts here.'}</span></div></div>
    <div className="explorer-bottom"><Braces size={15}/><span>CONTEXT CHANGES EVERYTHING.</span><Code2 size={14}/></div>
  </aside>;
}
