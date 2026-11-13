# Epic 19: Isolated CI and cross-platform qualification

**Goal.** Add Electron-only CI beside the existing workflows without changing them: an unfiltered protection job, a build/test workflow, a packaging matrix for every target OS and architecture, and an isolated release workflow with its own tags that publishes only to the download site (18.5).

**MFRs covered.** MFR-1, MFR-2, MFR-7, MFR-8. Baseline requirements: NFR-1, NFR-4, NFR-9.

**Stories.**
- [19.1 Protection workflow](../stories/19.1-protection-workflow.md)
- [19.2 Build and test workflow](../stories/19.2-build-and-test-workflow.md)
- [19.3 Packaging matrix](../stories/19.3-packaging-matrix.md)
- [19.4 Isolated release workflow](../stories/19.4-isolated-release-workflow.md)

**Path rule.** The only allowed additions under `.github/workflows/` are new files named `electron*.yml`. Every script, config and helper those workflows call lives under `electron/`. Existing files `desktop.yml`, `release.yml` and the others stay byte-identical (checked by 14.1).

**Dependency order.** 19.1 needs 14.1 only and ships first. 19.2 needs 15.4 and 19.1. 19.3 needs 18.1 and 19.2. 19.4 needs 18.2, 19.3, 18.3 and 18.5. 20.1 uses 19.2 and 19.3 results.

**Exit evidence.** On a pull request that edits any protected path, the protection job fails whatever files the PR touches; on a pull request that edits only `electron/`, existing workflows do not run for it (their path filters do not match); the packaging matrix produces five artifacts (macOS arm64, macOS x64, Windows x64, Linux AppImage, Linux .deb) and each passes a smoke launch; a dry-run of the release workflow on a `electron-v*` test tag publishes only to the data directory of a throwaway download site. Nothing is claimed as run until a runner executes it.
