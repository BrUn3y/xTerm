const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createShellIntegration, CwdTracker, quote } = require('../electron/shell.cjs');

test('OSC cwd and prompt tracking survive arbitrary PTY chunk boundaries', () => {
  const sequence = '\x1b]7;file://localhost/tmp/my%20folder\x07\x1b]133;A\x07prompt\x1b]133;C\x1b\\command\x1b]7;file://localhost/next\x1b\\';
  for (let chunkSize = 1; chunkSize <= sequence.length; chunkSize++) {
    const paths = [], prompts = [];
    const tracker = new CwdTracker(value => paths.push(value), value => prompts.push(value));
    for (let i = 0; i < sequence.length; i += chunkSize) tracker.push(sequence.slice(i, i + chunkSize));
    assert.deepEqual(paths, ['/tmp/my folder', '/next']);
    assert.deepEqual(prompts, [true, false]);
  }
});
test('Malformed OSC paths cannot crash the tracker or corrupt later events', () => {
  const paths = [];
  const tracker = new CwdTracker(value => paths.push(value));
  tracker.push('\x1b]7;file://localhost/%ZZ\x07plain output\x1b]7;file://localhost/valid\x07');
  assert.deepEqual(paths, ['/valid']);
  tracker.push('x'.repeat(100000));
  assert.ok(tracker.pending.length <= 8);
});

for (const shell of ['/bin/zsh', '/bin/bash'].filter(fs.existsSync)) {
  test(`${path.basename(shell)} keeps user startup files, aliases and current directory reporting`, {timeout: 10000}, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-test-'));
    const original = path.join(home, "user's config");
    fs.mkdirSync(original);
    const isZsh = shell.endsWith('zsh');
    const config = isZsh ? original : home;
    fs.writeFileSync(path.join(config, isZsh ? '.zshenv' : '.bash_profile'), 'export XTERM_TEST_LOADED=yes\n');
    fs.writeFileSync(path.join(config, isZsh ? '.zshrc' : '.bashrc'), "alias xterm_test_alias='printf ALIAS_OK'\n");
    if (!isZsh) fs.appendFileSync(path.join(home, '.bash_profile'), 'source "$HOME/.bashrc"\n');
    const env = {...process.env, HOME: home, ZDOTDIR: original, XTERM_TEST_LOADED: '', HISTFILE: '/dev/null'};
    const integration = createShellIntegration(shell, env);
    const startupSnapshot = fs.readFileSync(path.join(config, isZsh ? '.zshrc' : '.bashrc'), 'utf8');
    try {
      const child = spawn(shell, integration.args, {cwd: home, env: {...env, ...integration.env}, stdio: ['pipe','pipe','pipe']});
      let output = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.stdin.end(`printf 'CONFIG_%s\\n' "$XTERM_TEST_LOADED"\nxterm_test_alias\nprintf '\\n'\ncd -- ${quote(original)}\npwd\nexit\n`);
      await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(output))); });
      assert.match(output, /CONFIG_yes/); assert.match(output, /ALIAS_OK/);
      const paths = []; new CwdTracker(value => paths.push(value)).push(output);
      assert.ok(paths.includes(original), `Missing cwd in ${JSON.stringify(paths)}`);
      assert.equal(fs.readFileSync(path.join(config, isZsh ? '.zshrc' : '.bashrc'), 'utf8'), startupSnapshot);
      const integrationDirectory = isZsh ? integration.env.ZDOTDIR : path.dirname(integration.args[1]);
      integration.cleanup(); assert.equal(fs.existsSync(integrationDirectory), false);
    } finally { integration.cleanup(); fs.rmSync(home, {recursive:true,force:true}); }
  });
}
