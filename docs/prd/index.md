# Electron migration: shard index

Documentation-only plan to move the Klei Bridal desktop app from Tauri to Electron with no change to the protected Tauri app. Baseline: commit `463f89f901d2db71e6e2ce8300ea92e7bd128a5e` (re-baselined in Story 21.5; first `51949da2a0f8347c5f1f56fc5d87d8ada6e60643`).

## Authority

| Document | Owns |
|---|---|
| `docs/prd.md` §13 (MFR-1 to MFR-8, risks, OQ-M1 to OQ-M5) | Migration requirements |
| `docs/architecture.md` §13 and `docs/planning-artifacts/architecture/architecture-klei-bridal-dashboard-2026-11-08/ARCHITECTURE-SPINE.md` AD-22 to AD-32 | Target architecture and decisions |
| `docs/brownfield-architecture.md` | Current-state inventory and the Tauri-to-Electron mapping |
| `docs/prd/epic-14-*.md` to `epic-20-*.md` | Epic goals, order and exit evidence |
| `docs/stories/14.1-*.md` to `20.4-*.md` | Story detail, paths, tests and the prototype-unchanged check |
| `docs/epics/epics.md` | Cross-product index (links here; does not duplicate) |

Sections 1 to 12 of the PRD and Epics 1 to 13 stay authoritative for the protected Tauri app. Where the Electron target differs, only the one approved exception applies: a manual **Download update** button in place of automatic update (MFR-6, AD-28, story 18.3).

## Epics

| Epic | Shard | Stories | Needs |
|---|---|---|---|
| 14 Baseline, harness, feasibility | [epic-14](epic-14-baseline-and-feasibility.md) | 14.1 to 14.4 | none |
| 15 Shell and IPC | [epic-15](epic-15-electron-shell-and-ipc.md) | 15.1 to 15.4 | 14.1; 14.4 for 15.3 |
| 16 Session and API | [epic-16](epic-16-session-and-api.md) | 16.1 to 16.6 | 15.4; 14.3 for 16.3 and 16.5 |
| 17 Native features | [epic-17](epic-17-native-features.md) | 17.1 to 17.6 | 15.3, 16.2 |
| 18 Packaging and manual update | [epic-18](epic-18-packaging-and-manual-update.md) | 18.1 to 18.5 | 14.3, 15.1, 16.6, 17.x |
| 19 Isolated CI | [epic-19](epic-19-isolated-ci.md) | 19.1 to 19.4 | 14.1; 19.3 and 19.4 need 18.x |
| 20 Qualification and cutover | [epic-20](epic-20-qualification-and-cutover.md) | 20.1 to 20.4 | 14 to 19 |

Total: 7 epics, 33 stories.

## Method disclosure

BMAD 6.12.4 is installed. Used: `bmad-prd`, `bmad-architecture` (with `lint_spine.py` and the reviewer gate), `bmad-create-epics-and-stories`, `bmad-sprint-planning` readiness gate. **Not installed:** a legacy shard-doc task, a PO checklist task and a brownfield task. The shards here were written by hand in the existing `docs/prd/epic-*.md` and `docs/stories/*.md` layout, and the PO-style check was done with the readiness gate. Run results are in the final report, not here, so this index does not go stale.

## Not claimed

Nothing was built, run, installed or tested. Every test named in a story is a proposal until a runner executes it. Documentation readiness is not runtime readiness.
