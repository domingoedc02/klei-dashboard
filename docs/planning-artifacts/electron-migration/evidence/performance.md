# Performance: cold start and idle memory (story 20.2)

Status: PARTIAL. One machine, one OS, warm file cache. Limits are NFR-2 and are not changed here: cold start to the Sign-in screen <= 3 s (every run), idle memory <= 300 MB over the whole process tree (every run).

The reviewer records the verdict. A single run above a limit is FAIL; the median is context only.

## Method

| Item | Cold start | Idle memory |
|---|---|---|
| Script | `electron/scripts/measure/cold-start.mjs` | `electron/scripts/measure/idle-memory.mjs` |
| Subject | the packaged `release/mac-arm64/Klei Bridal Preview.app` (unsigned dmg build `klei-bridal-preview-0.0.0-mac-arm64.dmg`, sha256 `c55555f891b649b68aecdf4b257bba9bfa382a77651ed135e6c1e9c6a74428da`) | the built app from `electron/build/`, copied to a temp folder and started by folder (same Electron 45.3.2 runtime and code, not the asar package), on a throwaway profile against the loopback mock |
| Measured | `Date.now()` before the process is spawned to two animation frames after the sign-in card is visible | signed in on the dashboard fixtures at the default 1280x800, left untouched for 60 s |
| Runs | 5 | 3 |
| Figure | wall time | macOS `footprint` phys_footprint, summed over the app process and every descendant (main, Renderer, GPU and utility helpers) |
| Output | `electron/parity-out/perf/cold-start-darwin-arm64.json` | `electron/parity-out/perf/idle-memory-darwin-arm64.json` |
| Guard | a run that does not land on the sign-in card marks the report INVALID | Chromium switches are not added: the parity harness's `--disable-gpu` drops the GPU process, so the first idle run (120 MB) was discarded and rerun without it |

Both scripts write only under `electron/parity-out/perf/` (checked by `test/measure.test.ts`).

## Machine

Apple M5, 16 GB, macOS 26.6 (25G72), arm64. Not the mid-range machine the story asks for: this is the developer laptop.

## Results, macOS arm64

### Cold start (warm file cache)

| Run | ms |
|---|---|
| 1 | 473 |
| 2 | 417 |
| 3 | 325 |
| 4 | 367 |
| 5 | 312 |

Median 367 ms, worst 473 ms, limit 3000 ms.

### Idle memory

| Run | Total MB | Main | Renderer | GPU | Utility |
|---|---|---|---|---|---|
| 1 | 146 | 47 | 37 | 55 | 7 |
| 2 | 148 | 48 | 39 | 54 | 7 |
| 3 | 148 | 47 | 39 | 55 | 7 |

Median 148 MB, worst 148 MB, limit 300 MB.

## Verdict

macOS arm64, as run: both numbers are well inside the limits (about 6 s of headroom on start, about 150 MB on memory). Reviewer verdict: CONCERNS, not PASS, because the story's method was not met:

- Cold start used a warm file cache. The story requires an empty cache (`purge` needs root, which this session does not have; first launch after a reboot also qualifies). Run it with `sudo node scripts/measure/cold-start.mjs <binary> --purge`, or after a reboot.
- Start time is measured by a Playwright attach, so it includes the harness's own attach cost; the true figure is lower or equal.
- Idle memory was not taken from the packaged binary (the asar copy is the same code and runtime).
- Hardware is a high-end laptop, not mid-range.
- The Tauri baseline was not measured (optional context).

## Not run

| Target | Cold start | Idle memory |
|---|---|---|
| macOS arm64, purged cache | NOT RUN | n/a |
| macOS x64 | NOT RUN | NOT RUN |
| Windows 11 x64 | NOT RUN | NOT RUN (private-bytes reader written, never executed) |
| Ubuntu 24.04 x64 (xvfb) | NOT RUN | NOT RUN (Pss reader written, never executed) |

NOT RUN is not PASS. The Windows and Linux process-tree readers have not been executed anywhere and may need fixing on first use. If any run exceeds a limit: file mitigation findings (lazy-load main modules, V8 snapshot, unused Chromium features, `asar` layout) against 15.x or 17.x and do not close the story.
