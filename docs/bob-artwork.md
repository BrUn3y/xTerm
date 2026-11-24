# IBM Bob Artwork: Blocked Draft

Issue #4 is not fulfilled by this draft. The requested file could not be
downloaded from IBM's host on 2026-11-24. One request failed during TLS with
curl exit 35 and an unexpected EOF; no HTTP response or image was received.
This does not establish whether the upstream or gateway caused the failure.
No alternate or generated artwork is included.

The existing `b_` monogram remains until the exact local file is supplied:
`src/assets/bob-standing-BECrMjXJ.webp`.

Requested official source:
https://bob.ibm.com/assets/bob-standing-BECrMjXJ.webp

## Completion Checklist

- Obtain the supplied official bytes from IBM or a maintainer-provided copy
  with verifiable provenance. Do not rename unrelated artwork to match.
- Verify attribution/usage terms. No separate license grant has been verified;
  IBM's artwork is not MIT/CC0 merely because xTerm or other marks are.
- Add the file at the exact local path. The Vite eager URL import will include
  it in the production build without a network image dependency.
- Update `src/assets/NOTICE.md` to remove draft/monogram statements and record
  the asset SHA-256. The packaging config includes this notice as a resource.
- Run `npm run test:bob-artwork`. It checks file presence, WebP container
  completeness and prints SHA-256; it cannot verify provenance by itself.
- Run `npm test` and `npm run build`.
- Start `npm run dev:web -- --port 5176`. Then run `npm run test:bob-ui`
  (install the matching browser using `npx playwright install chromium`, or
  set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium).
- Inspect the real artwork in compact and expanded Light/Dark layouts. The UI
  test uses the real component with a simulated desktop bridge; it does not
  prove native Bob detection. At short window heights the existing sidebar
  scrolls; the test scrolls the entire card into view.
- Inspect the packaged app and verify actual artwork loads offline. No official
  image is present in the current Linux package, so this evidence is pending.

Only after these checks should the PR be marked ready. Its fallback-only tests
currently passing do not mean the artwork or offline criteria are satisfied.
