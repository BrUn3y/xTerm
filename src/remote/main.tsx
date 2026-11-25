import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { ChevronDown, Moon, Radio, Sun } from 'lucide-react';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/dm-sans';
import '@xterm/xterm/css/xterm.css';
import { basename, themeColors } from '../settings';
import { bindTerminalInput } from '../lib/terminal-input';
import { formatRemaining } from '../lib/remote-time';
import type { RemoteEvent, State } from './protocol';
import './remote.css';

const statusLabels = {working: 'Working', ready: 'Ready for input', attention: 'Needs attention', running: 'Running'};
type ScreenEvent = Extract<RemoteEvent, {sequence: number}>;
type LinkStatus = 'Connecting' | 'Connected' | 'Reconnecting';
type Send = (type: 'input' | 'claim' | 'release', data?: string) => boolean;

let pairingToken = new URLSearchParams(location.hash.slice(1)).get('pair');
if (location.hash) history.replaceState(null, '', location.pathname);

async function loadState() {
  const response = await fetch('/api/state', {cache: 'no-store', signal: AbortSignal.timeout(8000)});
  if (response.status === 401) return null;
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) throw new Error('Could not reach xTerm.');
  return await response.json() as State;
}

function RemoteApp() {
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState(pairingToken ? 'Pairing with xTerm…' : 'Connecting to xTerm…');

  useEffect(() => {
    let active = true;
    void (async () => {
      let paired = false;
      const token = pairingToken;
      pairingToken = null;
      if (token) {
        const response = await fetch('/api/pair', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token}),
          signal: AbortSignal.timeout(8000),
        });
        paired = response.ok;
      }
      const current = await loadState();
      if (!active) return;
      if (current) setState(current);
      else setMessage(token && !paired
        ? 'This pairing link is invalid or expired. Scan a new QR on the desktop.'
        : 'Scan the Remote Mode QR on the desktop to connect.');
    })().catch(() => { if (active) setMessage('Could not reach xTerm. Check the desktop and try again.'); });
    return () => { active = false; };
  }, []);

  return state ? <Workspace initial={state} onEnd={text => {setMessage(text); setState(null);}}/>
    : <main className="remote-landing"><Radio size={25}/><h1>xTerm Remote</h1><p role="status">{message}</p></main>;
}

