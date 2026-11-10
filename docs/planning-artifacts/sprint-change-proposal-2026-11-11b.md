---
status: proposed
supersedes: docs/planning-artifacts/sprint-change-proposal-2026-11-11.md
workflow: bmad-correct-course
mode: batch
scope: moderate
created: 2026-11-11
author: Ej
drafted with: Claude (UX Designer lead)
prototype: /Users/ej/Downloads/Klei-Bridal-Dashboard-Prototype (Open Design project 98402068-55fa-4114-a99b-5b49051d7af2)
inputDocuments:
  - docs/planning-artifacts/ui-parity/audit.md
  - docs/planning-artifacts/ui-parity/report.json
  - docs/planning-artifacts/ui-parity/geometry.json
  - docs/planning-artifacts/ui-parity/copy.json
  - docs/prd.md
  - docs/epics/epics.md
  - docs/ux-spec.md
  - docs/wireframe-inventory.md
  - docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/EXPERIENCE.md
  - docs/planning-artifacts/sprint-change-proposal-2026-11-10.md
---

# Sprint Change Proposal: UI/UX parity with the prototype (Epic 13)

## 1. Issue summary

Trigger: Epic 11 ("UI fidelity") is `done`, yet the rendered desktop app does not match the prototype in layout, spacing, components or behaviour. The user's requirement is strict: the desktop UI and function match the prototype (`drawing-*.png` ignored).

Problem type: failed approach. Epic 11 and the Epic 12 draft both worked from CSS and TSX reads. Nothing was rendered, so overlap, clipping and behaviour gaps stayed invisible. Epic 12 (14 stories, none started) inherits the same method, and its audit rows were "static".

Evidence (all rendered, 1440x900, same fixtures on both sides):
- 53 prototype/desktop screenshot pairs plus 16 desktop-only states (`ui-parity/{prototype,desktop}/`), pixelmatch montages (`ui-parity/diff/`), in-page geometry probe (`geometry.json`) and copy diff (`copy.json`).
- Audit `ui-parity/audit.md`: **182 gaps, P1 21, P2 115, P3 46**, each with prototype ref, desktop ref, root cause, owner story.
- Geometry probe, desktop only (prototype has 0 real findings): Review savebar over list and form, keychain hint over buttons, Edit-gown dialog taller than its box (974 px in 866 px), Notifications event label glued to its help text.
- User-reported Review defects confirmed by render: group list collides with the form, "Actions" floats beside the heading, savebar covers content, list is cut off (UR-01 to UR-05).


## 2. Impact analysis

### Checklist status

| Item | Status |
|---|---|
| 1.1 to 1.3 Trigger, problem, evidence | [x] Epic 11 `done` with unrendered fidelity; evidence is `audit.md` |
| 2.1 to 2.5 Epic impact | [x] Epic 11 stays closed. Epic 12 superseded (no story started). New Epic 13 added last |
| 3.1 PRD | [x] No FR or NFR changes |
| 3.2 Architecture | [x] No change. No API or backend change |
| 3.3 UX specs | [!] Five spec/prototype conflicts need a decision (section 4.3). No silent spec edits |
| 3.4 Other artifacts | [x] Epics index, Epic 12 stories and two old planning docs marked superseded (done, commit `60a241a`) |
| 4.1 Direct adjustment | [x] Viable |
| 4.2 Rollback | [N/A] Fixes are CSS and TSX layout; Epic 11 behaviour work is kept |
| 4.3 MVP review | [N/A] No scope reduction |
| 6.4 `sprint-status.yaml` | [N/A] No such file in this repo |

### Epics and stories

| Area | Impact |
|---|---|
| Epic 11 | Not reopened. Epic 13 stories name the Epic 11 story each fix touches |
| Epic 12 | Superseded in full. Still-valid content is reused as input: 12.6 (inline Move/Merge/Split design), 12.5 root causes, 12.2 token list |
| Epic 13 | New. 16 stories, section 4.1 |
| Existing tests | Several unit tests encode the current (non-prototype) behaviour and change with their story: Review Actions-menu tests (13.8), `PreferencesTab.test.tsx:89` and Notifications (13.13), Staff/Away tests (13.13), Assistant `send()` (13.4) |

### Technical impact

- Code: `desktop/src/styles.css` (single file, 623 lines), `desktop/src/{shell,dashboard,upload,gallery,inquiries,settings,assistant}/*.tsx`, `App.tsx`.
- Tokens: `backend/app/src/main/resources/static/tokens.css` is generated. Change `DESIGN.md` tokens, run `node infra/ci/gen-tokens.mjs`, never hand-edit.
- Backend and API contracts: unchanged. Any story that needs a backend change stops and says so (candidates: ST-04 editable email, ST-03 role-change timing).
- Tooling: Playwright, pixelmatch and pngjs are devDependencies of `desktop/` only (commit `8bffb62`), never the backend.
- Bundle size and runtime: unchanged.

## 3. Recommended approach

**Direct Adjustment**: add Epic 13, replacing Epic 12.

