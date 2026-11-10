---
status: proposed
workflow: bmad-correct-course
mode: batch
scope: moderate
created: 2026-11-11
author: Ej
drafted with: Claude (UX Designer lead)
prototype: Open Design project 98402068-55fa-4114-a99b-5b49051d7af2 (identical to prototype/v0.1.0)
inputDocuments:
  - docs/planning-artifacts/ui-fidelity-audit.md
  - docs/prd.md
  - docs/epics/epics.md
  - docs/ux-spec.md
  - docs/wireframe-inventory.md
  - docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/EXPERIENCE.md
  - docs/planning-artifacts/sprint-change-proposal-2026-11-10.md
---

# Sprint Change Proposal: desktop layout bugs and remaining prototype drift

## 1. Issue summary

Epic 11 ("UI fidelity") is marked done, yet the AI Upload Review screen shipped with visible layout bugs, and the audit found more across the app.

Reported on Review (screenshot): group list overlaps the form ("Low · check" over Silhouette/Fabric/Neckline); group cards not separated and the selected fill bleeds into the form; "Actions" floats beside the heading; footer overlaps scrolling content and cuts off "AI-written description"; banner "3 photos → 3 gowns" looks wrong.

Root pattern: every Epic 11 screen story ends "Not verified: manual side-by-side with the prototype". Layout was never rendered. jsdom (`css:false`) cannot see it, and the repo has no screenshot tooling.

Evidence: `docs/planning-artifacts/ui-fidelity-audit.md` (29 gap rows, root causes with file:line). All severities are static until story 12.1 renders the app.

Two findings that are not UI defects:
- Banner counts are correct. The screenshot shows 3 singleton groups (confidence 0, "Low"); cause is clustering sensitivity (Epic 10.4 calibration still `ready`). UI gets a hint only.
- "Fonts missing" was a false alarm. Inter woff2 files are bundled.

## 2. Impact analysis

| Area | Impact |
|---|---|
| Epic 11 | None reopened. Stories stay `done`; Epic 12 names the Epic 11 story each fix touches. |
| New Epic 12 | 14 stories (12.1 to 12.14), foundations first. |
| Stories 11.6, 11.10, 11.12 | Behaviour changes by 12.6 (Actions menu replaced by inline panel), 12.12 (Away message moves to Signature, Staff empty rule). Each Epic 12 story lists the existing tests it changes. |
| PRD | No change. No FR added or altered. |
| Architecture | No change. No backend change. |
| UX spec | No edit. `docs/ux-spec.md` S2 already places Away on Signature and U1 describes per-photo Move/Split without an Actions menu; the code is brought to the spec. |
| DESIGN.md | Add scrim and motion tokens (12.2). Regenerate with `node infra/ci/gen-tokens.mjs`; never hand-edit `tokens.css`. |
| Tooling | New `infra/ci/shots.mjs` run with `npx playwright` (cached Chromium, `mockIPC` from the installed `@tauri-apps/api`). No new repo dependency. |
| Dependencies | None added. Playwright is not in `package.json`. |

## 3. Recommended approach

**Direct Adjustment**: add Epic 12 inside the existing plan. No rollback (nothing to revert; fixes are CSS and small TSX), no MVP change.

Rationale: the defects are CSS and layout, with a few small TSX bugs. Rolling back Epic 11 would lose its behaviour work.

Decisions taken (Ej, 2026-11-11):
1. Review: match the prototype's inline Move/Merge/Split panel; remove the Actions menu from Review.
2. Screenshots: Playwright via `npx`, no repo dependency.
3. Away message: move to Settings > Signature (Admin-only), per ux-spec and prototype.
4. Staff empty state: show only at 0 rows.

Assumption to confirm: Undo stays on Review (prototype has none).

Rule when sources differ: prototype wins on layout, DESIGN.md wins on polish. Kept as-is: focus ring `#0063bf`, faint meta `#716c66`, h1 tracking -0.033em, stat 32/600, no uppercase eyebrows, no appointments line, photo cap 200.

Effort: 14 stories. 12.1 M, 12.2 M, 12.3 M, 12.4 S, 12.5 M, 12.6 L, 12.7 S, 12.8 S, 12.9 S, 12.10 S, 12.11 M, 12.12 M, 12.13 S, 12.14 M. Risk: severities are unverified until 12.1; some rows may shrink or grow. 12.5 can ship alone as a hotfix for the reported bugs once 12.1 exists.

Order: 12.1, 12.2, 12.3 (foundations); 12.5 then 12.6 (reported screen); 12.4, 12.7 to 12.13 (per screen); 12.14 sweep and sign-off.

