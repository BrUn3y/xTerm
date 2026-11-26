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
const {createEditor} = require('./explorer-editor.cjs');
const {isTextFile} = require('./files.cjs');
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
    void session.editor?.close();
    try { session.integration?.cleanup(); } catch (error) { console.warn('Could not remove the temporary shell directory:', error.code); }
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
      let processPty, editor, integration, session;
      try {
        if (options.editorPath !== undefined) {
          if (!await isTextFile(options.editorPath)) throw new Error('The selected file is no longer a text file.');
          editor = await createEditor(options.editorPath);
        } else {
          integration = createShellIntegration(shellPath);
        }
        if (pending.get(options.id) !== reservation) throw new Error('The session was closed before it started.');
        const cols = Math.min(500, Math.max(10, Number.isInteger(options.cols) ? options.cols : 100));
        const rows = Math.min(300, Math.max(3, Number.isInteger(options.rows) ? options.rows : 30));
        processPty = pty.spawn(editor?.executable || shellPath, editor?.args || integration.args, {
          name: 'xterm-256color', cols, rows,
          cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'xTerm', TERM_PROGRAM_VERSION: version(), ...integration?.env },
        });
        session = { id: options.id, process: processPty, cwd, integration, editor, shell: path.basename(shellPath),
          atPrompt: editor || path.basename(shellPath) === 'zsh' ? false : null,
          activityGeneration: 0, inputGeneration: 0, promptInput: 0 };
        session.screen = new TerminalState(cols, rows, event => events.emit('screen', session.id, event),
          paused => paused ? processPty.pause() : processPty.resume());
        session.agentMonitor = new AgentMonitor(agent => updateMetadata(session, 'agent', agent));
        session.sshMonitor = new SshMonitor(ssh => updateMetadata(session, 'ssh', ssh));
        sessions.set(session.id, session);
        if (editor) observeEditor(session, editor);
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
          const generation = session.activityGeneration;
          try {
            if (!await localForeground()) return;
            const valid = await folder(newCwd);
            if (sessions.get(session.id) !== session || generation !== session.activityGeneration) return;
            session.cwd = valid;
            watchSession(session);
            updateMetadata(session, 'cwd', valid);
          } catch { /* The directory may have disappeared between prompts. */ }
        }, atPrompt => {
          if (!atPrompt) { session.activityGeneration++; session.atPrompt = false; return; }
          const generation = session.activityGeneration;
          const inputGeneration = session.inputGeneration;
          // Remote shells can emit identical OSC markers. Only the local foreground
          // shell may clear SSH/harness context or authorize local folder navigation.
          void localForeground().then(local => {
            if (!local || generation !== session.activityGeneration) return;
            session.promptInput = inputGeneration;
            if (session.editor) {
              void session.editor.close();
              session.editor = undefined;
              send('terminal:editor', {id: session.id, editor: null});
            }
            session.atPrompt = true; session.agentMonitor.reset(); session.sshMonitor.reset();
          });
        });
        processPty.onData(data => {
          if (sessions.get(session.id) !== session) return;
          session.agentMonitor.observeOutput(data);
          if (integration) tracker.push(data);
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
        if (session && sessions.get(options.id) === session) destroySession(options.id);
        else {
          try { processPty?.kill(); } catch { /* Already exited. */ }
          void editor?.close();
          integration?.cleanup();
        }
        throw error;
      }
    } finally {
      if (pending.get(options.id) === reservation) pending.delete(options.id);
    }
  }

  function observeEditor(session, editor) {
    editor.observe(state => send('terminal:editor', {id: session.id, editor: state}));
  }

  async function openEditor(id, file) {
    if (!await isTextFile(file)) return 'not-text';
    const session = sessions.get(id);
    if (session?.editor?.file === file) return 'opened';
    const canUseShell = () => session && sessions.get(id) === session && !session.editor && !session.controller &&
      session.atPrompt === true && session.inputGeneration === session.promptInput;
    if (!canUseShell()) return 'new-tab';
    const editor = await createEditor(file);
    try {
      const command = [editor.executable, ...editor.args];
      if (command.some(value => /[\x00-\x1f\x7f]/.test(value)) || !await session.localForeground() || !canUseShell()) return 'new-tab';
      session.process.write(`${command.map(quote).join(' ')}\r`);
      session.activityGeneration++;
      session.atPrompt = false;
      session.editor = editor;
      observeEditor(session, editor);
      return 'opened';
    } finally {
      if (session.editor !== editor) void editor.close();
    }
  }

  function saveEditor(id, file) {
    const session = sessions.get(id);
    if (!session?.editor || session.editor.file !== file) throw new Error('vi is no longer editing this file.');
    if (session.controller) throw new Error('Take back keyboard control before saving the file.');
    return session.editor.save();
  }

  async function navigate(id, directory) {
    const session = sessions.get(id);
    if (!session) throw new Error('The session is no longer active.');
    const target = await folder(directory);
    if (session.atPrompt === false || process.platform !== 'win32' && !await session.localForeground()) throw new Error('A process is running. Return to the prompt or open another tab to change folders.');
    if (sessions.get(id) !== session) throw new Error('The session is no longer active.');
    const command = session.shell === 'powershell.exe' ? `Set-Location -LiteralPath ${quote(target)}` : session.shell === 'cmd.exe' ? `cd /d "${target}"` : `cd -- ${quote(target)}`;
    if (session.controller) throw new Error('Take back keyboard control before changing folders.');
    session.inputGeneration++;
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
      if (!response) {
        session.inputGeneration++;
        session.agentMonitor.observeInput(data);
      }
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

  return {create, refreshAgents, destroySession, destroyAll, write, resize, clear, reportView, setController, navigate, openEditor, saveEditor,
    events, get: id => sessions.get(id)};
}

module.exports = {createSessionManager, folder};
