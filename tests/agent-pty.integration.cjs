const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const {execFile} = require('node:child_process');
const pty = require('node-pty');
const {createShellIntegration, CwdTracker, quote} = require('../electron/shell.cjs');
const {AgentMonitor, parseProcessTable, findHarness} = require('../electron/agents.cjs');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 6000;
  while (!await check()) { if (Date.now() > deadline) throw new Error(message); await delay(40); }
}

test('foreground harness detection and live model/activity work through a real PTY', {skip: !fs.existsSync('/bin/zsh'), timeout: 15000}, async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-agent-pty-')));
  const fixture = path.join(home, 'codex.cjs');
  fs.writeFileSync(fixture, `
process.stdout.write('\\x1b[33mGPT-6.1-Sol\\x1b[0m high · ~\\nWaiting for input\\n');
process.stdin.resume();
process.stdin.on('data', () => { process.stdout.write('Working (esc to interrupt)\\n'); });
setInterval(() => {}, 1000);
`);
  const integration = createShellIntegration('/bin/zsh', {...process.env, HOME:home, ZDOTDIR:home});
  const monitor = new AgentMonitor(() => {});
  let exited = false, ready = false;
  const tracker = new CwdTracker(() => {ready = true;}, atPrompt => {if (atPrompt) monitor.reset();});
  const terminal = pty.spawn('/bin/zsh', integration.args, {name:'xterm-256color', cols:90, rows:25, cwd:home, env:{...process.env, HOME:home, ZDOTDIR:home, TERM_PROGRAM:'xTerm', HISTFILE:'/dev/null', ...integration.env}});
  terminal.onData(data => {monitor.observeOutput(data); tracker.push(data);});
  terminal.onExit(() => {exited=true;});
  try {
    await until(() => ready, 'Shell did not become ready');
    terminal.write(`node ${quote(fixture)} --model local/launch-model\r`);
    await until(async () => {
      const {stdout} = await exec('ps', ['-axo','pid=,ppid=,pgid=,tpgid=,stat=,pcpu=,args='], {timeout:1500,maxBuffer:4*1024*1024});
      const process = findHarness(terminal.pid, parseProcessTable(stdout));
      if (process) monitor.setProcess(process);
      return !!process;
    }, 'Harness was not detected in the shell foreground process tree');
    await until(() => monitor.agent?.model === 'GPT-6.1-Sol' && monitor.agent?.status === 'ready', 'Live model and ready status were not received');
    assert.equal(monitor.agent.provider, 'codex');
    assert.equal(monitor.agent.model, 'GPT-6.1-Sol');
    assert.equal(monitor.agent.status, 'ready');
    terminal.write('work\r');
    await until(() => monitor.agent?.status === 'working', 'Working activity was not reported');
    terminal.write('\x03');
    await until(() => monitor.agent === null, 'Agent card was not cleared after returning to the shell');
    terminal.write('exit\r'); await until(() => exited, 'Shell did not exit');
  } finally {
    if (!exited) {terminal.kill(); await delay(80);}
    integration.cleanup(); fs.rmSync(home, {recursive:true,force:true,maxRetries:4,retryDelay:25});
  }
});
