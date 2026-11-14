# Epic 18: Packaging and manual update

**Goal.** Produce isolated Electron installers for the target OS matrix, qualify unsigned manual distribution, a Thymeleaf download site on its own port behind a secret path, and manual update behavior, and record install/upgrade/reinstall/rollback evidence. No automatic package download, verification, installation or restart.

**MFRs covered.** MFR-1, MFR-2, MFR-6, MFR-7, MFR-8. Related product requirements: FR-43 (explicit Electron-only exception); NFR-1, NFR-2, NFR-3, NFR-4, NFR-6, NFR-9.

**Stories.**
- [18.1 Per-OS Electron packaging](../stories/18.1-electron-packaging.md)
- [18.2 Unsigned distribution qualification](../stories/18.2-unsigned-distribution-qualification.md)
- [18.3 Fixed-page manual update](../stories/18.3-manual-update-flow.md)
- [18.4 Install, upgrade and rollback qualification](../stories/18.4-install-upgrade-rollback-qualification.md)
- [18.5 Download site](../stories/18.5-download-site.md)

**Dependency order.** 18.1 depends on 15.1 and 14.3. 18.2 depends on 18.1 and 14.3. 18.3 depends on 16.1, 16.6, 15.4, 14.3 and 18.1. 18.5 depends on 18.1. 18.4 depends on 18.1, 18.2, 18.3, 18.5 and 17.1–17.6. Complete the prerequisite decisions and stories before release qualification.

**Exit evidence.** Per-OS/architecture installers build and smoke-launch from isolated Electron output; unsigned warnings and documented user-initiated launch steps are recorded; the download site (18.5) lists each version with per-OS downloads, serves `latest.json`, and returns an empty 404 for every path except its secret one, with the server, host name and token still an owner action (OQ-M5); update flow cannot accept renderer URLs and preserves the dirty-work guard; fresh install, manual upgrade, reinstall, rollback, profile separation and credential retention are recorded in `docs/release-checklist-electron.md`. Existing release workflow, install guide and checklist remain unchanged. Passing documentation checks is not evidence of production signing, release-host trust or runtime qualification.
