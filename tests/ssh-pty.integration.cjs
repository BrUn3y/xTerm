const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const pty = require('node-pty');
const {parseProcessTable, AgentMonitor} = require('../electron/agents.cjs');
const {findForegroundSsh, SshMonitor} = require('../electron/ssh.cjs');
const {quote} = require('../electron/shell.cjs');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error(message); await delay(50); }
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('controlled OpenSSH server: direct/alias metadata, foreground isolation, exit, auth failure and interruption', {
  skip: process.platform !== 'linux' || !fs.existsSync('/usr/sbin/sshd'),
  timeout: 45000,
}, async () => {
  const directory = fs.mkdtempSync(path.join(process.getuid() === 0 ? '/root' : os.userInfo().homedir, '.xterm-ssh-test-'));
  const port = await unusedPort();
  const key = path.join(directory, 'client');
  const hostKey = path.join(directory, 'host');
  const config = path.join(directory, 'client.conf');
  const serverConfig = path.join(directory, 'sshd.conf');
  const knownHosts = path.join(directory, 'known_hosts');
  const username = os.userInfo().username;
  const terminals = [];
  let server, serverLog = '';
  async function processes() {
    const {stdout} = await exec('ps', ['-axo','pid=,ppid=,pgid=,tpgid=,stat=,pcpu=,args='], {timeout: 1500, maxBuffer: 4 * 1024 * 1024});
    const values = parseProcessTable(stdout);
    for (const value of values.filter(value => /^(?:\S*\/)?ssh(?:\s|$)/.test(value.command))) {
      try { value.argv = fs.readFileSync(`/proc/${value.pid}/cmdline`, 'utf8').split('\0').filter(Boolean); }
      catch { value.argv = []; }
    }
    return values;
  }
  function terminal() {
    const shell = pty.spawn('/bin/bash', ['--noprofile','--norc','-i'], {
      cwd: directory, cols: 90, rows: 25, name: 'xterm-256color',
      env: {...process.env, PS1: 'LOCAL_READY> ', HISTFILE: '/dev/null'},
    });
    const monitor = new SshMonitor(() => {});
    const harness = new AgentMonitor(() => {});
    let output = '';
    shell.onData(data => { output = (output + data).slice(-20000); harness.observeOutput(data); });
    const value = {process: shell, monitor, harness, output: () => output};
    terminals.push(value);
    return value;
  }
  async function poll(value) { await value.monitor.setProcess(findForegroundSsh(value.process.pid, await processes()), {cwd: directory}); }
  try {
    await exec('ssh-keygen', ['-q','-t','ed25519','-N','','-f',key]);
    await exec('ssh-keygen', ['-q','-t','ed25519','-N','','-f',hostKey]);
    fs.writeFileSync(path.join(directory, 'authorized_keys'), fs.readFileSync(key + '.pub'), {mode: 0o600});
    fs.writeFileSync(knownHosts, `[127.0.0.1]:${port} ${fs.readFileSync(hostKey + '.pub', 'utf8')}`);
    fs.writeFileSync(serverConfig, [
      `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKey}`,
      `PidFile ${directory}/sshd.pid`, `AuthorizedKeysFile ${directory}/authorized_keys`,
      'PasswordAuthentication no', 'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes', 'PermitRootLogin prohibit-password', 'UsePAM no',
      'StrictModes yes', 'LogLevel VERBOSE',
    ].join('\n'));
    fs.writeFileSync(config, [
      'Host controlled-alias', ' HostName 127.0.0.1', ` Port ${port}`, ` User ${username}`,
      'Host *', ` IdentityFile ${key}`, ' IdentitiesOnly yes', ' BatchMode yes',
      ' StrictHostKeyChecking yes', ` UserKnownHostsFile ${knownHosts}`, ' GlobalKnownHostsFile /dev/null',
    ].join('\n'));
    await exec('/usr/sbin/sshd', ['-t', '-f', serverConfig]);
    server = spawn('/usr/sbin/sshd', ['-D','-e','-f',serverConfig], {stdio: ['ignore','ignore','pipe']});
    server.stderr.on('data', data => {serverLog += data;});
    await until(() => serverLog.includes('Server listening'), 'Controlled SSH server did not start');
    const first = terminal(), second = terminal();
    await until(() => first.output().includes('LOCAL_READY') && second.output().includes('LOCAL_READY'), 'PTY shells not ready');
    // A cooperating remote harness emits its existing bridge. The app must
    // preserve it separately from the SSH connection instead of overwriting it.
    const remote = `printf '\\033]777;xterm-agent;{"name":"Remote Harness","model":"local/test","status":"ready"}\\007'; printf 'REMOTE_READY\\n'; read answer`;
    first.process.write(`ssh -F ${quote(config)} -p ${port} ${quote(username + '@127.0.0.1')} ${quote(remote)}\r`);
    await until(async () => {await poll(first); return !!first.monitor.ssh?.endpoint;}, 'Direct SSH endpoint not observed');
    await until(() => /(?:\x07|[\r\n])REMOTE_READY[\r\n]/.test(first.output()) && first.harness.agent?.name === 'Remote Harness', 'Real authenticated remote command did not run');
    assert.equal(first.monitor.ssh.target, '127.0.0.1');
    assert.equal(first.monitor.ssh.user, username); assert.equal(first.monitor.ssh.port, port);
    assert.equal(first.monitor.ssh.endpoint.address, '127.0.0.1');
    assert.equal(first.monitor.ssh.status, 'unknown', 'Even a real authenticated client is not inferred from its process/socket');
    assert.equal(first.monitor.ssh.remoteHostname, null);
    await poll(second); assert.equal(second.monitor.ssh, null);
    const startedAt = first.monitor.ssh.startedAt;
    first.process.write('done\r');
    await until(async () => {await poll(first); return first.monitor.ssh === null;}, 'Normal exit left SSH metadata');
    await delay(10);
    first.process.write(`ssh -F ${quote(config)} controlled-alias ${quote("printf 'ALIAS_READY\\n'; read answer")}\r`);
    await until(async () => {await poll(first); return first.monitor.ssh?.target === 'controlled-alias' && !!first.monitor.ssh.endpoint;}, 'Alias not detected');
    assert.equal(first.monitor.ssh.configuredHost, '127.0.0.1');
    assert.ok(first.monitor.ssh.startedAt > startedAt);
    first.process.write('\x03');
    await until(async () => {await poll(first); return first.monitor.ssh === null;}, 'Interrupted client left SSH metadata');
    first.process.write(`ssh -F ${quote(config)} -J controlled-alias -p ${port} ${quote(username + '@127.0.0.1')} ${quote("printf 'JUMP_READY\\n'; read answer")}\r`);
    await until(async () => {await poll(first); return first.monitor.ssh?.routing === 'proxy' && /[\r\n]JUMP_READY[\r\n]/.test(first.output());}, 'Controlled jump connection did not run');
    assert.equal(first.monitor.ssh.jumpHost, 'controlled-alias');
    assert.equal(first.monitor.ssh.endpoint, null, 'Jump host socket must not be displayed as destination IP');
    first.process.write('done\r');
    await until(async () => {await poll(first); return first.monitor.ssh === null;}, 'Jump exit left metadata');
    first.process.write(`ssh -F ${quote(config)} -l xterm_nonexistent_test_user controlled-alias\r`);
    await until(() => first.output().includes('Permission denied'), 'Controlled authentication failure not seen');
    await poll(first); assert.equal(first.monitor.ssh, null);
    // An unrelated pane/background tunnel must never fill the foreground card.
    second.process.write(`ssh -F ${quote(config)} -N controlled-alias &\r`);
    await until(() => second.output().includes('] '), 'Background client was not launched');
    await poll(second); assert.equal(second.monitor.ssh, null);
    second.process.write('kill %1\r');
    first.process.write(`ssh -F ${quote(config)} controlled-alias ${quote("printf 'LOSS_READY\\n'; read answer")}\r`);
    await until(async () => {await poll(first); return !!first.monitor.ssh?.endpoint;}, 'Loss test connection not detected');
    const clientPid = first.monitor.ssh.pid;
    // Terminate only the controlled server's connection child, not other sshd instances.
    const all = await processes();
    for (const child of all.filter(value => value.ppid === server.pid)) process.kill(child.pid, 'SIGTERM');
    await until(async () => {await poll(first); return first.monitor.ssh === null;}, `Server interruption left metadata for ${clientPid}`);
    assert.match(serverLog, /Accepted publickey/);
    console.log('Controlled OpenSSH evidence: publickey accepted; direct and alias endpoint; jump separation; normal exit; Ctrl+C; auth rejection; server loss; background/pane isolation; harness report preserved.');
  } catch (error) {
    console.error('Controlled server log:', serverLog);
    console.error('Controlled PTY output:', terminals.map(value => value.output()));
    throw error;
  } finally {
    for (const value of terminals) {
      value.monitor.reset(); value.harness.reset();
      try {value.process.kill();} catch {}
    }
    if (server) {server.kill('SIGTERM'); await delay(120);}
    fs.rmSync(directory, {recursive: true, force: true, maxRetries: 4, retryDelay: 50});
  }
});
