# IBM Bob Artwork

The Bob harness card uses the exact image supplied in issue #4, bundled at
`src/assets/bob-standing-BECrMjXJ.webp`.

## Source

- Official URL: https://bob.ibm.com/assets/bob-standing-BECrMjXJ.webp
- Retrieved directly over HTTPS on November 24, 2026: HTTP 200, `image/webp`.
- Original, unmodified WebP: 11,322 bytes, 512 x 512 pixels.
- SHA-256: `509de4ef3bd4dad1bb8fe4f817c7db9607d33cd143b50c466c5b9b5b7ad244fc`.
- IBM retains ownership. Source, attribution and trademark information are in
  `src/assets/NOTICE.md`, which is also copied into desktop package resources.
  This artwork is excluded from the project's MIT license and other marks' CC0
  notices. No IBM affiliation or endorsement is implied.

## Rendering

`AgentCard` imports the image directly, so missing artwork fails the build rather
than silently retaining the former `b_` monogram. Vite emits a local hashed asset
under `dist/assets/`; Electron loads it from `app.asar` without contacting IBM.
The Bob image uses `object-fit: contain`, centered within its square avatar, and
disables the monochrome filter used for other provider marks. The accessible image
name is **IBM Bob**. Other providers and the idle poster retain their existing UI.

## Reproduction

```sh
npm ci
npm run test:bob-artwork
npm test
npm run build
npm run dev:web -- --port 5176 --strictPort
```

With the preview running, use a second terminal:

```sh
npm run test:bob-ui
npm run test:bob-desktop
```

The asset check validates WebP container completeness and the recorded IBM hash.
The component test requires local Bob artwork and checks other providers and the
idle poster. The browser test uses the real App/AgentCard with a simulated desktop
bridge, rejects external network requests, decodes the actual 512 x 512 image and
checks Light/Dark compact/expanded geometry. Short windows retain the existing
scrolling sidebar; the whole card must be visible after scrolling.

The Electron smoke runs with isolated user-data and networking blocked. A
controlled foreground Node process named `bob.cjs` exercises the real PTY,
process monitor, preload and card. It validates the displayed asset's checksum,
both themes at 1480x940 and 980x620, and return to the idle poster after Ctrl+C.
It does not invoke IBM Bob CLI, a model or a provider.

For an unsigned local macOS Apple Silicon package, without publishing:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder --mac --arm64 --dir -c.mac.identity=null --publish never
XTERM_DESKTOP_TEST_EXECUTABLE="$PWD/release/mac-arm64/xTerm.app/Contents/MacOS/xTerm" npm run test:bob-desktop
```

Packaged smoke additionally requires the displayed file to come from
`app.asar/dist/assets/` and checks that the packaged NOTICE records its hash.
This is artwork/offline validation, not code-signing, notarization or updater
validation. Screenshots are retained locally under `artifacts/bob-ui/` and
`artifacts/bob-desktop/` and are excluded from Git.

## Validation Record: November 24, 2026

Validated on macOS Apple Silicon with Electron 45.4.1, incorporating `main` at
`26d39c1`. The app version and existing preview release workflows were preserved.

- `npm run test:bob-artwork`: passed the exact IBM asset/container/hash check.
- `npm test`: 47 passed, no failures or skips.
- `npm run build`: strict TypeScript and Vite passed; the WebP was emitted locally.
- `npm run test:bob-ui`: both themes at 1480x940 (expanded 319px card), 980x620
  and 780x720 (compact 168px card); actual image decoded, geometry passed,
  no page errors and no remote requests. Screenshots inspected.
- `npm run test:bob-desktop`: passed using a real bash PTY, controlled Bob-named
  process detection, native preload and offline image rendering in both themes.
- Unsigned macOS arm64 directory packaging with `--publish never`: passed.
  The same desktop smoke passed against the packaged executable with networking
  blocked. The decoded image came from `app.asar/dist/assets/` with the exact IBM
  checksum; packaged NOTICE contained the hash and Playwright/preview fixtures
  were excluded. Compact/expanded Light/Dark screenshots inspected.
- `npm run test:pty`: zsh, bash and harness tests passed (3 pass); the opt-in
  controlled OpenSSH server fixture was not enabled (1 skip).
- `npm audit --omit=dev`: zero vulnerabilities.

The published `v0.5.0-beta.1` release excludes this fix; source changes do not
retroactively modify those release artifacts. No IBM Bob CLI session or model
request was used for these checks.
