# Spike 5: streaming ZIP writer

Date 2026-11-14. macOS 26.6 arm64, Node 24.22.1. Code: `electron/spikes/5-zip/`.

## Question
Which library writes the 200-photo, 25 MiB-per-photo export (4.88 GiB, over the 4 GiB Zip64 line) in constant memory, with cancellation cleanup and reproducible bytes?

## Method
200 entries of 25 MiB each, produced as 1 MiB chunks, stored (no compression), fixed mtime `2026-01-01T00:00:00Z`, written to a file. Peak RSS from `/usr/bin/time -l`. Integrity by `unzip -t`, entry count by `bsdtar -tf`, extraction by macOS `ditto -x -k`. Cancel at photo 20 of 40: stop adding, destroy the file stream, delete the file. Determinism: two runs 2 s apart, SHA-256 compared.

## Result

| Library | Version (npm modified) | Peak RSS at 200 photos | Archive over 4 GiB | `unzip -t` | `ditto` extraction | Cancel and cleanup | Same bytes twice |
|---|---|---|---|---|---|---|---|
| `@zip.js/zip.js` | 2.25.0 (2026-11-12) | 162 MiB (158 at 100, 167 at 40: flat) | Zip64 automatic | pass | 200 of 200 | pass | yes |
| `archiver` | 8.0.0 (2026-05-08) | 542 MiB (340 at 100, 212 at 40: grows) | pass | pass | 200 of 200 | pass | yes |
| `yazl` | 3.3.1 (2024-11-23) | 142 MiB | pass | pass | **165 of 200, `ditto` fails**, also with `forceZip64Format` (1 of 200) | pass (after unpipe) | yes |
| `fflate` | 0.8.3 | 148 MiB | **no Zip64: corrupt archive** (`bad zipfile offset` from entry 165) | fail | not run | not run | not run |
| `jszip` | 3.10.2 | not run | not run | not run | not run | not run | not run |

## Decision
`@zip.js/zip.js` 2.25.0. It is the only candidate that is flat in memory, extracts completely with the macOS extractor past 4 GiB, and is actively released.

Rejected:
- `archiver`: memory grows with the number of photos (about 540 MiB at 200), which breaks the idle and burst memory budget.
- `yazl`: its archives over 4 GiB fail in macOS `ditto`; last release 2024-11.
- `fflate`: no Zip64, silently writes a corrupt archive over 4 GiB.
- `jszip`: builds the archive in memory by design; rejected without measurement.

## Residual risk
- The spike stops adding entries on cancel and deletes the file. zip.js's own `AbortSignal` option was not exercised; 17.4 tests it. Cancellation of the entry source (the in-flight photo download) is 17.4's job.
- Sources were synthetic, not network streams. Windows Explorer and Linux extractors on a Zip64 archive were not run.
- Rust compresses text entries and stores photos; the spike stored everything. 17.4 sets the level per entry.