function Workspace({initial, onEnd}: {initial: State; onEnd(text: string): void}) {
  const [state, setState] = useState(initial);
  const [id, setId] = useState(initial.sessions[0]?.id ?? '');
  const [link, setLink] = useState<LinkStatus>('Connecting');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const [deadline, setDeadline] = useState(() => performance.now() + initial.remaining);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [ctrl, setCtrl] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const selectRef = useRef<(id: string) => void>(() => {});
  const sendRef = useRef<Send>(() => false);
  const controlRef = useRef(false);
  const ctrlRef = useRef(false);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const initialSession = useRef(initial.sessions[0]?.id ?? '');
  const initialTheme = useRef(theme);
  const selected = state.sessions.find(session => session.id === id);
  const canInput = ready && link === 'Connected' && state.permission === 'commands' && !!selected?.control;

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (now >= deadline) endRef.current('Remote Mode expired.');
  }, [now, deadline]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (terminalRef.current) terminalRef.current.options.theme = themeColors[theme];
  }, [theme]);

  useEffect(() => {
    const element = host.current!;
    const terminal = new Terminal({
      cols: 80, rows: 24, fontFamily: '"JetBrains Mono Variable", monospace',
      fontSize: 13, theme: themeColors[initialTheme.current], scrollback: 500,
      disableStdin: true, vtExtensions: {kittyKeyboard: true}, logLevel: 'off',
    });
    terminalRef.current = terminal;
    terminal.open(element);
    terminal.parser.registerOscHandler(52, () => true);
    const syncWidth = () => {
      const width = terminal.dimensions?.css.canvas.width;
      if (width) element.style.width = `${width}px`;
    };
    const resize = terminal.onResize(syncWidth);
    const dimensions = terminal.onDimensionsChange(syncWidth);
    void document.fonts.ready.then(() => { if (!disposed) syncWidth(); });

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimeout: ReturnType<typeof setTimeout> | undefined;
    let retry = 0;
    let selectedId = initialSession.current;
    let subscription = 0;
    let sequence = -1;
    let receiving = false;
    let writing = false;
    let queue: ScreenEvent[] = [];
    let queued = 0;

    function controls(enabled: boolean) {
      controlRef.current = enabled;
      terminal.options.disableStdin = !enabled;
      if (!enabled) {
        ctrlRef.current = false;
        setCtrl(false);
        setPaste(null);
      }
    }

    function send(type: string, data?: string) {
      if (socket?.readyState !== WebSocket.OPEN || !selectedId || socket.bufferedAmount > 128 * 1024) return false;
      if (type === 'input' && (!controlRef.current || !receiving)) return false;
      const message = JSON.stringify({type, id: selectedId, subscription, data});
      if (message.length > 64 * 1024 && encoder.encode(message).length > 96 * 1024) return false;
      socket.send(message);
      return true;
    }
    sendRef.current = send;

    const encoder = new TextEncoder();
    const binding = bindTerminalInput(terminal, data => {
      if (!controlRef.current) return;
      if (ctrlRef.current) {
        ctrlRef.current = false;
        setCtrl(false);
        if (/^[A-Za-z@[\\\]^_ ]$/.test(data)) data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31);
      }
      if (encoder.encode(data).length > 64 * 1024) {
        setNotice('Paste is limited to 64 KB.');
      } else if (!send('input', data)) setNotice('Input was not sent.');
    });

    function resetScreen() {
      subscription++;
      sequence = -1;
      queue = [];
      queued = 0;
      receiving = false;
      setReady(false);
      controls(false);
    }

    function attach(next: string) {
      selectedId = next;
      setId(next);
      setNotice('');
      resetScreen();
      if (next) send('attach');
    }
    selectRef.current = attach;

    function drain() {
      if (disposed || writing) return;
      while (queue.length) {
        const event = queue.shift()!;
        if (event.type === 'clear') {
          terminal.clear();
          continue;
        }
        if (event.type === 'resize') {
          terminal.resize(event.cols, event.rows);
          continue;
        }
        if (event.type === 'snapshot') {
          terminal.reset();
          terminal.resize(event.cols, event.rows);
        }
        writing = true;
        terminal.write(event.data, () => {
          writing = false;
          if (disposed || event.subscription !== subscription) {drain(); return;}
          queued -= event.data.length;
          if (event.type === 'snapshot') {
            receiving = true;
            setReady(true);
          }
          drain();
        });
        return;
      }
    }

    function receive(event: RemoteEvent) {
      if (event.type === 'state') {
        setState(event);
        setDeadline(performance.now() + event.remaining);
        if (!event.sessions.some(session => session.id === selectedId)) {
          attach(event.sessions[0]?.id ?? '');
        }
        const current = event.sessions.find(session => session.id === selectedId);
        controls(receiving && event.permission === 'commands' && !!current?.control);
        return;
      }
      if (event.type === 'notice') { setNotice(event.text); return; }
      if (event.id !== selectedId || event.subscription !== subscription) return;
      if (event.type === 'exit') {
        resetScreen();
        if (event.code !== undefined) setNotice(`Process exited with code ${event.code}.`);
        return;
      }
      if (event.type !== 'snapshot' && event.sequence !== sequence + 1) { attach(selectedId); return; }
      sequence = event.sequence;
      if ('data' in event) queued += event.data.length;
      if (queue.length >= 2048 || queued > 4 * 1024 * 1024) { socket?.close(4004, 'Output backlog'); return; }
      queue.push(event);
      drain();
    }

    function connect() {
      if (disposed || socket) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/api/socket`);
      socket = ws;
      connectTimeout = setTimeout(() => ws.close(), 10_000);
      ws.onopen = () => {
        clearTimeout(connectTimeout);
        retry = 0;
        setLink('Connected');
        attach(selectedId);
      };
      ws.onmessage = message => {
        if (disposed || socket !== ws) return;
        receive(JSON.parse(message.data) as RemoteEvent);
      };
      ws.onclose = event => {
        clearTimeout(connectTimeout);
        if (disposed || socket !== ws) return;
        socket = null;
        resetScreen();
        if (event.code === 4001 || event.code === 4003) {
          endRef.current(event.reason || 'Remote access ended.');
          return;
        }
        setLink('Reconnecting');
        reconnectTimer = setTimeout(() => void verifyAndConnect(), Math.min(8000, 500 * 2 ** retry++));
      };
    }

    async function verifyAndConnect() {
      try {
        const current = await loadState();
        if (disposed) return;
        if (!current) { endRef.current('Remote access ended. Scan a new QR on the desktop.'); return; }
        setDeadline(performance.now() + current.remaining);
      } catch { /* The tunnel may be briefly unreachable. */ }
      if (!disposed) connect();
    }

    const offline = () => {
      controls(false);
      setLink('Reconnecting');
      socket?.close(4004, 'Network offline');
    };
    const online = () => {
      clearTimeout(reconnectTimer);
      if (!socket) void verifyAndConnect();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(connectTimeout);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      if (socket) {socket.onclose = null; socket.close();}
      binding.dispose();
      resize.dispose();
      dimensions.dispose();
      terminal.dispose();
      terminalRef.current = null;
      sendRef.current = () => false;
    };
  }, []);

  const accessAction = async (action: 'disable' | 'sign-out') => {
    setNotice('');
    try {
      const response = await fetch(`/api/${action}`, {method: 'POST', signal: AbortSignal.timeout(8000)});
      if (!response.ok && response.status !== 401) throw new Error();
      onEnd(action === 'disable' ? 'Remote Mode disabled.' : 'Device signed out.');
    } catch { setNotice('Could not reach xTerm. Try again.'); }
  };
  const touchKey = (key: string, code: string, keyCode: number, control = false) => {
    const textarea = terminalRef.current?.textarea;
    if (!textarea || !controlRef.current) return;
    const event = new KeyboardEvent('keydown', {key, code, ctrlKey: control, bubbles: true, cancelable: true});
    Object.defineProperties(event, {keyCode: {value: keyCode}, which: {value: keyCode}});
    textarea.dispatchEvent(event);
    const release = new KeyboardEvent('keyup', {key, code, ctrlKey: control, bubbles: true});
    Object.defineProperties(release, {keyCode: {value: keyCode}, which: {value: keyCode}});
    textarea.dispatchEvent(release);
  };

  return <main className="mobile-workspace">
    <header className="mobile-header">
      <h1>xTerm<span>_</span></h1>
      <div><strong role="status"><Radio size={14}/> {link}</strong>
        <time aria-label="Time remaining">{formatRemaining(deadline - now)}</time>
        <small>Ends {new Date(state.expiresAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</small>
      </div>
      <button type="button" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
    </header>
    <div className="mobile-session">
      <label htmlFor="shared-session">Shared terminals</label>
      <div className="mobile-select">
        <select id="shared-session" value={id} onChange={event => selectRef.current(event.target.value)} disabled={!state.sessions.length}>
          {!state.sessions.length && <option value="">No terminals are shared</option>}
          {state.sessions.map((session, index) => <option key={session.id} value={session.id}>{basename(session.cwd)} · {basename(session.shell)} · {index + 1}</option>)}
        </select>
        <ChevronDown size={15}/>
      </div>
      {selected && <div className="mobile-session-detail">
        <span>{selected.cwd}</span>
        <span>{selected.agent ? [selected.agent.name, selected.agent.model, statusLabels[selected.agent.status]].filter(Boolean).join(' · ') : 'Shell running'}
          {selected.ssh && ` · SSH ${selected.ssh.target}`}</span>
      </div>}
    </div>
    <section className="mobile-terminal" aria-label="Remote terminal">
      {(!ready || !selected) && <div className="mobile-terminal-status" role="status">
        {notice || (link !== 'Connected' ? link + '…' : selected ? 'Loading terminal…' : 'Share a terminal from the desktop to view it here.')}
      </div>}
      <div className={`mobile-terminal-scroll ${ready && selected ? '' : 'mobile-terminal-hidden'}`}><div ref={host} className="mobile-terminal-host"/></div>
    </section>
    <div className="mobile-controls">
      <div className="mobile-control-status">
        <span>{state.permission === 'view' ? 'View only' : canInput ? 'Keyboard control' : 'Commands allowed'}</span>
        {state.permission === 'commands' && selected && (canInput
          ? <><button type="button" onClick={() => terminalRef.current?.focus()}>Keyboard</button><button type="button" onClick={() => sendRef.current('release')}>Release control</button></>
          : <button type="button" disabled={!ready || link !== 'Connected'} onClick={() => sendRef.current('claim')}>Take control</button>)}
      </div>
      {canInput && <div className="mobile-keys" onMouseDown={event => event.preventDefault()}>
        <button type="button" onClick={() => touchKey('Escape', 'Escape', 27)}>Esc</button>
        <button type="button" onClick={() => touchKey('Tab', 'Tab', 9)}>Tab</button>
        <button type="button" aria-pressed={ctrl} onClick={() => {ctrlRef.current = !ctrlRef.current; setCtrl(ctrlRef.current);}}>Ctrl</button>
        <button type="button" onClick={() => touchKey('c', 'KeyC', 67, true)}>Ctrl+C</button>
        {(['Left', 'Up', 'Down', 'Right'] as const).map((direction, index) => <button key={direction} type="button" aria-label={direction} onClick={() => touchKey(`Arrow${direction}`, `Arrow${direction}`, [37, 38, 40, 39][index])}>{['←', '↑', '↓', '→'][index]}</button>)}
        <button type="button" onClick={() => touchKey('Enter', 'Enter', 13)}>Enter</button>
        <button type="button" onClick={() => setPaste(paste === null ? '' : null)}>Paste</button>
      </div>}
      {paste !== null && canInput && <form className="mobile-paste" onSubmit={event => {event.preventDefault(); terminalRef.current?.paste(paste); setPaste(null);}}>
        <textarea aria-label="Text to paste" placeholder="Paste text here" value={paste} onChange={event => setPaste(event.target.value)}/>
        <button type="submit" disabled={!paste}>Send paste</button>
      </form>}
      {notice && ready && <p role="status">{notice}</p>}
      <div className="mobile-access-actions">
        <button type="button" onClick={() => void accessAction('sign-out')}>Sign out</button>
        <button type="button" onClick={() => void accessAction('disable')}>Disable Remote Mode</button>
      </div>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<RemoteApp/>);
