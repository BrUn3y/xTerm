const {test} = require('node:test');
const assert = require('node:assert/strict');
const {tokens, parseSshArgs, findForegroundSsh, isLocalShellForeground, readSshConfig, decodeAddress, parseProcTcp, parseLsof, SshMonitor} = require('../electron/ssh.cjs');
const request = args => parseSshArgs(['ssh', ...args]);
const defer = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
const metadata = {configuredHost: 'server.example', user: 'alice', port: 22, jumpHost: null, routing: 'direct', configStatus: 'static'};
const socket = {address: '192.0.2.5', port: 22, state: 'established'};

test('SSH command parser handles direct, alias, explicit port, URI and grouped flags', () => {
  assert.deepEqual(tokens(`ssh -o 'User alice' -p2222 work # comment`), ['ssh','-o','User alice','-p2222','work']);
  assert.equal(request(['alice@work']).target, 'work');
  assert.equal(request(['alice@work']).user, 'alice');
  assert.equal(request(['-vvT', '-p2222', '-l', 'alice', 'work', 'echo', 'remote']).port, 2222);
  assert.equal(request(['-o', 'User=alice', '-oPort=2200', 'work']).user, 'alice');
  assert.equal(request(['ssh://alice@[::1]:2222']).target, '::1');
  assert.equal(request(['ssh://alice@[::1]:2222']).port, 2222);
  assert.equal(request(['--', 'work']).target, 'work');
  for (const args of [['-G','work'], ['-f','work'], ['-W','host:22','jump'], ['-O','check','work'], ['-Q','help'], ['-p'], ['-z','work']]) assert.equal(request(args), null);
  assert.equal(parseSshArgs(['bash','ssh','work']), null);
});

test('SSH discovery requires foreground group membership and PTY ancestry', () => {
  const root = {pid: 100, ppid: 1, pgid: 100, foregroundGroup: 200, state: 'S', command: 'bash'};
  const ssh = {pid: 200, ppid: 100, pgid: 200, foregroundGroup: 200, state: 'S+', command: 'ssh work'};
  const background = {...ssh, pid: 300, pgid: 300, command: 'ssh other'};
  assert.equal(findForegroundSsh(100, [root, background, ssh]).request.target, 'work');
  assert.equal(findForegroundSsh(100, [root, background]), null);
  assert.equal(findForegroundSsh(100, [root, {...ssh, ppid: 999}]), null);
  assert.equal(findForegroundSsh(100, [{...root, foregroundGroup: -1}, ssh]), null);
  assert.equal(findForegroundSsh(100, [root, {...ssh, state: 'T+'}]), null);
  assert.equal(findForegroundSsh(100, [root, {...ssh, command: 'ssh -W host:22 jump'}]), null);
  assert.equal(findForegroundSsh(100, [root, {...ssh, command: 'ssh work', argv: ['ssh','-o','ProxyCommand=ssh -W %h:%p jump','work']}]).request.target, 'work');
});

test('SSH CLI values use OpenSSH first-value precedence before destination user/port', () => {
  assert.equal(request(['-l', 'first', 'second@work']).user, 'first');
  assert.equal(request(['-p', '2222', 'ssh://second@work:3333']).port, 2222);
  assert.equal(request(['-l', 'first', '-l', 'second', 'work']).user, 'first');
  assert.equal(request(['-o', 'User=first', '-l', 'second', 'work']).user, 'first');
  assert.equal(request(['-o', 'Port=3333', '-p', '2222', 'work']).port, 3333);
  assert.equal(request(['-J', 'first', '-o', 'ProxyJump=second', 'work']).options.proxyjump, 'first');
});

