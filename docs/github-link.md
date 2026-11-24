# Active GitHub Repository

The header resolves the active pane's working directory through the existing
`desktop.gitInfo` bridge. Git discovers the containing repository, including
subdirectories and linked worktrees. The main process reads local fetch remote
URLs, prefers a GitHub `origin`, and otherwise selects the first GitHub remote.
It does not contact GitHub or return remote credentials.

HTTPS, HTTP, SCP-style SSH, SSH URLs (including `ssh.github.com:443`) and Git
protocol remotes normalize to an HTTPS repository page on `github.com`.
Malformed paths, non-GitHub hosts, unsupported protocols, missing repositories,
missing remotes and inaccessible directories produce no GitHub control.
Custom SSH aliases and GitHub Enterprise hosts are not resolved or inferred.

The control is mounted for the active tab, pane and cwd. Context changes
immediately remove the previous destination; cleanup ignores pending old
responses. File refresh events also refresh the lookup. The icon button has
an owner/repo tooltip, accessible name, visible keyboard focus and uses the
existing HTTP(S)-only `desktop.openExternal` IPC instead of renderer navigation.
The existing preload channel is unchanged.

## Validation

- `npm test` includes parser, origin preference, errors, local real Git,
  subdirectories and linked-worktree regression tests.
- `npm run build` verifies strict TypeScript and the production renderer.
- `npm run test:pty` runs existing real PTY integration coverage.
- `npm run dev:web -- --port 5177 --strictPort` serves the isolated preview.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/ms-playwright/chromium npm run test:github-ui`
  checks the real App with a **simulated desktop bridge**, delayed/out-of-order
  responses, split panes, tabs, cwd changes, lookup failures, refresh,
  Light/Dark geometry, focus and keyboard activation at three sizes.
- `npm run test:github-desktop` (with an available display or under Xvfb) runs native Linux Electron with an
  isolated temporary home, local Git fixtures and actual bash PTYs, including
  nested directories, HTTPS/SSH repositories and empty/non-GitHub directories.
  It verifies sandboxed preload IPC and records `shell.openExternal` calls
  after intercepting the OS boundary. It does not launch a host default browser
  or prove native macOS behavior.

Tests create no remote repositories and access no live GitHub repository.
Screenshots default to `artifacts/`; set `XTERM_UI_TEST_OUTPUT` to override.
