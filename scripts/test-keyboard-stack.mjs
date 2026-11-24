import {spawn} from 'node:child_process';
// Required gate for nested restoration and protocol-mandated empty-stack reset.
const child = spawn(process.execPath, ['scripts/test-keyboard-desktop.mjs'], {
  stdio: 'inherit', env: {...process.env, XTERM_TEST_STACK_RESTORE: '1'},
});
child.on('error', error => {console.error(error); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