test('remote OSC markers cannot authorize local prompt/cwd or clear SSH on exec ssh', () => {
  const root = {pid: 100, pgid: 100, foregroundGroup: 100, state: 'S+', command: '/bin/bash -i'};
  assert.equal(isLocalShellForeground(root, 'bash'), true);
  assert.equal(isLocalShellForeground({...root, command: '-zsh'}, 'zsh'), true);
  assert.equal(isLocalShellForeground({...root, foregroundGroup: 200}, 'bash'), false);
  assert.equal(isLocalShellForeground({...root, command: 'ssh work'}, 'bash'), false);
  assert.equal(isLocalShellForeground(null, 'bash'), false);
});
function fakeConfig(files) {
  return {
    home: '/test', cwd: '/cwd',
    readFile: async file => { if (Object.hasOwn(files, file)) return files[file]; throw Object.assign(new Error('missing'), {code: 'ENOENT'}); },
    readdir: async directory => Object.keys(files).filter(file => file.startsWith(directory + '/') && !file.slice(directory.length + 1).includes('/')).map(file => file.slice(directory.length + 1)),
  };
}
test('static config resolves aliases, includes, negations and first-value precedence', async () => {
  const config = fakeConfig({
    '/test/.ssh/config': 'Include configs/*.conf\nHost * !work\n User nobody\nHost work\n HostName remote.example\n User config-user\n Port 2222\n ProxyJump jump\nHost *\n User fallback',
    '/test/.ssh/configs/first.conf': 'Host work\n User alice',
  });
  const value = await readSshConfig(request(['work']), config);
  assert.equal(value.configuredHost, 'remote.example');
  assert.equal(value.user, 'alice'); assert.equal(value.port, 2222);
  assert.equal(value.jumpHost, 'jump'); assert.equal(value.routing, 'proxy');
  const cli = await readSshConfig(request(['-l','bob','-p','2200','-o','ProxyJump=none','work']), config);
  assert.equal(cli.user, 'bob'); assert.equal(cli.port, 2200); assert.equal(cli.routing, 'direct');
});

test('dynamic or missing configuration is honest and never executes Match/proxy commands', async () => {
  const value = await readSshConfig(request(['-p','2222','-l','alice','work']), fakeConfig({
    '/test/.ssh/config': 'Host work\n Hostname first\nMatch exec "touch /tmp/must-not-run"\n Hostname guessed',
  }));
  assert.equal(value.configStatus, 'unavailable'); assert.equal(value.configuredHost, null);
  assert.equal(value.routing, 'unknown'); assert.equal(value.user, 'alice'); assert.equal(value.port, 2222);
  assert.equal((await readSshConfig(request(['-F','missing','work']), fakeConfig({}))).configuredHost, null);
  assert.equal((await readSshConfig(request(['-F','none','work']), fakeConfig({}))).configuredHost, 'work');
  const proxy = await readSshConfig(request(['-o','ProxyCommand=ssh -W %h:%p jump','work']), fakeConfig({}));
  assert.equal(proxy.routing, 'proxy');
});

test('top-level system config starts active without resetting first-value precedence', async () => {
  const value = await readSshConfig(request(['work']), fakeConfig({
    '/test/.ssh/config': 'Host work\n User alice\nHost other\n Port 9999\n ProxyJump wrong-jump',
    '/etc/ssh/ssh_config': 'User fallback\nPort 2222\nHost *\n HostName system.example',
  }));
  assert.equal(value.user, 'alice');
  assert.equal(value.port, 2222);
  assert.equal(value.configuredHost, 'system.example');
  assert.equal(value.jumpHost, null);
  assert.equal(value.routing, 'direct');
});

test('CLI canonicalization and unresolved hostname tokens never assert a direct endpoint', async () => {
  const config = fakeConfig({});
  for (const option of ['CanonicalizeHostname=yes', 'CanonicalizeHostname=always', 'HostName=server-%n', 'HostName=server-%r', 'HostName=server-%']) {
    const value = await readSshConfig(request(['-o', option, 'work']), config);
    assert.equal(value.routing, 'unknown', option);
    if (option.startsWith('HostName')) assert.equal(value.configuredHost, null);
  }
  const expanded = await readSshConfig(request(['-o', 'HostName=server-%h', 'work']), config);
  assert.equal(expanded.configuredHost, 'server-work');
  assert.equal(expanded.routing, 'direct');
  const value = await readSshConfig(request(['-o', 'CanonicalizeHostname=no', 'work']), fakeConfig({
    '/test/.ssh/config': 'Host *\n CanonicalizeHostname yes',
  }));
  assert.equal(value.routing, 'direct');
});

