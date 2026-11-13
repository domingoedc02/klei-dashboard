# Epic 17: Native features

**Goal.** Port the existing upload, drag/drop, attachment/avatar, archive-export and image-protocol behavior to Electron main/preload without changing the protected renderer or exposing file paths/bytes. Qualify browser-native behavior and Chromium persistence boundaries.

**MFRs covered.** MFR-1, MFR-2, MFR-3, MFR-5. Related product requirements: FR-8, FR-17, FR-21, FR-30; NFR-1, NFR-3, NFR-7.

**Stories.**
- [17.1 Photo upload engine](../stories/17.1-photo-upload-engine.md)
- [17.2 Watched-window drag and drop](../stories/17.2-watched-window-drag-drop.md)
- [17.3 Attachment and avatar uploads](../stories/17.3-attachment-avatar-uploads.md)
- [17.4 Gown archive export](../stories/17.4-gown-archive-export.md)
- [17.5 `klei-img` image protocol](../stories/17.5-klei-img-image-protocol.md)
- [17.6 Webview behavior and persistence parity](../stories/17.6-webview-behavior-parity.md)

**Dependency order.** 17.1 depends on 16.2 and 15.3; 17.2 and 17.3 depend on 17.1; 17.4 depends on 16.2, 14.3 and 15.3; 17.5 depends on 16.2, 15.2 and 14.3; 17.6 depends on 15.3 and 14.2. Execute only after listed prerequisites pass.

**Exit evidence.** All six story checks pass; Rust behavior contracts are covered by Electron tests; the parity harness reports no new UI geometry or interaction regressions; protected-path diff and untracked-path audit are clean; the Chromium business-content sentinel audit finds no persistent business data. Story 17.6 records browser behavior and persistence evidence without modifying the original renderer or existing project files outside approved migration paths.
