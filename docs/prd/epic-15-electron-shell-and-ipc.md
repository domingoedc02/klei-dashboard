# Epic 15: Electron shell and IPC

**Goal.** Stand up the isolated Electron app in `electron/` with the same window, a hardened renderer boundary, a preload shim that satisfies the original renderer's Tauri call surface unchanged, and a closed registry of exactly the nine bridge commands.

**MFRs covered.** MFR-1, MFR-2, MFR-3, MFR-7. Baseline requirements: NFR-2, NFR-4, NFR-5, NFR-9.

**Stories.**
- [15.1 Electron scaffold and window](../stories/15.1-electron-scaffold-and-window.md)
- [15.2 Hardened renderer boundary, `app://` and CSP](../stories/15.2-hardened-renderer-boundary.md)
- [15.3 Preload shim and Channel compatibility](../stories/15.3-preload-shim-and-channel.md)
- [15.4 Closed command registry and error contract](../stories/15.4-closed-command-registry.md)

**Dependency order.** 15.1 (needs 14.1) → 15.2 → 15.3 (also needs 14.4) → 15.4. 15.4 can start its registry and contract test once 15.2 exists, but is closed only after 15.3 proves the transport. Epic 16 starts after 15.4. 17.5 needs 15.2; 17.1, 17.4 and 17.6 need 15.3.

**Exit evidence.** The original renderer, built read-only (14.4), loads in the Electron window at 1280×800 with the CSP intact; a hostile-renderer test is rejected on unknown commands, wrong payloads, foreign frames and navigation; the contract test fails if a tenth command, or a missing one, is added anywhere. No native feature is implemented yet; every command except the registry itself answers `failed: not implemented` until Epic 16 and 17.