test('transport parsing associates only owned sockets, handles IPv4, IPv6 and macOS lsof', () => {
  assert.equal(decodeAddress('0100007F'), '127.0.0.1');
  assert.equal(decodeAddress('00000000000000000000000001000000'), '0:0:0:0:0:0:0:1');
  const line = '0: 0100007F:AAFF 050200C0:0016 01 00000000:00000000 00:00000000 00000000 1000 0 12345 1';
  assert.deepEqual(parseProcTcp(line, new Set(['12345'])), [socket]);
  assert.deepEqual(parseProcTcp(line, new Set(['other'])), []);
  assert.deepEqual(parseLsof('p200\nf3\nn127.0.0.1:1234->[::1]:2222\nTST=ESTABLISHED\n'), [{address: '::1', port: 2222, state: 'established'}]);
  assert.deepEqual(parseLsof('p200\nf3\nTST=ESTABLISHED\nn127.0.0.1:1234->192.0.2.5:22\nf4\nTST=LISTEN\nn*:2222\n'), [socket]);
});

test('TCP establishment is not authentication, and proxy/unknown peers are not destination IPs', async () => {
  const monitor = new SshMonitor(() => {}, {resolve: async () => metadata, transport: async () => [socket], now: () => 1000});
  const process = {pid: 200, request: request(['work'])};
  await monitor.setProcess(process);
  assert.equal(monitor.ssh.status, 'unknown'); assert.equal(monitor.ssh.remoteHostname, null);
  assert.deepEqual(monitor.ssh.endpoint, {address: socket.address, port: 22});
  assert.equal(monitor.ssh.durationKind, 'observed-process');
  for (const routing of ['proxy','unknown']) {
    const proxy = new SshMonitor(() => {}, {resolve: async () => ({...metadata, routing}), transport: async () => [socket]});
    await proxy.setProcess(process); assert.equal(proxy.ssh.endpoint, null); assert.ok(proxy.ssh.transportEndpoint);
  }
});

test('monitor clears old metadata/timers on exit, process change and late asynchronous results', async () => {
  let now = 1000;
  const pending = defer();
  const emitted = [];
  const first = new SshMonitor(value => emitted.push(value), {now: () => now, resolve: () => pending.promise, transport: async () => [socket]});
  const second = new SshMonitor(() => {}, {now: () => now, resolve: async () => metadata, transport: async () => []});
  const work = first.setProcess({pid: 200, request: request(['work'])});
  await second.setProcess({pid: 300, request: request(['other'])});
  first.reset(); pending.resolve(metadata); await work;
  assert.equal(first.ssh, null); assert.equal(emitted.at(-1), null);
  assert.equal(second.ssh.target, 'other');
  now = 3000;
  await first.setProcess({pid: 400, request: request(['new'])});
  assert.equal(first.ssh.startedAt, 3000);
  assert.equal(second.ssh.startedAt, 1000);
  await first.setProcess(null); assert.equal(first.ssh, null);
});

test('lost socket and rejected inspection clear previously observed endpoint', async () => {
  let state = [socket];
  const monitor = new SshMonitor(() => {}, {resolve: async () => metadata, transport: async () => {
    if (state === null) throw new Error('unavailable'); return state;
  }});
  const process = {pid: 200, request: request(['work'])};
  await monitor.setProcess(process); assert.ok(monitor.ssh.endpoint);
  state = []; await monitor.setProcess(process); assert.equal(monitor.ssh.endpoint, null);
  state = [{...socket, state: 'connecting'}]; await monitor.setProcess(process); assert.equal(monitor.ssh.status, 'connecting');
  state = null; await monitor.setProcess(process); assert.equal(monitor.ssh.status, 'unknown'); assert.equal(monitor.ssh.transportEndpoint, null);
});
