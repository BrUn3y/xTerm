// Local UI fixture: no model calls, network access, credentials, or external agents.
const report = status => process.stdout.write(`\x1b]777;xterm-agent;${JSON.stringify({name:'Test Harness',model:'local/test-model',status})}\x07`);
process.stdout.write('\r\nLocal harness fixture. Press Enter to work, Ctrl+C to exit.\r\n');
report('ready');
process.stdin.setRawMode?.(true); process.stdin.resume();
process.stdin.on('data', data => {
  if (data.includes(3)) { report('stopped'); process.exit(0); }
  if (data.includes(13)) {
    report('working');
    setTimeout(() => report('attention'), 1500);
    setTimeout(() => report('ready'), 3000);
  }
});
