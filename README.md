# xTerm

A desktop terminal built with Electron, React, TypeScript, xterm.js, and node-pty. An industrial interface in orange, paper, and carbon.

[Website & screenshots](https://brun3y.github.io/xTerm/) · [Download for Mac (Apple Silicon)](https://github.com/BrUn3y/xTerm/releases/download/v0.6.1/xTerm-0.6.1-arm64.dmg) · [Release notes](https://github.com/BrUn3y/xTerm/releases)

Version `0.6.1` restores automatic detection of foreground coding harnesses.
See the [release notes](docs/releases/v0.6.1.md) for installation and validation.
Downloads include macOS Apple Silicon DMG/ZIP, Linux x64 AppImage and SHA-256
checksums. Install updates manually; the in-app updater is still in development.

## Run

Requires Node.js 22.12 or later. On macOS, native modules require Xcode Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/BrUn3y/xTerm.git
cd xTerm
npm install
npm run dev
```

`npm run dev` opens Electron and starts Vite with interface hot reload. `npm run dev:web` previews the interface in a browser; the real shell and filesystem features require Electron.

## Desktop application

```sh
npm run package   # Build the application in release/, without an installer
npm run dist      # Build macOS DMG/ZIP, Windows NSIS, or Linux AppImage
```

Build output is written to `release/`. On Apple Silicon, the default application path is `release/mac-arm64/xTerm.app`. Installers are generated locally with `npm run dist`.

macOS builds use an ad-hoc signature to seal the application and native helpers.
They are not signed with an Apple Developer ID or notarized; macOS may require
approval in Privacy & Security on first launch. Development does not require
signing credentials. A Developer ID and notarization are required for trusted
Apple distribution.

## Appearance

The entire interface is in English, including application menus, preferences, tooltips, and application error messages. File names and shell output come from the filesystem and your existing shell configuration.

- **Light mode** uses the same paper background for the terminal and main workspace. Neutral dark ANSI input panels from CLI applications are adapted to a light surface with readable text; semantic colored backgrounds are preserved. Dark mode restores the original application colors without changing the terminal buffer.
- **Dark mode** switches the entire application to carbon, including the terminal, sidebar, explorer, dialogs, and preferences.
- Use the **Dark mode / Light mode** sun and moon button next to **Open folder** to switch immediately. The command palette and preferences also offer both modes.
- Appearance is saved automatically and survives relaunches. Changing modes preserves running sessions and terminal output.
- Upgrading from the original terminal-only themes starts in Light mode and preserves font, cursor, texture, and other preferences.

JetBrains Mono and IBM Plex Mono are bundled for offline use. Menlo and SF Mono use system fonts with fallbacks. Font size, line spacing, cursor shape, scrollback, and Blueprint / Contours / Clean backgrounds are configurable.

## Harness panel

The orange **HARNESS** card follows the active pane. It fills the remaining sidebar height, expands its identity area when there is room, and compacts as sessions are added. Long session lists scroll once the card reaches its minimum size. When a foreground coding harness is detected, the poster changes to a live instrument panel with its identity, logo or monogram, model, elapsed session time, and activity status. Exiting the harness returns to the poster. Switching tabs or panes shows that session's agent.

Source builds use IBM's official Bob artwork in the Bob card. The image is bundled
locally for offline use and retains its proportions and colors in both themes.
See [artwork source and validation](docs/bob-artwork.md).

Automatic process detection covers Codex, Claude Code, Bob, Gemini CLI, OpenCode, Aider, Goose, GitHub Copilot, Cursor Agent, Amp, Cline, Droid, Qwen Code, Continue, Pi, OpenHands, and custom executables ending in `-agent` or `-harness`. Detection is limited to descendants in the terminal's foreground process group, so unrelated or background agents do not appear in the card.

Models are read from `--model`, `-m`, Codex's `-c model=...`, recognizable model headers, or the live Codex footer (for example, `GPT-6.1-Sol high · ~`). The bottom terminal rows are also read through xterm.js's public buffer API so models remain detectable when a harness draws its footer character by character with cursor positioning. If a harness does not expose its model, the card says **Not reported**. It does not guess from account settings. **Working**, **Ready for input**, and **Needs attention** use terminal signals; when precise activity is unavailable, the neutral status is **Running**. These signals are a best-effort interpretation of each CLI's output, not provider API telemetry. Automatic process detection uses `ps` on macOS/Linux; Windows harnesses can use the reporting protocol below.

Any other harness can report exact status through the terminal, without changing its business logic, by emitting an OSC sequence from its wrapper or lifecycle hooks:

```sh
printf '\033]777;xterm-agent;{"name":"My Harness","model":"provider/model","status":"working"}\007'
```

Supported statuses are `running`, `working`, `ready`, `attention`, and `stopped`. The model field is optional. Send `stopped` when the harness exits, or return to the shell prompt. Reports are scoped to the terminal that emits them; the application does not read global agent conversations or credentials.

## Remote Mode (beta)

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) and make it available on PATH. On macOS, Homebrew's default install locations are also detected. Both `npm run dev` and `npm run build` build the mobile client. Use `npm run build:remote` to rebuild it after editing mobile code during development.

Choose **Enable Remote Mode** in the toolbar or command palette. Select the terminals to share, **View only** or **Allow commands**, and a duration of 1–5 hours. Start Remote Mode and scan the pairing QR on your phone within five minutes. One device can pair at a time. An expired QR can be refreshed without extending the remote session.

In **Allow commands** mode, choose **Take control** on your phone. The desktop can take back control at any time. Commands run with your desktop account's permissions. The phone uses the desktop's terminal dimensions and scrolls horizontally when needed.

Keep xTerm open and the computer online when you lock the screen. Remove a shared terminal or revoke the device from the sidebar, or choose **Disable Remote Mode** on either device. When access ends, existing shells and harnesses continue locally. Cloudflare Quick Tunnels are temporary and Cloudflare terminates TLS for the public connection.

## Motion and terminal space

The terminal welcome banner has been removed to leave more room for commands. The animated artwork sits above the terminal surface at low opacity and never intercepts pointer input. Blueprint animates tracing lines and a scanning beam; Contours uses drifting rings and gentle waves. Working agents add an orange accent. Preferences include **Animate background**, and system **Reduce Motion** is respected. Clean has no background texture.

## Features

- Real pseudoterminal with zsh or bash on macOS: history, aliases, completion, ANSI colors, Unicode, interactive applications, and Ctrl+C.
- Independent tabs and two panes per tab. Click Split again to switch vertical/horizontal layout. Closing the last tab creates a new session.
- Explorer shown by default: follows `cd`, watches filesystem changes, filters files, shows hidden files, copies paths, and reveals files in Finder. Double-click or press Enter on a folder to navigate.
- Click a text file in the Explorer to open it in `vi` with line numbers and mouse or trackpad scrolling. xTerm reuses a ready zsh or bash prompt on macOS and Linux and opens a new terminal tab when the active pane is busy. The Explorer shows **Save** when the file has unsaved edits, and `:w` works inside the editor. This requires a Vim build with timer support on PATH.
- Saved workspace folders and a native folder picker.
- Terminal buffer search, command palette, quick commands, and HTTP/HTTPS links opened in the default browser.
- Git branch and tracked modified-file count when the current directory belongs to a repository.
- Preferences and workspace folders stored locally. Sessions and processes are not restored after closing the application.

Quick commands are **inserted** into the prompt; press Enter to run them. Explorer navigation uses `cd` in the active session. In zsh, navigation is blocked while a foreground process is running; return to the prompt or open a new tab. Foreground activity detection is not available for bash.

Directory integration uses temporary startup files that load your existing configuration. It does not modify `.zshrc`, `.zprofile`, `.bashrc`, or other user configuration files. Temporary files are removed when a session ends. Closing a pane or window terminates its shell processes.

## Drag and drop

Drag files or folders from Finder, or drag an entry from the built-in explorer, onto a terminal pane to insert its absolute path at the cursor. Multiple items are inserted as separate quoted arguments. File names with spaces, quotes, Unicode, or shell metacharacters are quoted for the active shell. Dropping never presses Enter or moves the original files.

Native paths are obtained through Electron's `webUtils.getPathForFile` bridge without reading file contents. Local `file:` URI lists are supported as a fallback. Dropping outside a terminal cannot navigate the application to a file. POSIX quoting is tested with zsh and bash. PowerShell quoting is supported; cmd.exe rejects paths containing expansion/control characters that it cannot safely insert.

## Filesystem permissions

Listing a folder reads its directory entries without consulting child metadata or following symlink targets. File size and dates are read on demand for selected regular files. This avoids incidental access to protected Desktop/Documents folders from a home-directory listing. macOS can still request permission when you explicitly open a protected folder or run a command that accesses it.

## Keyboard shortcuts

| Action | macOS |
| --- | --- |
| New tab | ⌘ T |
| Split pane / change orientation | ⌘ D |
| Close active pane | ⌘ W |
| Open folder | ⌘ O |
| Search terminal | ⌘ F |
| Command palette | ⌘ K |
| Toggle explorer | ⌘ B |
| Preferences | ⌘ , |
| Font size | ⌘ + / − |
| Next / previous tab | Ctrl Tab / Ctrl Shift Tab |
| Copy selection | ⌘ C |
| Paste | ⌘ V |
| Interrupt process | Ctrl C |

On Windows and Linux, menu shortcuts use Ctrl. Copy selection, paste text, toggle explorer, and font-size shortcuts use Ctrl + Shift. In a terminal, Cmd+V and Ctrl+Shift+V read clipboard text and use xterm.js's paste path, including negotiated bracketed paste; they do not send a harness image shortcut. Ctrl+V remains a process key (for example, a harness image-paste action or a shell's quoted insert). Empty or image-only clipboards insert no text. Native Edit > Paste and text fields keep their normal behavior. The application is validated on **macOS Apple Silicon**. Windows and Linux build configurations are included but have not been validated on those platforms. Automatic directory tracking is implemented for zsh and bash.

## Validation

```sh
npm test            # OSC parsing and preservation of zsh/bash configuration
npm run test:pty    # Native PTY, TTY, resize, Unicode, paths, Ctrl+C, and exit
npm run build       # Strict TypeScript checking and production compilation
npm run test:clipboard-desktop # Native clipboard, paste shortcuts, and PTY bytes
npm run test:remote-ui # Mobile browser pairing, input, reconnection, and shutdown
```

See [clipboard validation](docs/clipboard-validation.md) for the baseline
reproduction, real Codex checks, CI coverage and remaining platform limitations.

If you change Electron versions or `node-pty` fails to load, run `npm run rebuild`. PTY tests use Electron's binary to match the native ABI. Shell tests require zsh or bash and are skipped if neither is present.

The draft Shift+Enter work uses negotiated Kitty keyboard reporting, not a
global newline remapping. See [keyboard validation](docs/keyboard-validation.md)
for the real Codex comparison, native test commands and the blocking upstream
stack-restoration failure.

## Project structure

```text
electron/       Main process, IPC bridge, and temporary shell integration
src/            React interface, terminal, explorer, and preferences
docs/           GitHub Pages website, application screenshots, and bundled web fonts
build/          Application icons (SVG, PNG, ICNS, ICO)
scripts/        Development startup, native tests, and icon generation
tests/          Shell and pseudoterminal integration tests
```

The renderer uses context isolation and sandboxing, without direct Node.js access. Native operations pass through a scoped IPC bridge. Popups are blocked and external links are limited to HTTP/HTTPS. Commands run with your user permissions, like other local terminals.

## Website

The static website is published through GitHub Pages from `main`, using the `/docs` folder. It has no build step or external runtime dependencies. Preview it with `python3 -m http.server 4173 --directory docs`, then open `http://localhost:4173`. Screenshots come from the desktop application; update the download URLs and version labels when publishing a new release.

## License

Licensed under the [MIT License](LICENSE). Third-party brand marks are credited in [src/assets/NOTICE.md](src/assets/NOTICE.md).
