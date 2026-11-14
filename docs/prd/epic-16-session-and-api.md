# Epic 16: Session and API

**Goal.** Port the Rust session layer (`config.rs`, `session.rs`, `keychain.rs`, `pkce.rs`, `loopback.rs`, deep-link and single-instance handling in `lib.rs`, and the commands `api_request`, `sign_in`, `sign_out`, `session_only`, `set_dirty`) to Electron main with identical observable behaviour: validation, timeouts, refresh single-flight, 401 retry, fail-closed credential storage, PKCE with system browser, and cancellation rules.

**MFRs covered.** MFR-1, MFR-2, MFR-3, MFR-4. FRs: FR-1 to FR-6, FR-44 (through the same Auth Web). NFRs: NFR-3, NFR-5, NFR-6.

**Stories.**
- [16.1 Runtime configuration and `api_request`](../stories/16.1-config-and-api-request.md)
- [16.2 Token refresh and session expiry](../stories/16.2-refresh-and-session-expiry.md)
- [16.3 Credential store, `sign_out` and `session_only`](../stories/16.3-credential-store.md)
- [16.4 `sign_in` with PKCE](../stories/16.4-sign-in-pkce.md)
- [16.5 Deep link, single instance and loopback](../stories/16.5-deep-link-and-loopback.md)
- [16.6 `set_dirty`](../stories/16.6-set-dirty.md)

**Dependency order.** 16.1 → 16.2 → 16.3 (also needs 14.3 spike 1) → 16.4 → 16.5 (also needs 14.3 spikes 2 and 3). 16.6 depends only on 15.4 and may run any time after it. Epic 17 stories need 16.2; 17.4 also needs 16.3; 18.3 needs 16.6.

**Exit evidence.** Behaviour tests ported from `desktop/src-tauri/src/session_tests.rs` pass against a local HTTP stub; a real-OS run shows sign-in, refresh, sign-out and loopback fallback against the compose stack (not run in this task); the preview credential entry is separate from the Tauri entry. The Rust test files are the behaviour specification and are not edited.
