# Spike 6: Windows image alias `http://klei-img.localhost`

Date 2026-11-14. Run on macOS 26.6 arm64 only, Electron 45.3.2. Code: `electron/spikes/6-windows-alias/`. Status: **partial**, Windows not verified.

## Question
`desktop/src/platform.ts` points images at `http://klei-img.localhost/<batch>/<photo>` on Windows (user agent contains "Windows") and `klei-img://localhost/…` elsewhere. From an `app://klei/` page with `connect-src 'none'`, can one `http` origin be allowed and everything else stay blocked, with no real network traffic?

## Method
Page served by `session.protocol.handle('app')` with CSP `default-src 'self'; img-src 'self' http://klei-img.localhost data:; connect-src 'none'; …`. `session.protocol.handle('http')` returns an SVG for `GET http://klei-img.localhost/<a>/<b>[/full]` and 403 for anything else; `https` is always 403. A real loopback HTTP server counts any request that reaches it.

## Result

| Probe | Result |
|---|---|
| `<img>` `http://klei-img.localhost/b/p` | loaded, served by the handler |
| `<img>` `…/g/gown-1/full` | loaded |
| `<img>` `http://other.localhost/b/p` | blocked by CSP |
| `<img>` `http://127.0.0.1:<port>/real.svg` | blocked by CSP |
| `<img>` `http://klei-img.localhost:<port>/b/p` | blocked: the CSP host source matches port 80 only |
| `<img>` `https://klei-img.localhost/b/p` | blocked |
| `fetch` to the alias or to the real server | blocked by `connect-src 'none'` |
| main-process `session.fetch` to the real server | 403 from the handler |
| requests that reached the real server | 0 |

One probe passed that should be handled: `http://klei-img.localhost/../etc/passwd` is normalised to `/etc/passwd`, matched my generic two-segment pattern and loaded. It is not a file read (the handler maps names to a store, not a path), but the production handler must validate against the same name set as `desktop/src-tauri/src/thumbs.rs::parse`, not a generic pattern.

## Decision
The alias works under the planned CSP on macOS, so the custom-scheme-only variant is not needed yet. 17.5 uses: CSP `img-src` for exactly `http://klei-img.localhost`, a session-scoped `protocol.handle('http')` that serves the strict `parse` set and returns 403 for everything else, and `https` forced to 403.

## Residual risk
- Not verified on Windows, the only OS where the alias is used. Chromium may resolve `*.localhost` itself before the handler runs; macOS showed 0 real-network hits, which is necessary but not sufficient. 17.5 stays blocked for Windows until this is run there. If it fails, use the custom-scheme variant with the URL rewrite in the Electron-owned alias module from 14.4.
- The macOS and Linux path (`klei-img://localhost`) needs a privileged custom scheme and was not tested here.