## 4. Detailed change proposals

### Epics

**docs/epics/epics.md**
OLD: Epic list ends at Epic 11.
NEW: `### Epic 12: UI layout fidelity` with stories 12.1 to 12.14 (done in this proposal).
Rationale: index only; stories live in `docs/stories/12.*`.

### Stories (summary; full text in `docs/stories/12.*.md`)

| Story | Change | Audit rows |
|---|---|---|
| 12.1 Screenshot harness | `infra/ci/shots.mjs`, `mockIPC` fixtures, 1100x700 and 1280x800, re-check "static" rows | all |
| 12.2 Frame, tokens, primitives | page padding and max-width, `minmax(0,1fr)` rule, scope `.tools`, dead media queries, scrim and motion tokens, banners above scroller | G-10, 16, 17, 18, 28 |
| 12.3 Shared components | 144px empty art, `.field`, bordered card, skeletons, ErrorBlock button, switch and `.srow`, wrapping tabs | G-22, 23, 26, 28 |
| 12.4 Top bar and bell | AI icon, profile chevron and truncation, 36px icon buttons, unread dots | G-24 |
| 12.5 Review layout fixes | grid, card borders, footer bleed and z-index, scroll clearance, toasts, banner hint, proc grid | G-01, 02, 03, 04, 06, 15, 19, 20 |
| 12.6 Review inline panel | replace Actions menu with Move/Merge/Split panel, list heading, card content, grids | G-05 |
| 12.7 Upload and processing | pass at 1100 vs prototype | G-16 |
| 12.8 Dashboard | 4-up stats, no border+shadow, dates, AI card header, skeleton, links | G-09, 21, 22 |
| 12.9 Gallery | filters, cards, skeleton, empty art, bulk bar, icon | G-23 |
| 12.10 Viewer and edit gown | key guard under dialog, page head, New pill, title | G-07, 08 |
| 12.11 Inquiries, thread, composer, profile | height chain, mail cards, z-index, crumbs | G-11, 12, 25 |
| 12.12 Settings, Signature with Away, Staff | Away card to Signature, Staff `=== 0`, 720 column, art size | G-13, 14, 26 |
| 12.13 Assistant and sign-in | `aria-expanded`, header actions, `.btn-block`, Auth Web copy | G-27, 29 |
| 12.14 Sweep | all screens, focus order, axe, baseline sign-off in the audit | all |

Every UI story: acceptance criteria cite the prototype file and line; one named vitest assertion; one screenshot check at both sizes.

### UX spec

**docs/ux-spec.md**, U1 Review bullet
No edit needed. It already says "Each photo has **Move to…**, **Split into…**" and never names an Actions menu; the app drifted from it. 12.6 brings the code to the spec and the prototype. Undo is not in the spec either (kept, see Open items).

### DESIGN.md

OLD: no scrim token, no motion tokens.
NEW: `color.scrim` at 0.35; `motion.fast/base` (drawer 160ms moves here).
Rationale: G-18. Tokens are generated; regenerate, do not edit `tokens.css`.

## 5. Implementation handoff

Scope: **Moderate**. Backlog reorganisation (Epic 12 appended), no PRD or architecture change.

- Developer agent: implement 12.1 to 12.14 in order, one story at a time through the existing Dev to QA loop. Start with 12.1 so later severities are real.
- PO/SM: sequence Epic 12 after Epic 10.4 only if the singleton-group banner hint needs real thresholds; otherwise independent.
- Not routed: Epic 10.4 calibration (backend, out of scope here).

Success criteria:
- Review at 1100x700 and 1280x800: no overlap, footer clears the last field, selected card visually bounded.
- `cd desktop && npm test && (cd src-tauri && cargo test)` pass.
- `node infra/ci/axe.mjs` clean on Auth Web.
- 12.14 records a side-by-side sign-off per screen in the audit.

Constraints held: existing stack and design system; no backend change; existing components reused (`Icon`, `Menu` elsewhere, `ErrorBlock`, `openDialog`, `Pill`, token pipeline); no new dependency.

## 6. Open items

- Undo on Review (kept; prototype has none).
- Edit gown tag UI: select + chips kept over five comboboxes. Accepted deviation.
- Dashboard empty-state art vs DESIGN.md "widgets never use images": decided in 12.8.
- Settings internals (`PreferencesTab`, `NotificationsTab`, `TwoFactorCard`, `KeysTab`) and the app grid (`styles.css` 1-56) were not audited in depth; 12.1 renders them.
