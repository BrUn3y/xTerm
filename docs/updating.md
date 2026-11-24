# In-app Updating: Release and Validation

Status: implementation under review, not production-ready. No signed packaged
upgrade has been validated. macOS Apple Silicon is the first required target;
Windows NSIS and Linux AppImage are configured but their upgrade flows remain
unvalidated. Linux PTY tests or web preview tests are not packaged-update tests.

## Behavior and Security

The packaged main process checks after 15 seconds and every six hours. A failed
check retries after 30 seconds, two minutes and ten minutes, then waits for the
next six-hour check. The titlebar button, command palette and Help menu provide a
manual check. Only newer stable semantic versions are accepted; the public
GitHub provider excludes drafts and prereleases. Metadata must include a matching
architecture/platform artifact and SHA512. Missing assets, offline failures and
invalid metadata leave the terminal usable and expose a sanitized retry state.

Downloads require **Download update**. No background download or install-on-quit
is enabled. **Later** persists a version-specific deferral in the existing
Electron user-data directory; a manual check reveals that version again. The
notification remains in the workspace until deferred. Progress is displayed.
There is no native-notification dependency.

**Restart and update** opens a native warning with Cancel as the default. It
counts active PTYs and explains that shells/processes end and sessions are not
restored. The existing `before-quit` cleanup runs only when the accepted updater
actually quits. Cancelling or failing verification does not initiate PTY cleanup.
The updater does not clear user-data, appearance settings, shell choice or saved
workspace folders. Their survival still requires the real packaged test below.

`electron-updater` verifies artifact SHA512. On macOS, with
`autoInstallOnAppQuit=false`, the ZIP is downloaded first without native staging.
After explicit restart acceptance, Electron's native Squirrel updater stages and
validates the signature. Only its successful `update-downloaded` event invokes
`electron-updater.quitAndInstall`; errors remove pending callbacks and leave
the application running. Native staging times out after two minutes. This
adapter depends on the pinned electron-updater 6.8.11 lifecycle and must be
revalidated when that dependency changes. No signature bypass, bundle-copy
script, renderer-selected feed/path or embedded credential is used.

Real updater operations are disabled in development, web previews and unpackaged
Linux directory builds. Automated tests use doubles or the real GitHubProvider
redirected exclusively to a loopback fixture; they never contact production.

## Bootstrap Limitation

The existing v0.4.0 app has no updater. Users must install the first properly
signed updater-enabled release manually once. In-app upgrades start with that
release; this code cannot retroactively update a running v0.4.0 installation.
The signing status of the existing public v0.4.0 bundle has not been established.
As of November 24, 2026, its assets contain DMG, ZIP and SHA256SUMS.txt but no
latest-mac.yml. Do not advertise it as an updater bootstrap.

## Building Release Artifacts

No release-publishing workflow is enabled by this change. A maintainer must
provide a protected macOS runner/environment and authorize publication separately.
The repository currently has no Apple signing/notarization Actions secrets or
protected release environment; this is a release blocker, not a reason to make
unsigned updates work.

