import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const child = spawn(require('electron'), ['--test', 'tests/pty.integration.cjs', 'tests/agent-pty.integration.cjs', 'tests/ssh-pty.integration.cjs', 'tests/remote-pty.integration.cjs'], {
  stdio: 'inherit', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error); process.exit(1); });
