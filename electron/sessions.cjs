const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const { createShellIntegration, CwdTracker, quote } = require('./shell.cjs');
const { AgentMonitor, parseProcessTable, findHarness } = require('./agents.cjs');
const { SshMonitor, findForegroundSsh, isLocalShellForeground } = require('./ssh.cjs');
const {EventEmitter} = require('node:events');
const {TerminalState} = require('./terminal-state.cjs');
const exec = promisify(execFile);

const folder = async value => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('The path must be absolute.');
  const resolved = await fsp.realpath(value);
  if (!(await fsp.stat(resolved)).isDirectory()) throw new Error('The path is not a directory.');
  return resolved;
};


function createSessionManager({send, defaultCwd, version}) {
  const sessions = new Map();
  const pending = new Map();
  const events = new EventEmitter();
  let pollingAgents = false;

  async function refreshAgents() {
    if (pollingAgents || !sessions.size || process.platform === 'win32') return;
    pollingAgents = true;
    try {
      const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pgid=,tpgid=,stat=,pcpu=,args='], {timeout: 1600, maxBuffer: 4 * 1024 * 1024});
      const processes = parseProcessTable(stdout);
      if (process.platform === 'linux') {
        await Promise.all(processes.filter(value => /^(?:\S*\/)?ssh(?:\s|$)/.test(value.command)).map(async value => {
          try { value.argv = (await fsp.readFile(`/proc/${value.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean); }
          catch { value.argv = []; }
        }));
      }
      for (const session of sessions.values()) {
        session.agentMonitor.setProcess(findHarness(session.process.pid, processes));
        const ssh = findForegroundSsh(session.process.pid, processes);
        if (sessions.get(session.id) !== session) continue;
        if (ssh) session.atPrompt = false;
        void session.sshMonitor.setProcess(ssh, {cwd: session.cwd});
      }
    } catch {
      // A failed sample must not retain a stale SSH transport or timer.
      for (const session of sessions.values()) session.sshMonitor.reset();
    }
    finally { pollingAgents = false; }
  }

  function watchSession(session) {
    session.watcher?.close();
    clearTimeout(session.watchTimer);
    try {
      session.watcher = fs.watch(session.cwd, () => {
        clearTimeout(session.watchTimer);
        session.watchTimer = setTimeout(() => send('files:changed', { id: session.id, cwd: session.cwd }), 180);
      });
      session.watcher.on('error', () => {});
    } catch { /* Remote or inaccessible directories may not support watching. */ }
  }
  function destroySession(id, exitCode) {
    pending.delete(id);
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    session.screen.dispose();
    events.emit('removed', id, exitCode);
    session.agentMonitor?.reset();
    session.sshMonitor?.reset();
    session.watcher?.close();
    clearTimeout(session.watchTimer);
    try { session.process.kill(); } catch { /* Already exited. */ }
    try { session.integration.cleanup(); } catch (error) { console.warn('Could not remove the temporary shell directory:', error.code); }
  }

  async function create(options) {
    if (!options || typeof options.id !== 'string' || !/^[\w-]{1,80}$/.test(options.id) || (sessions.has(options.id) || pending.has(options.id))) throw new Error('Invalid session.');
    if (sessions.size + pending.size >= 24) throw new Error('A maximum of 24 sessions can be open.');
    const reservation = {};
    pending.set(options.id, reservation);
    try {
      const cwd = await folder(options.cwd || defaultCwd());
      if (pending.get(options.id) !== reservation) throw new Error('The session was closed before it started.');
      const shellPath = options.shell || process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
      const allowedShells = new Set([process.env.SHELL, '/bin/zsh', '/bin/bash', 'powershell.exe', 'cmd.exe']);
      if (!allowedShells.has(shellPath)) throw new Error('Shell is not available.');
      const integration = createShellIntegration(shellPath);
      let processPty;
      try {
        const cols = Math.min(500, Math.max(10, Number.isInteger(options.cols) ? options.cols : 100));
        const rows = Math.min(300, Math.max(3, Number.isInteger(options.rows) ? options.rows : 30));
        processPty = pty.spawn(shellPath, integration.args, {
          name: 'xterm-256color', cols, rows,
          cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'xTerm', TERM_PROGRAM_VERSION: version(), ...integration.env },
        });
        const session = { id: options.id, process: processPty, cwd, integration, shell: path.basename(shellPath), atPrompt: path.basename(shellPath) === 'zsh' ? false : null };
        let activityGeneration = 0;
        session.screen = new TerminalState(cols, rows, event => events.emit('screen', session.id, event),
          paused => paused ? processPty.pause() : processPty.resume());
        session.agentMonitor = new AgentMonitor(agent => updateMetadata(session, 'agent', agent));
        session.sshMonitor = new SshMonitor(ssh => updateMetadata(session, 'ssh', ssh));
        sessions.set(session.id, session);
        async function localForeground() {
          if (process.platform === 'win32') return false;
          try {
            const {stdout} = await exec('ps', ['-p', String(processPty.pid), '-o', 'pid=,ppid=,pgid=,tpgid=,stat=,pcpu=,args='], {timeout: 1200});
            const root = parseProcessTable(stdout)[0];
            return sessions.get(session.id) === session && isLocalShellForeground(root, session.shell);
          } catch { return false; }
        }
        session.localForeground = localForeground;
        const tracker = new CwdTracker(async newCwd => {
          if (newCwd === session.cwd || !sessions.has(session.id)) return;
          const generation = activityGeneration;
          try {
            if (!await localForeground()) return;
            const valid = await folder(newCwd);
            if (sessions.get(session.id) !== session || generation !== activityGeneration) return;
            session.cwd = valid;
            watchSession(session);
            updateMetadata(session, 'cwd', valid);
          } catch { /* The directory may have disappeared between prompts. */ }
        }, atPrompt => {
          if (!atPrompt) { activityGeneration++; session.atPrompt = false; return; }
          const generation = activityGeneration;
          // Remote shells can emit identical OSC markers. Only the local foreground
          // shell may clear SSH/harness context or authorize local folder navigation.
          void localForeground().then(local => {
            if (!local || generation !== activityGeneration) return;
            session.atPrompt = true; session.agentMonitor.reset(); session.sshMonitor.reset();
          });
        });
        processPty.onData(data => {
          if (sessions.get(session.id) !== session) return;
          session.agentMonitor.observeOutput(data);
          tracker.push(data);
          send('terminal:data', {id: session.id, data});
          session.screen.enqueue({type: 'output', data});
        });
        processPty.onExit(({exitCode, signal}) => {
          if (sessions.get(session.id) !== session) return;
          send('terminal:exit', {id: session.id, exitCode, signal});
          destroySession(session.id, exitCode);
        });
        watchSession(session);
        return { id: session.id, cwd, shell: session.shell, pid: processPty.pid };
      } catch (error) {
        if (sessions.has(options.id)) destroySession(options.id);
        else {
          try { processPty?.kill(); } catch { /* Already exited. */ }
          integration.cleanup();
        }
        throw error;
      }
    } finally {
      if (pending.get(options.id) === reservation) pending.delete(options.id);
    }
  }

  async function navigate(id, directory) {
    const session = sessions.get(id);
    if (!session) throw new Error('The session is no longer active.');
    const target = await folder(directory);
    if (session.atPrompt === false || process.platform !== 'win32' && !await session.localForeground()) throw new Error('A process is running. Return to the prompt or open another tab to change folders.');
    if (sessions.get(id) !== session) throw new Error('The session is no longer active.');
    const command = session.shell === 'powershell.exe' ? `Set-Location -LiteralPath ${quote(target)}` : session.shell === 'cmd.exe' ? `cd /d "${target}"` : `cd -- ${quote(target)}`;
    if (session.controller) throw new Error('Take back keyboard control before changing folders.');
    session.process.write(`\x15${command}\r`);
  }

  function updateMetadata(session, field, value) {
    if (sessions.get(session.id) !== session) return;
    session[field] = value;
    send(`terminal:${field}`, {id: session.id, [field]: value});
    events.emit('metadata', session.id);
  }

  function write(id, data, controller = null, response = false) {
    const session = sessions.get(id);
    if (!session || typeof data !== 'string' || data.length > 1_048_576) return false;
    if (!response && (session.controller ?? null) !== controller) return false;
    try {
      if (!response) session.agentMonitor.observeInput(data);
      session.process.write(data);
      return true;
    } catch { return false; }
  }

  function resize(id, cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 1000 || rows < 1 || rows > 500) return;
    const session = sessions.get(id);
    if (!session) return;
    try {
      session.process.resize(cols, rows);
      session.screen.enqueue({type: 'resize', cols, rows});
    } catch { /* Resized after exit. */ }
  }

  function reportView(id, lines) {
    if (Array.isArray(lines) && lines.length <= 8 && lines.every(line => typeof line === 'string' && line.length <= 1000)) {
      sessions.get(id)?.agentMonitor.observeScreen(lines.join('\n'));
    }
  }

  function setController(id, controller) {
    const session = sessions.get(id);
    if (!session || session.controller === controller) return;
    session.controller = controller;
    send('terminal:control', {id, remote: !!controller});
    events.emit('metadata', id);
  }

  function destroyAll() {
    pending.clear();
    for (const id of sessions.keys()) destroySession(id);
  }

  const clear = id => sessions.get(id)?.screen.enqueue({type: 'clear'});

  return {create, refreshAgents, destroySession, destroyAll, write, resize, clear, reportView, setController, navigate,
    events, get: id => sessions.get(id)};
}

module.exports = {createSessionManager, folder};
