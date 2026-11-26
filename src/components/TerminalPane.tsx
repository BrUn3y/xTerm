import { type DragEvent, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ArrowDownToLine, ArrowUpRight, CornerDownLeft, RotateCcw, X } from 'lucide-react';
import type { Pane, Settings, TerminalHandle } from '../types';
import { themeColors, basename } from '../settings';
import { adaptTerminalRows } from '../terminal-appearance';
import {FILE_PATH_MIME, pathsFromDropData, quoteDroppedPaths} from '../lib/dropped-paths.mjs';
import {bindTerminalInput} from '../lib/terminal-input';
import {createAppKeyHandler} from '../lib/terminal-keyboard.mjs';

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
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState('');
  const dragDepth = useRef(0);
  const canDrop = (data: DataTransfer) => ['Files',FILE_PATH_MIME,'text/uri-list'].some(type => data.types.includes(type));
  const dropPaths = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false); setDropError('');
    const terminal = termRef.current;
    if (!terminal || current.current.pane.status !== 'running') { setDropError('Start a session to insert a path.'); return; }
    try {
      const nativePaths = window.desktop?.droppedFilePaths(Array.from(event.dataTransfer.files)) || [];
      const paths = nativePaths.length ? nativePaths : pathsFromDropData(event.dataTransfer.getData(FILE_PATH_MIME), event.dataTransfer.getData('text/uri-list'));
      if (!paths.length) return;
      const buffer = terminal.buffer.active;
      const previous = buffer.getLine(buffer.baseY + buffer.cursorY)?.getCell(buffer.cursorX - 1)?.getChars() || '';
      const text = (previous && !/\s/.test(previous) ? ' ' : '') + quoteDroppedPaths(paths, current.current.pane.shell);
      current.current.onFocus(pane.id); terminal.paste(text); terminal.focus();
    } catch (error) { setDropError(error instanceof Error ? error.message : 'Could not insert the file path.'); }
  };
  useEffect(() => {
    const desktop = window.desktop;
    if (!container.current || !desktop) return;
    let disposed = false;
    let created = false;
    let exited = false;
    const terminal = new Terminal({
      fontFamily: settings.font, fontSize: settings.fontSize, lineHeight: settings.lineHeight,
      cursorStyle: settings.cursor, cursorBlink: true, allowTransparency: true,
      theme: themeColors[settings.theme], scrollback: settings.scrollback,
      macOptionIsMeta: true, macOptionClickForcesSelection: true, rightClickSelectsWord: true,
      allowProposedApi: false, logLevel: 'off', minimumContrastRatio: 4.5,
      // Applications opt in; unnegotiated shells keep their legacy key encoding.
      vtExtensions: { kittyKeyboard: true },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit); terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon((_event, url) => void desktop.openExternal(url)));
    terminal.open(container.current);
    let viewTimer: ReturnType<typeof setTimeout> | undefined;
    let lastView = '';
    const reportView = () => {
      viewTimer = undefined;
      if (disposed) return;
      const buffer = terminal.buffer.active;
      const lines = Array.from({length:Math.min(8,terminal.rows)},(_,index)=>buffer.getLine(buffer.baseY + terminal.rows - Math.min(8,terminal.rows) + index)?.translateToString(true) || '');
      const text = lines.join('\n');
      if (text !== lastView) {lastView=text;desktop.reportTerminalView(pane.id,lines);}
    };
    const renderListener = terminal.onRender(({start,end}) => {
      if (container.current) adaptTerminalRows(container.current, current.current.settings.theme, start, end);
      if (!viewTimer) viewTimer=setTimeout(reportView,150);
    });
    termRef.current = terminal; fitRef.current = fit;
    terminal.attachCustomKeyEventHandler(createAppKeyHandler(
      terminal,
      text => {void navigator.clipboard.writeText(text);},
      () => {
        void desktop.readClipboardText().then(text => {
          if (!disposed && current.current.visible &&
            document.activeElement === terminal.textarea && current.current.pane.status === 'running' && text) {
            terminal.paste(text);
          }
        }).catch(() => {
          if (!disposed) setDropError('Could not read clipboard text.');
        });
      },
    ));
    const unsubscribeData = desktop.onData(event => { if (event.id === pane.id) terminal.write(event.data); });
    const unsubscribeCwd = desktop.onCwd(event => { if (event.id === pane.id) current.current.onUpdate(pane.id, {cwd: event.cwd}); });
    const unsubscribeExit = desktop.onExit(event => {
      if (event.id === pane.id) {
        exited = true;
        terminal.writeln(`\r\n\x1b[90m[Process exited · code ${event.exitCode}]\x1b[0m`);
        current.current.onUpdate(pane.id, {status: 'exited', editor: null});
      }
    });
    const dataListener = bindTerminalInput(terminal, data => desktop.write(pane.id, data),
      data => desktop.respond(pane.id, data));
    const resizeListener = terminal.onResize(({cols, rows}) => { if (created) desktop.resize(pane.id, cols, rows); });
    const safeFit = () => {
      if (disposed || !container.current?.offsetWidth || !container.current?.offsetHeight) return;
      try { fit.fit(); } catch { /* Panel is being mounted. */ }
    };
    const observer = new ResizeObserver(safeFit); observer.observe(container.current);
    current.current.onHandle(pane.id, {
      focus: () => terminal.focus(), clear: () => { terminal.clear(); desktop.clearTerminal(pane.id); terminal.focus(); },
      paste: text => { terminal.paste(text); terminal.focus(); },
      find: (value, previous) => previous ? search.findPrevious(value, {incremental: true}) : search.findNext(value, {incremental: true}),
      clearSearch: () => search.clearDecorations(),
    });
    void document.fonts.ready.then(async () => {
      if (disposed) return;
      safeFit();
      try {
        const result = await desktop.createTerminal({id: pane.id, cwd: pane.cwd, shell: pane.shell,
          cols: terminal.cols, rows: terminal.rows, editorPath: pane.editorPath});
        created = true;
        if (disposed) { await desktop.closeTerminal(pane.id); return; }
        if (exited) return;
        current.current.onUpdate(pane.id, {status: 'running', pid: result.pid, cwd: result.cwd});
        safeFit();
        desktop.resize(pane.id, terminal.cols, terminal.rows);
        if (current.current.active && current.current.visible) terminal.focus();
      } catch (error) {
        if (!disposed) {
          terminal.writeln(`\x1b[31m${pane.editorPath ? 'Could not open the file in vi.' : 'Could not start the shell.'}\x1b[0m\r\n${String(error)}\r\n`);
          current.current.onUpdate(pane.id, {status: 'error'});
        }
      }
    });
    return () => {
      disposed = true; observer.disconnect(); unsubscribeData(); unsubscribeCwd(); unsubscribeExit();
      clearTimeout(viewTimer);
      dataListener.dispose(); resizeListener.dispose(); renderListener.dispose(); terminal.dispose();
      termRef.current = null; fitRef.current = null; current.current.onHandle(pane.id, null);
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
      if (active && !current.current.pane.remoteControl) termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, visible]);
  return <section className={`terminal-pane ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''}`} onMouseDown={() => props.onFocus(pane.id)}
    onDragEnter={event => {if (canDrop(event.dataTransfer)) {event.preventDefault();dragDepth.current++;setDragging(true);}}}
    onDragOver={event => {if (canDrop(event.dataTransfer)) {event.preventDefault();event.dataTransfer.dropEffect='copy';}}}
    onDragLeave={() => {dragDepth.current=Math.max(0,dragDepth.current-1);if (!dragDepth.current) setDragging(false);}}
    onDrop={dropPaths}>
    {split && <div className="pane-heading"><span><i className={pane.status === 'running' ? 'live-dot' : 'idle-dot'} /> {basename(pane.cwd)} <small>{basename(pane.shell)}</small></span><button className="icon-button" title="Close pane" onClick={() => props.onClose(pane.id)}><X size={13}/></button></div>}
    <div className="shell-caption"><span><i className={pane.status === 'running' ? 'live-dot' : 'idle-dot'} /> {basename(pane.shell)} <span className="caption-separator">/</span> local session</span><span>UTF-8 <CornerDownLeft size={11}/></span></div>
    {pane.remoteControl && <div className="remote-terminal-control">
      <span>Remote device has keyboard control</span>
      <button type="button" onClick={() => void window.desktop?.remote.takeControl(pane.id).then(() => termRef.current?.focus())}>Take back control</button>
    </div>}
    <div className="terminal-mount" ref={container} aria-label={`Terminal ${basename(pane.cwd)}`} />
    {dragging && <div className="terminal-drop-hint"><ArrowDownToLine size={21}/><strong>Drop to insert path</strong><span>Files stay where they are. Press Enter to run.</span></div>}
    {dropError && <div className="terminal-drop-error" role="status"><span>{dropError}</span><button title="Dismiss drop message" onClick={() => setDropError('')}><X size={13}/></button></div>}
    {!window.desktop && <div className="browser-message"><ArrowUpRight size={22}/><strong>Your terminal belongs on the desktop.</strong><p>Start xTerm with <code>npm run dev</code> to connect your real shell.</p></div>}
    {(pane.status === 'exited' || pane.status === 'error') && <button className="restart-session" onClick={() => props.onRestart(pane.id)}><RotateCcw size={14}/> Restart session</button>}
  </section>;
}
