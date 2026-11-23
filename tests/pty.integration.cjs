const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pty = require('node-pty');
const { createShellIntegration, CwdTracker, quote } = require('../electron/shell.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 7000;
  while (!check()) { if (Date.now() > deadline) throw new Error(message); await delay(20); }
}
for (const shell of ['/bin/zsh', '/bin/bash'].filter(fs.existsSync)) {
  test(`Real PTY: ${path.basename(shell)} supports commands, resize, cwd, Ctrl+C and exit`, {timeout: 15000}, async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-pty-test-')));
    const target = path.join(home, "folder ' special 100%20 á"); fs.mkdirSync(target);
    const integration = createShellIntegration(shell, {...process.env, HOME: home, ZDOTDIR: home});
    let output = '', exited = false;
    const paths = [];
    const tracker = new CwdTracker(value => paths.push(value));
    const terminal = pty.spawn(shell, integration.args, {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: home,
      env: {...process.env, HOME: home, ZDOTDIR: home, HISTFILE: '/dev/null', TERM: 'xterm-256color', TERM_PROGRAM: 'xTerm', ...integration.env},
    });
    terminal.onData(data => { output += data; tracker.push(data); });
    terminal.onExit(() => { exited = true; });
    try {
      await until(() => paths.includes(home), 'Initial shell prompt did not report cwd');
      terminal.write("test -t 0 && printf 'TTY_%s\\n' OK\r");
      await until(() => output.includes('TTY_OK\r\n'), 'Shell is not attached to a TTY');
      terminal.resize(100, 28); terminal.write('stty size\r');
      await until(() => output.includes('28 100\r\n'), 'PTY did not resize');
      terminal.write(`cd -- ${quote(target)}\r`);
      await until(() => paths.includes(target), `Cwd not tracked correctly: ${JSON.stringify(paths)}`);
      terminal.write("printf 'UTF_%s\\n' 'á日本語'\r");
      await until(() => output.includes('UTF_á日本語\r\n'), 'Unicode output was corrupted');
      terminal.write('sleep 30\r'); await delay(80); terminal.write('\x03');
      terminal.write("printf 'INTERRUPT_%s\\n' OK\r");
      await until(() => output.includes('INTERRUPT_OK\r\n'), 'Ctrl+C did not interrupt the foreground process');
      terminal.write('exit\r'); await until(() => exited, 'Shell did not exit');
      assert.ok(exited);
    } catch (error) { throw new Error(`${error.message}\nPTY output: ${JSON.stringify(output.slice(-2500))}`); }
    finally {
      if (!exited) { terminal.kill(); await delay(80); }
      integration.cleanup(); fs.rmSync(home, {recursive:true,force:true,maxRetries:4,retryDelay:25});
    }
  });
}