Rationale: every gap is front-end layout, component or copy, plus a small amount of behaviour (Review multi-select and inline panel, Assistant optimistic bubble, Away move, viewer edit control model). Rollback of Epic 11 would lose behaviour work. No MVP change.

Method change (the real fix): every story closes against **rendered evidence**, not a CSS read.
1. Fixtures mirror prototype `js/data.js`, so text and counts match.
2. `npm run shots -- --only <screen>` captures both sides at 1440x900; `npm run shots:diff` writes the pixelmatch %, geometry flags and the montage.
3. A story is done when: unit tests pass, geometry flags for its screens are 0 (overlap, covered, clipped, glued, offscreen, dialog overflow), its audit rows are `closed` with a fix commit and after-screenshot, and the lead has looked at every pair.
4. Pixel % is a report metric, not a gate; the prototype uses SVG wireframe art and mock data.

Rule when sources differ (carried over): prototype wins layout; `DESIGN.md` wins polish (focus ring `#0063bf`, faint meta `#716c66`, h1 tracking -0.033em, stat 32/600). A DESIGN.md value that contradicts a prototype pixel is listed as a decision, not applied silently.

Effort and risk:

| Story | Rows | Size |
|---|---|---|
| 13.1 | harness (done) | n/a |
| 13.2 | 6 | M |
| 13.3 | 7 | M |
| 13.4 | 17 | L |
| 13.5 | 20 | M |
| 13.6 | 14 | M |
| 13.7 | 16 | L |
| 13.8 | 4 | L |
| 13.9 | 13 | M |
| 13.10 | 14 | L |
| 13.11 | 22 | L |
| 13.12 | 3 | S |
| 13.13 | 22 | L |
| 13.14 | 18 | L |
| 13.15 | 6 | S |
| 13.16 | sweep | M |

Risks:
- 13.11 and 13.13 carry 22 rows each. Split at story-writing time if a story exceeds one dev session.
- Fixtures can hide real-data cases. Add long-name and many-item fixtures (UR-21 is unproven without one).
- Prototype is fixed 900 px high, desktop fills the window. Parity is judged at 1440x900; the 1100x700 minimum window is swept in 13.16.
- Fonts: Inter is bundled; prototype has no `@font-face`. The harness uses the same font on both sides.

Timeline impact: none on release scope; this is a new epic after Epic 11.

## 4. Detailed change proposals

### 4.1 Epic 13 and stories

**docs/epics/epics.md**
OLD: Epic list ends at "Epic 12: UI layout fidelity (SUPERSEDED by Epic 13, 2026-11-11; no story started)".
NEW: add `### Epic 13: UI/UX parity with prototype` after it. FRs: none new (screen changes only). NFRs: NFR-5, NFR-7, NFR-9. Stories 13.1 to 13.16 below.
Rationale: index only; stories live in `docs/stories/13.*`.

| Story | Scope | Audit rows | Reuses |
|---|---|---|---|
| 13.1 Parity harness | Capture/diff scripts, Tauri shim, fixtures, probe. Done in commit `8bffb62`; story records it and adds `docs/ops.md` usage | n/a | 12.1 intent |
| 13.2 Tokens and frame | Colour/type/space/radius/shadow/motion tokens via `gen-tokens.mjs`; page padding, max-width (UR-04), `minmax(0,1fr)`, dead media queries | 6 | 12.2 |
| 13.3 Shared components | Buttons, pills (UR-12), banners, cards, `.field`, tabs, switch rows, skeletons, empty-state art, dialogs (UR-19), toasts, ErrorBlock | 7 | 12.3 |
| 13.4 Shell | Top bar (sparkle chip, bell dot, "EP" avatar plus chevron), search width, profile and notification menus, Assistant panel incl. optimistic bubble (SH-21) | 17 | 12.4, 12.13 |
| 13.5 Dashboard | Default, loading, empty; AI card progress (DB-07) | 20 | 12.8 |
| 13.6 Upload empty, processing, error | Processing grid 10x3 (UP-09), Cancel reachable | 14 | 12.7 |
| 13.7 Review layout | Grid, inner scroller, bordered group cards, savebar, banner, subtitle, editor card | 16 | 12.5 |
| 13.8 Review behaviour | Photo multi-select, inline Move/Merge/Split, Move N, no Actions menu | 4 | 12.6 |
| 13.9 Gallery | Card structure (GL-01), filters, bulk bar, empty/no-match/loading | 13 | 12.9 |
| 13.10 Viewer and dialogs | Viewer layout (VW-01), Edit-gown dialog fit and facet checkbox groups (VW-09, VW-11), delete dialogs | 14 | 12.10 |
| 13.11 Inquiries | List, thread, composer with Send in view (IQ-02), closed thread, dates (IQ-08, decision D1) | 22 | 12.11 |
| 13.12 Client profile | Profile page, hover card | 3 | 12.11 |
| 13.13 Settings frame and personal tabs | Frame, Profile (ST-04, D2), Signature plus Away (ST-02, D4), Preferences, Notifications (ST-01) | 22 | 12.12 |
| 13.14 Settings Admin | Staff, Roles (ST-03, D3), AI settings, Audit; staff-role view | 18 | 12.12 |
| 13.15 Sign-in phases | Layout vs `auth/login`; keychain overlap fix (SH-30) | 6 | 12.13 |
| 13.16 Sign-off sweep | Every pair re-captured, audit table closed, focus and keyboard pass, 1100x700 sanity | all open | 12.14 |

