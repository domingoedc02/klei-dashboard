# Epic 14: Baseline, parity harness and feasibility

**Goal.** Freeze the Tauri baseline, make "original unchanged" a mechanical gate, build an Electron-owned parity harness that reuses the existing screenshot fixtures read-only, and settle the open technical questions (keychain, unsigned macOS install, protocol coexistence, Chromium persistence, ZIP library, Windows image alias, renderer build route) before any Electron code depends on them.

**MFRs covered.** MFR-1, MFR-2, MFR-3, MFR-5, MFR-6, MFR-7. Baseline requirements: NFR-1, NFR-2, NFR-4, NFR-7, NFR-9. No new FR.

**Stories.**
- [14.1 Baseline freeze and protected-path gate](../stories/14.1-baseline-freeze-protected-path-gate.md)
- [14.2 Electron-owned parity harness](../stories/14.2-electron-parity-harness.md)
- [14.3 Feasibility spikes](../stories/14.3-feasibility-spikes.md)
- [14.4 Read-only renderer build and shim feasibility](../stories/14.4-renderer-build-and-shim-feasibility.md)

**Dependency order.** 14.1 first. 14.2, 14.3 and 14.4 each depend only on 14.1 and may run in parallel. 14.3 gates 16.3, 16.5, 18.1, 18.2 and 18.3. 14.4 gates 15.3. 14.2 gates 17.6 and 20.1. 19.1 starts after 14.1.

**Exit evidence.** Recorded baseline SHA and a passing protected-path gate; a harness that produces deterministic baseline captures under `electron/` without touching `docs/planning-artifacts/ui-parity/` or `desktop/node_modules/.vite`; one written decision per spike in `docs/planning-artifacts/electron-migration/` with the library versions checked on the web on the day of the decision; the renderer build route (Option A or B) chosen with a reason. Nothing here is runtime-ready; spike results are evidence, not product.
