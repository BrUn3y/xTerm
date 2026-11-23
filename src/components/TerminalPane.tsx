import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ArrowUpRight, CornerDownLeft, RotateCcw, X } from 'lucide-react';
import type { Pane, Settings, TerminalHandle } from '../types';
import { themeColors, basename } from '../settings';
import { adaptTerminalRows } from '../terminal-appearance';

interface Props {
  pane: Pane; settings: Settings; active: boolean; visible: boolean; split: boolean;
  onUpdate(id: string, update: Partial<Pane>): void;
  onHandle(id: string, handle: TerminalHandle | null): void;
  onFocus(id: string): void; onClose(id: string): void; onRestart(id: string): void;
}
export default function TerminalPane(props: Props) {
  const { pane, settings, active, visible, split } = props;
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const current = useRef(props); current.current = props;
  useEffect(() => {
    const desktop = window.desktop;
    if (!container.current || !desktop) return;
    let disposed = false;
    let created = false;
    const terminal = new Terminal({
      fontFamily: settings.font, fontSize: settings.fontSize, lineHeight: settings.lineHeight,
      cursorStyle: settings.cursor, cursorBlink: true, allowTransparency: true,
      theme: themeColors[settings.theme], scrollback: settings.scrollback,
      macOptionIsMeta: true, macOptionClickForcesSelection: true, rightClickSelectsWord: true,
      allowProposedApi: false, minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit); terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon((_event, url) => void desktop.openExternal(url)));
    terminal.open(container.current);
    const renderListener = terminal.onRender(({start,end}) => {
      if (container.current) adaptTerminalRows(container.current, current.current.settings.theme, start, end);
    });
    termRef.current = terminal; fitRef.current = fit;
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      const appModifier = event.metaKey || event.ctrlKey && event.shiftKey;
      if (appModifier && event.key.toLowerCase() === 'c') {
        if (terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      if (appModifier && ['k','f','t','w','d',',','o','b','+','-','='].includes(event.key.toLowerCase())) return false;
      return true;
    });
    const unsubscribeData = desktop.onData(event => { if (event.id === pane.id) terminal.write(event.data); });
    const unsubscribeCwd = desktop.onCwd(event => { if (event.id === pane.id) current.current.onUpdate(pane.id, {cwd: event.cwd}); });
    const unsubscribeExit = desktop.onExit(event => {
      if (event.id === pane.id) {
        terminal.writeln(`\r\n\x1b[90m[Process exited · code ${event.exitCode}]\x1b[0m`);
        current.current.onUpdate(pane.id, {status: 'exited'});
      }
    });
    const dataListener = terminal.onData(data => desktop.write(pane.id, data));
    const resizeListener = terminal.onResize(({cols, rows}) => { if (created) desktop.resize(pane.id, cols, rows); });
    const safeFit = () => {
      if (disposed || !container.current?.offsetWidth || !container.current?.offsetHeight) return;
      try { fit.fit(); } catch { /* Panel is being mounted. */ }
    };
    const observer = new ResizeObserver(safeFit); observer.observe(container.current);
    current.current.onHandle(pane.id, {
      focus: () => terminal.focus(), clear: () => { terminal.clear(); terminal.focus(); },
      paste: text => { terminal.paste(text); terminal.focus(); },
      find: (value, previous) => previous ? search.findPrevious(value, {incremental: true}) : search.findNext(value, {incremental: true}),
      clearSearch: () => search.clearDecorations(),
    });
    void document.fonts.ready.then(async () => {
      if (disposed) return;
      safeFit();
      try {
        const result = await desktop.createTerminal({id: pane.id, cwd: pane.cwd, shell: pane.shell, cols: terminal.cols, rows: terminal.rows});
        created = true;
        if (disposed) { await desktop.closeTerminal(pane.id); return; }
        current.current.onUpdate(pane.id, {status: 'running', pid: result.pid, cwd: result.cwd});
        safeFit();
        desktop.resize(pane.id, terminal.cols, terminal.rows);
        if (current.current.active && current.current.visible) terminal.focus();
      } catch (error) {
        if (!disposed) {
          terminal.writeln(`\x1b[31mCould not start the shell.\x1b[0m\r\n${String(error)}\r\n`);
          current.current.onUpdate(pane.id, {status: 'error'});
        }
      }
    });
    return () => {
      disposed = true; observer.disconnect(); unsubscribeData(); unsubscribeCwd(); unsubscribeExit();
      dataListener.dispose(); resizeListener.dispose(); renderListener.dispose(); terminal.dispose();
      termRef.current = null; fitRef.current = null; current.current.onHandle(pane.id, null);
      if (created) void desktop.closeTerminal(pane.id);
    };
  }, []);
  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = settings.font;
    terminal.options.fontSize = settings.fontSize;
    terminal.options.lineHeight = settings.lineHeight;
    terminal.options.cursorStyle = settings.cursor;
    terminal.options.scrollback = settings.scrollback;
    terminal.options.theme = themeColors[settings.theme];
    terminal.refresh(0, terminal.rows - 1);
    void document.fonts.ready.then(() => { try { if (container.current?.offsetWidth) fitRef.current?.fit(); } catch {} });
  }, [settings]);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch {}
      if (active) termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, visible]);
  return <section className={`terminal-pane ${active ? 'is-active' : ''}`} onMouseDown={() => props.onFocus(pane.id)}>
    {split && <div className="pane-heading"><span><i className={pane.status === 'running' ? 'live-dot' : 'idle-dot'} /> {basename(pane.cwd)} <small>{basename(pane.shell)}</small></span><button className="icon-button" title="Close pane" onClick={() => props.onClose(pane.id)}><X size={13}/></button></div>}
    <div className="shell-caption"><span><i className={pane.status === 'running' ? 'live-dot' : 'idle-dot'} /> {basename(pane.shell)} <span className="caption-separator">/</span> local session</span><span>UTF-8 <CornerDownLeft size={11}/></span></div>
    <div className="terminal-mount" ref={container} aria-label={`Terminal ${basename(pane.cwd)}`} />
    {!window.desktop && <div className="browser-message"><ArrowUpRight size={22}/><strong>Your terminal belongs on the desktop.</strong><p>Start xTerm with <code>npm run dev</code> to connect your real shell.</p></div>}
    {(pane.status === 'exited' || pane.status === 'error') && <button className="restart-session" onClick={() => props.onRestart(pane.id)}><RotateCcw size={14}/> Restart session</button>}
  </section>;
}
