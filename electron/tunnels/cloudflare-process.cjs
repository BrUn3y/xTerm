// The IPC channel closes when Electron quits or crashes. This process then
// shuts down cloudflared even if the application could not run its cleanup.
const {spawn} = require('node:child_process');
const {mkdtempSync, rmSync, writeFileSync} = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = Number(process.argv[2]);
if (!process.send || !Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
const directory = mkdtempSync(path.join(os.tmpdir(), 'xterm-tunnel-'));
const config = path.join(directory, 'config.yml');
writeFileSync(config, '{}\n', {mode: 0o600});
const allowed = ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.includes(name.toUpperCase())));
if (process.platform === 'darwin') env.PATH = [env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].filter(Boolean).join(':');

const tunnel = spawn('cloudflared', [
  'tunnel', '--config', config, '--no-autoupdate', '--metrics', '127.0.0.1:0',
  '--loglevel', 'info', '--grace-period', '1s', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`,
], {stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env});
let timeout;
tunnel.on('error', error => {
  if (process.connected) process.send({type: 'error', code: error.code});
});
tunnel.once('close', code => {
  clearTimeout(timeout);
  rmSync(directory, {recursive: true, force: true});
  process.exitCode = code ?? 1;
  if (process.connected) process.disconnect();
});
function stop() {
  if (timeout || !tunnel.pid || tunnel.exitCode !== null || tunnel.signalCode !== null) return;
  tunnel.kill('SIGTERM');
  timeout = setTimeout(() => tunnel.kill('SIGKILL'), 1800);
}
process.once('disconnect', stop);
process.once('SIGTERM', stop);