Order: 13.1 (done), 13.2, 13.3, then 13.4, then per screen 13.5 to 13.15 in table order (13.7 before 13.8), 13.16 last. 13.7 may ship alone as a hotfix after 13.3.

### 4.2 Old artifacts (already done in `60a241a`)

| File | Change |
|---|---|
| `docs/stories/12.1` to `12.14` | `status: superseded`, `superseded_by` Epic 13 |
| `docs/planning-artifacts/ui-fidelity-audit.md` | `status: superseded`, `superseded_by: ui-parity/audit.md` |
| `docs/planning-artifacts/sprint-change-proposal-2026-11-11.md` | `status: superseded`, `superseded_by` this file |
| `docs/epics/epics.md` | Epic 12 heading marks it superseded |

### 4.3 Decisions needed (spec vs prototype). Nothing below is applied until you choose.

| ID | Conflict | Options | Recommendation |
|---|---|---|---|
| D1 (IQ-08) | Prototype shows literal short dates ("Nov 3", "Yesterday", "Jun 14, 2027", "Oct 2026"). `format.ts` supports only DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY and the user's date-format preference | (a) Keep the preference for absolute dates; add a list formatter for today/yesterday/short month. (b) Literal prototype style everywhere, ignore the preference in Inquiries. (c) Leave dates as is | (a). Honours the preference and the prototype's look, small formatter |
| D2 (ST-04) | `ux-spec.md:152` says email is read-only ("assumption"); prototype email is an editable required field | (a) Read-only, update the prototype expectation. (b) Editable, needs a backend re-verify flow (out of this epic) | (a). Editable email needs backend and a verify flow; prototype wins layout, not security |
| D3 (ST-03) | Roles footer: desktop "Changes take effect right away." above table; prototype "Changes apply the next time a user signs in." below table. Backend (`RoleAdminService`) bumps the permission epoch so tokens go stale at once and the shell refreshes | (a) Keep the true copy, move it below the table. (b) Use the prototype copy | (a). The backend behaviour makes the prototype copy wrong. Also decide whether to keep the "View gallery" row |
| D4 (ST-02) | Away card is an Admin sub-tab on desktop, inside Signature in the prototype. `ux-spec.md:157` already places it under S2 Signature | (a) Move it into Signature (Admin only), drop the sub-tab. (b) Keep the sub-tab | (a). Matches both prototype and spec; the code is wrong |
| D5 (UR-16) | Review savebar: desktop has Undo; prototype has none. Undo supports staged edits (story 11.6) | (a) Keep Undo in the savebar. (b) Drop it | (a). It protects data; the lead places it left of Discard batch so the bar still reads like the prototype |

Spec edits that follow from your answers (`docs/ux-spec.md`, `docs/wireframe-inventory.md`) are listed here and made in the story that ships the change, with your approval: D1 (S-inquiries date lines), D2 (S1 line 152 note), D3 (S-roles footer), D5 (U1 savebar).

### 4.4 Not a parity gap (no prototype twin)

Usage and Keys tabs, update banner, offline banner, sign-in phases other than `auth/login` layout, upload loading and stopped, viewer loading, Away sub-tab itself. Judged against `DESIGN.md` only. Prototype `auth/*` pages are backend templates, out of scope.

## 5. Implementation handoff

Scope: **moderate**. Backlog reorganisation (Epic 12 out, Epic 13 in), no replan.

| Recipient | Responsibility |
|---|---|
| PO (Ej) | Answer D1 to D5; approve the epic and story list |
| UX (Sally) | Write Epic 13 stories with AC that cite prototype PNGs and audit row IDs |
| Dev | Implement one story at a time: `npm test`, `npm run shots -- --only`, `npm run shots:diff`, `npm run types:check`, `npm run build`; no API or backend change unless the story says so |
| Review | `bmad-code-review` after each story; commit `13.N: <title>` with trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Never skip hooks or signing |

Success criteria:
- Every screen and state has a screenshot pair in `ui-parity/{prototype,desktop}/`.
- `audit.md` has 182 rows, all `closed` with a fix commit and after-screenshot.
- Geometry probe on desktop: 0 overlap, covered, clipped, glued, offscreen, dialog-overflow findings.
- `npm test`, `npm run types:check` and `npm run build` pass in `desktop/`.
- No backend or API contract changed.

Unchecked: behaviour parity beyond the scripted states (poll timing, retry, keyboard) is only partly covered by the audit; 13.16 adds a keyboard and focus pass. Viewport matrix 360 to 1920 from the design handoff is not applicable to a fixed desktop window; only 1440x900 and 1100x700 are checked.