Use a Developer ID Application certificate with a stable team identity.
Protected credentials use electron-builder's standard `CSC_LINK` plus
`CSC_KEY_PASSWORD`, or `CSC_NAME` for an identity already installed in the
runner's protected keychain. Never commit/export credentials into the bundle.
Notarization uses one complete protected set:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`

Hardened runtime and notarization are enabled. The entitlements permit Electron
JIT/executable memory without disabling signature validation. Run on macOS:

```sh
npm ci
npm test
npm run test:pty
npm run dist:release:mac
```

The release preflight rejects Linux, missing signing/notary configuration,
disabled identity discovery and explicit ad-hoc identities. Its credential
presence check is not proof of a valid signature: inspect the built artifacts.
The script always uses `--publish never`, so it cannot publish during validation.
It also sets `forceCodeSigning=true` so electron-builder must produce a signed app.
Do not bump the version as part of this implementation; maintainers assign
distinct source/target versions for the eventual test and release.

Retain/upload the exact outputs together to the same stable GitHub Release:

| Platform | Required toolchain output |
| --- | --- |
| macOS arm64 | `xTerm-VERSION-arm64.dmg`, `xTerm-VERSION-arm64.zip`, `latest-mac.yml`, ZIP `.blockmap` |
| Windows x64 | NSIS `.exe`, `latest.yml`, generated `.blockmap` |
| Linux x64 | `.AppImage`, `latest-linux.yml`, embedded blockmap |
| Other architectures | Separate named artifacts and the toolchain's matching channel metadata |

The YAML contains SHA512 checksums and sizes generated by electron-builder; never
hand-edit hashes or rename artifacts after generation. Preserve every generated
blockmap. A separate SHA256SUMS.txt may supplement these checksums, not replace
metadata verification. When combining macOS architectures, aggregate metadata
from one coordinated build so publishing one architecture does not overwrite
the other's latest-mac.yml. The first release should claim only arm64 macOS
after the test below, not all configured targets.

## Mandatory Signed Apple Silicon Upgrade

Record evidence for two properly signed updater-enabled builds using the same
app ID, team identity and user-data path. Use an isolated validation repository/
feed in a test-only build, not an override exposed through production IPC.
Publication of any test release needs separate maintainer authorization.

1. On a real Apple Silicon Mac, record OS/hardware, source/target versions,
   artifact hashes and signing identity. Verify both bundles with
   `codesign --verify --deep --strict --verbose=2`, inspect
   `codesign -dv --verbose=4`, and validate notarization with `spctl --assess`
   and `xcrun stapler validate`. Check the installed app is writable.
2. Install the signed source build manually. Save Light/Dark preference,
   font choice, shell choice and several workspace folders. Open multiple
   terminals with controlled running processes.
3. Detect the newer stable test release automatically and manually. Capture
   the version and release-notes link. Check that no download starts first.
4. Defer; allow another scheduled check and relaunch. The same version must
   stay deferred. Manual check must reveal it. Download and capture progress.
5. Reject restart once and show the PTYs/processes are still alive. Accept
   restart; capture native signature verification and the installed target
   version after relaunch. Verify all saved preferences/folders survived and
   no process restoration was promised.
6. Use isolated negative fixtures for equal/older versions, draft/prerelease,
   missing YAML/ZIP, malformed YAML, offline/interrupted transfer, tampered
   checksum and a wrong/invalid signature. Invalid updates must never install;
   retain logs, screenshots, hashes, commands and outcomes.
7. Repeat packaged tests separately before claiming NSIS or AppImage support.

## Current Evidence

Local unit tests cover state transitions, semantic version decisions, consent,
deferral persistence, backoff, sender/payload validation, sanitized states and
native-confirmation cancellation. A real GitHubProvider on an isolated loopback
feed covers stable selection and checksum rejection/retry. Those are automated
tests, not macOS signature/notarization or relaunch evidence. See the PR and
overnight issue-5-status.md for actual commands/results and screenshots.

Reproduce interface checks after `npm ci`:

```sh
npx playwright install chromium
npm run dev:web -- --port 5175 --strictPort
# In a second terminal:
npm run test:updates-ui
npm run build
npm run test:updates-desktop
```

The web test uses a mocked bridge at desktop/compact widths and audits only the
new notification with axe. The desktop smoke test launches Electron with an
isolated home, checks development updating is disabled, validates the real bridge
and keeps a bash PTY usable. On Linux CI it needs a display (`xvfb-run` is suitable).
Root-only test launches pass `--no-sandbox` to Chromium; production renderer
preferences still require sandbox/contextIsolation with nodeIntegration disabled.

A Linux directory-package smoke can use
`XTERM_DESKTOP_TEST_EXECUTABLE=/absolute/path/to/release/linux-unpacked/xterm-desktop`
with `npm run test:updates-desktop`. It must report updates unavailable when
`APPIMAGE` is unset. This checks packaging/IPC, not an AppImage upgrade.

References: [electron-updater](https://www.electron.build/auto-update.html),
[Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater),
[electron-builder macOS signing](https://www.electron.build/code-signing-mac.html).
