const {fork} = require('node:child_process');
const path = require('node:path');

const URL_PATTERN = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/;
const TIMEOUT = 30_000;

function startCloudflare(port, onFailure, launch = fork) {
  const child = launch(path.join(__dirname, 'cloudflare-process.cjs'), [String(port)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, execArgv: [],
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
  });
  let ready = false;
  let stopping = false;
  let rollingLog = '';
  let timeout;
  let killTimeout;
  let rejectStart;
  const connected = new Promise((resolve, reject) => {
    rejectStart = reject;
    const receive = chunk => {
      if (ready || stopping) return;
      rollingLog = (rollingLog + chunk).slice(-8192);
      const origin = rollingLog.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s|])/i)?.[0];
      if (!origin || !URL_PATTERN.test(origin) || !rollingLog.includes('Registered tunnel connection')) return;
      ready = true;
      rollingLog = '';
      clearTimeout(timeout);
      resolve(origin);
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    timeout = setTimeout(() => reject(new Error('Cloudflare did not connect within 30 seconds.')), TIMEOUT);
    const fail = reason => {
      if (ready && !stopping) onFailure(reason);
      else reject(new Error(reason));
    };
    child.once('error', () => fail('Could not supervise cloudflared.'));
    child.on('message', message => {
      if (message?.type === 'error') fail(message.code === 'ENOENT'
        ? 'Install cloudflared and make it available on PATH to turn on Remote Mode.'
        : 'Could not start cloudflared.');
    });
    child.once('close', () => {
      clearTimeout(timeout);
      clearTimeout(killTimeout);
      if (stopping) return;
      if (ready) onFailure('The Cloudflare tunnel disconnected.');
      else reject(new Error('Cloudflare closed the tunnel before it was ready.'));
    });
  });

  function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timeout);
    rejectStart(new Error('Remote Mode was stopped.'));
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.disconnect();
    killTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 3000);
    killTimeout.unref();
  }

  return {connected, stop};
}

module.exports = {startCloudflare, URL_PATTERN};
