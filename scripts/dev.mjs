import { spawn } from 'node:child_process';
import { createServer } from 'vite';
const server = await createServer();
await server.listen();
server.printUrls();
const electron = spawn('node_modules/.bin/electron', ['.', ...process.argv.slice(2)], {
  stdio: 'inherit', env: {...process.env, XTERM_DEV_URL: 'http://127.0.0.1:5173'},
});
let closing = false;
async function close() { if (closing) return; closing = true; electron.kill(); await server.close(); }
electron.on('exit', async (code) => { await close(); process.exit(code || 0); });
electron.on('error', async error => { console.error('Could not open Electron:', error.message); await close(); process.exit(1); });
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
