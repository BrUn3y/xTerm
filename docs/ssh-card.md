# SSH Sidebar Metadata

The SSH card takes precedence over the harness card while an OpenSSH client
belongs to this pane's PTY foreground process group. A harness remains separate
session metadata and appears inside the SSH view when detected locally or
reported through the existing harness bridge. Local process inspection does
not identify a remote harness that has not reported itself.

## Observable Information

- Destination / alias is the requested SSH target, not the local hostname.
- Configured host, user, port and jump host come from launch arguments and a
  conservative static subset of OpenSSH configuration. This is configuration,
  not a report of the remote machine's hostname.
- Destination IP is a numeric TCP peer owned by this SSH PID, only when a single
  established socket and a confidently direct route are observable.
- A proxied or uncertain route never promotes a transport peer to destination
  IP. The jump configuration and transport peer have separate labels.
- No DNS lookup is performed or presented as a confirmed endpoint.
- Remote hostname is `Not reported`; arbitrary terminal output, prompts, OSC 7
  hosts and the local machine's hostname are not trusted remote identity.
- `Connecting` means an owned TCP socket is in SYN_SENT. An established socket
  shows `TCP established` but authentication and SSH status remain `Unknown`.
  There is no production authentication observer or guessed connected state.
- `Observed process time` starts when this foreground client is first sampled.
  It is not authenticated connection time or the exact OS process start time.

The monitor does not parse arbitrary terminal prose as authentication, failure
or hostname evidence. A short-lived failed client can disappear between polls;
its error remains in the terminal, not a fabricated sidebar status. On exit,
failure, suspension/backgrounding, loss of process visibility, pane close or a
new client, the old metadata is removed and the duration resets. Local shell
OSC prompt/cwd markers are accepted only with local foreground shell evidence.
Remote markers cannot erase the SSH/harness context or change local cwd.

## Configuration and Platforms

Static `Host` patterns/negations, literal includes and basename wildcard
includes, `HostName`, `User`, `Port`, `ProxyJump`, and `ProxyCommand` are supported.
First-value configuration precedence and explicit command arguments are
preserved for these fields. Includes are bounded; the monitor never executes
`ssh -G`, `Match exec`, a proxy command, a remote command, or a hostname probe.
Dynamic Match blocks, unsupported expansions, canonicalization, missing custom
configuration and complex include paths keep uncertain values unavailable.
Configuration is resolved once per observed client; changing it while the
client runs cannot reliably change that already-launched connection.

Linux reads exact argv boundaries and PID-owned sockets from `/proc`.
macOS has process-table parsing and numeric PID-scoped `lsof` transport parsing;
that native path requires macOS validation before this PR is ready.
Windows foreground SSH discovery is unavailable; no unrelated processes are
used as a fallback. SSH masters/control commands (`-f`, `-G`, `-O`, `-Q`, `-V`,
`-W`) and unrelated/background clients do not populate the card.

## Validation

Run `npm test`, `npm run build`, and `npm run test:pty`.
The SSH integration starts a temporary OpenSSH server on loopback with ephemeral
keys, a pinned host key, `StrictHostKeyChecking=yes`, and `StrictModes=yes`.
It tests direct targets, ports, config aliases, ProxyJump, foreground and pane
isolation, normal exits, Ctrl+C, auth rejection, server loss and harness reports.
It does not touch user SSH configuration or contact external SSH hosts.
`sshd` is required; this integration is explicitly skipped on unsupported hosts.

UI-only preview:

```sh
npm run dev:web -- --port 5179 --strictPort
node scripts/test-ssh-ui.mjs
```

Open `/tests/fixtures/ssh-preview.html`. This uses the actual App with mocked IPC,
not native SSH evidence. The script verifies Light/Dark, compact layouts,
visible scrollable metadata, timer updates, split/tab selection, harness
coexistence, cleanup and long targets.

Linux native Electron smoke test after building:

```sh
node scripts/test-ssh-desktop.mjs
```

This launches the actual Electron main/preload/renderer and a controlled SSH
server. It covers IPC/PTY delivery, the active split pane, endpoint provenance,
remote OSC isolation, harness coexistence, Light/Dark, normal exit and rejected
authentication. Its remote harness is a controlled protocol fixture, not a
commercial harness. Tests clean up their server, panes and temporary keys.

Both UI scripts use Playwright. `PLAYWRIGHT_MODULE` may name an installed
Playwright ESM module and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select the browser
for the web preview. `XTERM_UI_TEST_OUTPUT` chooses the screenshot directory.
