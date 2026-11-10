---
status: proposed
workflow: bmad-correct-course
mode: batch
scope: major
created: 2026-11-10
author: Ej (user), drafted with Claude
prototype: prototype/v0.1.0
inputDocuments:
  - docs/prd.md
  - docs/architecture.md
  - docs/ux-spec.md
  - docs/wireframe-inventory.md
  - docs/epics/epics.md
  - docs/stories/4.3-embedding-and-grouping.md
  - prototype/v0.1.0
---

# Sprint Change Proposal: wrong gown grouping and UI drift from the prototype

`docs/prototype/` does not exist. The prototype used is `./prototype/v0.1.0`.
Nothing in this proposal is implemented. It adds Epic 10 and Epic 11 (18 stories) and lists the document edits that go with them.

## 1. Issue summary

### Issue 1: wrong gown grouping with High confidence

Two visibly different gowns land in one Upload Group, shown as High.

- Gown A: ivory satin, off-shoulder, side-wrap bodice, lace panel in the skirt slit, cathedral train.
- Gown B: ivory satin, off-shoulder, pleated bodice, ruffle cascade, beaded vine at the waist, ball gown.

Both are white satin, off-shoulder, on a mannequin. Rule for the fix: no model training; calibrate and verify.

Why it reads High (from source, `backend/app/.../upload/`):

1. **Mean masks the outlier.** `Clusterer.confidence` is the mean pairwise cosine x 100 (`Clusterer.kt`). Average-link merges only when mean cross-similarity reaches the threshold (default sensitivity 3, t = 0.75), so every merged group already has mean >= about 75. One bad pair in a group barely moves the mean. A two-photo group is one pair.
2. **Embeddings rank the wrong way (hypothesis, not yet measured).** `dinov2-base` global embeddings are dominated by colour, fabric, pose and background. Two different gowns on the same mannequin can score higher than front and back views of one gown. Raising the threshold would then split real same-gown shots first. No gown photos exist in the repo; Story 10.1 measures this.
3. **The taxonomy term raises confidence.** `ConfidenceScorer`: `score = 0.7*sim + 0.3*share*100` (`DescribeRules.kt`). It exceeds `sim` whenever `share*100 > sim`. With share 1.0, High needs sim >= 86 instead of 90. `share` is mapped/named taxonomy labels. It measures vocabulary fit, not whether the photos show one gown. A and B share ivory, satin and off-shoulder, so share is near 1.
4. **Describe sees 4 photos per group** (`PER_GROUP = 4`, upload order, `GroupingService.kt`). An outlier at position 5 or later is never looked at.
5. **A sensitivity change cannot fix an existing batch.** A `REVIEW` batch cannot restart (409) and Retry skips clustering once groups exist (`GroupingService.kt:162`). Tuning needs a new batch per try.

### Issue 2: desktop UI differs from the wireframe prototype

Every screen in `desktop/src` and the Auth Web templates was compared with `prototype/v0.1.0`. About 60 gaps found (Appendix A). The largest: no iconography, body type one step smaller, no dashboard greeting or stat row, autosaving Review instead of confirm-at-end, flat Settings with 10 tabs, and features the prototype shows that were deferred at Gate 3 (two-factor, Away Message, email toggles and digest). The prototype wins unless the user says otherwise. The user decided each conflict (Appendix C).

### Corrections to earlier questions in this session

- Email toggles and digest are **FR-34**, not FR-30. Away Message and closure schedule are FR-32 (correct).
- Two-factor authentication is **not** a PRD NON-GOAL. It is not in the PRD at all. `ux-spec.md` lines 149 and 228 removed the 2FA card. It needs a new FR, proposed as **FR-44**.
- Architecture spike **S-1**: the user says it is resolved and rules that the embedding model and the LLM keep separate URLs and API keys. No provider, model or fix was named. The S-1 note now records that ruling and still says the measured cause is not recorded (Appendix E).

## 2. Impact analysis

### Epics

| Epic | Impact |
|---|---|
| 4 AI Upload | Behaviour of 4.3 and 4.4 changes via Epic 10. Review (4.5, 4.6, 4.7) is reworked by 11.6. No story reopened; changes ship as new stories. |
| 6 Personal settings | FR-32 and the email part of FR-34 move to Epic 11. |
| 10 Matching accuracy | New. 4 stories. |
| 11 UI fidelity | New. 14 stories. |
| Others | Screen copy and layout touched through Epic 11 stories only. |

Epic list becomes eleven epics, 60 stories (42 existing + 18).

### Stories

New: 10.1 to 10.4, 11.1 to 11.14. Existing stories 4.5, 4.6, 5.x, 6.x, 7.x, 8.x, 9.1 stay "done"; each Epic 11 story names the existing story whose screen it changes.

### Artifact conflicts

| Artifact | Conflict |
|---|---|
| `prd.md` | FR-9 (confidence meaning, verify step). Glossary line 83 (confidence bands). Glossary line 92 ("customer" means Client; UI now says Customer). FR-8 photo cap stays 200 (note only). FR-32 and FR-34 marked DEFERRED. FR-32 auto-send NON-GOAL lifted (confirmed). New FR-44. |
| `architecture.md` | Section 8.1 egress table (Grouping row says "none (in memory)"; add Verify). Section 4.3 grouping row (line ~231). `ai_usage` purpose list. New scheduler and 2FA notes. S-1 untouched. |
| `ux-spec.md` | Sections 1 and 2 (framed sheet, 48px bar, radii, flat) stale. "Never a greeting" on Dashboard. A-UX5 confidence tooltip. Lines 126, 127, 140, 141, 146, 149, 154, 164, 190, 197, 228 to 233. A-UX15. |
| `wireframe-inventory.md` | Lines 38, 41, 93, 128, 129 (credits meter, in-thread AI panel, "Saved as draft"). |
| `epics.md` | Done in this change: Epics 10 and 11, FR map, FR-44, counts, `updated:` date. |

### Technical

- Backend: new `AiProviderPort.compare`, `AiPurpose.VERIFY`, confidence formula, verify pass inside grouping step 2, evaluation test, dashboard stat queries, staged-edit commit endpoint, Away Message, email preference store and digest job, TOTP.
- Desktop and Auth Web: tokens, icons, every screen, Review state model, Settings structure.
- Infra: `infra/eval/embed.py`, wiremock mapping `verify.json`, axe runs per UI story.
- Dependencies: possible QR library for 2FA (open question 4).
- Data: no migration for Epic 10 (no new setting). Epic 11 adds tables for Away Message, email preferences and 2FA.

## 3. Recommended approach

**Direct Adjustment** (new stories inside the existing plan) plus an **MVP scope reopen** of three features deferred at Gate 3: two-factor, Away Message and closure schedule, email toggles and digest.

Scope class: **Major** (PRD scope reversal, one new FR, one new auth surface, outbound email to real clients).

### Issue 1 options

| Option | Extra AI calls per batch | Fixes membership | Fixes mislabelled confidence | Verdict |
|---|---|---|---|---|
| A. Raise default sensitivity | 0 | Partly; fragments real groups first | No | Tune only after 10.1 data |
| B. Confidence = blend of mean and min pairwise; share may only lower | 0 | No | Yes | Fold into C |
| **C. Vision verify per group, split on mismatch, High only if verified** | **+1 per group with 2+ photos** | **Yes** | **Yes (via cap)** | **Recommended** |
| D. Cap confidence, force manual confirm | 0 | No | Partly | Rejected: friction on every batch, fixes nothing |
| E. Second or better embedding model | +N (second embed) or 0 (swap) | Unknown | No | Defer; 10.1 compares models by env var |

**Recommendation: C with B folded in.**

Cost, 30 photos in about 10 groups: today about 30 embeds + 10 describes. C adds about 8 to 10 vision calls (singletons skipped), each up to 8 thumbnails at 480 px, roughly 2k to 5k input tokens per call, so about 20k to 50k extra tokens per batch (estimate; provider dependent). Each split adds at most one describe call.

Design (reuses existing parts):

- Runs inside step 2 (Grouping), after `Clusterer.cluster`, before groups persist. No new step number, so `STEPS` in `Processing.tsx` does not renumber. No new resume predicate: groups persist only after verify, so `grouped()` stays the predicate. Restructure `group()` (`GroupingService.kt:215`): today clustering and persist share one transaction; the provider call must sit outside it (NFR rule), so read vectors in a read-only tx, cluster and verify outside, persist in a second tx.
- New port method `AiProviderPort.compare(call, images)`, copying the multi-image `image_url` payload from `OpenAiCompatibleAdapter.describe` (lines 85 to 111). New `AiPurpose.VERIFY`; update the 3.3 enum guard test and the `UsageTab` label.
- Model: `visionModelAdv` if `advanced`, else `visionModel` (same rule as describe, `AiSettingsRules.kt:67`). No new setting, no migration.
- Prompt: "Photo n of m" labels only (NFR-1). Ask for a JSON partition into sub-lists that are the same exact gown (silhouette, bodice, neckline, skirt, train), ignoring pose, angle, light, background.
- Groups above 8 photos: send the 3 lowest mean-similarity members, the 3 highest, then fill by upload order. The similarity matrix is already in memory.
- Valid partition (every index exactly once): split into sub-groups, rescore each. Invalid, refused or provider error: keep the group **unverified**; the batch never fails because of verify.
- Confidence: `stageA = round(100 * (0.5*mean + 0.5*minPair))`; unverified groups capped at 89 (Medium); `ConfidenceScorer` becomes `sim * (0.7 + 0.3*share)`, which can only lower. Bands stay 90/80 until Story 10.4 refits them.
- Constraints kept: thumbnails only, no call inside a DB transaction, one usage row per call, nothing auto-saved.

Known limits: Retry cannot re-verify (clustering is skipped once groups exist). An 8-image window can still miss an outlier in a very large group.

### Effort, risk, timeline

| Epic | Stories | Size | Main risk |
|---|---|---|---|
| 10 | 4 | 2 S, 1 M, 1 L | Cause may not be the embeddings; 10.1 proves or disproves before 10.3 is built. S-1 cause still not named. |
| 11 | 14 | 3 S, 8 M, 3 L (sizes below) | 11.6 loses per-edit persistence; 11.12 emails real clients; 11.13 adds a scheduler; 11.14 is a new auth surface. |

Epic 11 sizes: 11.1 M, 11.2 M, 11.3 M, 11.4 M, 11.5 S, 11.6 L, 11.7 M, 11.8 M, 11.9 S, 11.10 M, 11.11 S, 11.12 M, 11.13 L, 11.14 L (3 S, 8 M, 3 L).

Order: Epic 10 first (10.1, 10.2, 10.3, 10.4), then Epic 11 foundation (11.1 to 11.3), screens (11.4 to 11.11), reinstated full-stack features last (11.12 to 11.14). Calendar estimate not given: the operator-run steps (10.1 data, 10.4 calibration) depend on gown photos and a working provider.

## 4. Detailed change proposals

Format: OLD then NEW, with rationale. Batch mode: all proposals presented together; approval is requested on this document as a whole.

### Stories (new files, written after approval)

18 files, `docs/stories/10.1-*.md` to `10.4-*.md` and `11.1-*.md` to `11.14-*.md`, in the 4.3 template: frontmatter (`id`, `epic`, `title`, `status: ready`, `frs`, `nfrs`, `depends_on`), Assumptions, Given/When/Then criteria, Tasks, Checks, with named tests. Checks always include `./mvnw verify`, `npm test && cargo test`, `npm run types:check` when API shapes change, and the axe run (`infra/ci/axe.mjs`) for UI stories. Each UI story's first task re-checks its "verify" rows from Appendix A.

**Epic 10 (priority order)**

| # | Story | Size | Depends |
|---|---|---|---|
| 10.1 | Grouping evaluation harness (operator-run, not CI) | M | none |
| 10.2 | Confidence recalculation | S | 10.1 |
| 10.3 | Vision verify per group, split on mismatch | L | 10.2 |
| 10.4 | Calibrate defaults from evaluation data | S | 10.1, 10.3 |

- **10.1.** Operator folder `<gown-label>/*.jpg`. `infra/eval/embed.py` (uv) makes the 480 px JPEG thumbnail, calls `/v1/embeddings` using `KLEI_EMBED_URL`, `KLEI_EMBED_KEY`, `KLEI_EMBED_MODEL`, writes `vectors.json`. `GroupingEvalTest` (Kotlin, skipped unless `-Deval.vectors=...`) runs the real `Clusterer` at sensitivity 1 to 5 and prints pairwise precision, recall, F1, groups found vs true gowns, and per confidence band the share of pure groups. Needs no DB or Spring; default `./mvnw verify` skips it; fails clearly on a folder holding one gown. Tests: metric functions with hand-made vectors (perfect, over-merged, over-split). Shortcut: Pillow resize differs slightly from `ThumbnailService`; fine for ranking thresholds.
- **10.2.** Tests in `ClustererTest` and `DescribeRulesTest`: outlier lowers confidence below the mean-based value; two-member group equals its single pair; share 1 never raises above sim; share 0 gives 0.7 x sim; band cut-offs unchanged. Stored values untouched, no migration.
- **10.3.** Split on mismatch gives N groups, each rescored; invalid partition and provider error leave the group unverified and capped at 89; singleton skipped (no call); `VERIFY` usage row per call; no filename or id in prompt (leak test); batch never fails because of verify; call runs outside any transaction. Tests: `GroupingIT` extended; new wiremock mapping `infra/ci/stub-ai/mappings/verify.json` (body-matched); `StubProvider.compare` hook; enum guard test. Manual, operator: upload the eval folder, compare Review groups with labels, record in the Dev record.
- **10.4.** Sensitivity default and band cut-offs set from 10.1 numbers (recorded in the story). PRD glossary line 83 and the `bands` test change together. Constants only.

**Epic 11 (priority order, after Epic 10)**

| # | Story | Size | Depends |
|---|---|---|---|
| 11.1 | Design tokens, type scale, SVG icon set, elevation, shared components | M | |
| 11.2 | Shell: brand, nav, skip link, search, bell, dialog, toast | M | 11.1 |
| 11.3 | Auth Web and desktop sign-in: copy, 6-box code, inline validation | M | 11.1 |
| 11.4 | Dashboard: greeting, stat cards, widgets, empty states (2 new stat queries) | M | 11.1 |
| 11.5 | Upload and processing screens | S | 11.1 |
| 11.6 | Review: staged edits, "Confirm and save", organize controls, discard copy, Rewrite | L | 11.5 |
| 11.7 | Gallery, viewer, edit gown, delete copy ("folder") | M | 11.1 |
| 11.8 | Inquiries list, thread, composer, customer hover card | M | 11.1 |
| 11.9 | Customer profile (wording, header, Personal details, list) | S | 11.8 |
| 11.10 | Settings structure (Admin sub-tabs), roving tabs, Profile/Preferences/Staff copy | M | 11.1 |
| 11.11 | Assistant drawer copy and states | S | 11.1 |
| 11.12 | Away Message and closure schedule (FR-32, reinstated) | M | 11.10 |
| 11.13 | Email notification toggles and digest, sent for real (FR-34, reinstated) | L | 11.10 |
| 11.14 | Two-factor authentication (new FR-44) | L | 11.3, 11.10 |

Story notes (recorded in each story as `[ASSUMPTION]` or `OPEN QUESTION (id): ... Default: ...`):

- **11.1.** Keep the desktop focus colour and meta-text colour where the prototype fails AA (accessibility is never cut). Add an Inter 700 file. Tokens live in backend `static/tokens.css` (shared with Auth Web) and `desktop/src/styles.css`; edit both.
- **11.4.** Photos this month = saved photos in the current calendar month. Avg. reply time = mean of (first staff reply minus inquiry created) over replied inquiries in the last 30 days; "—" when none. The "· N appointments today" suffix is omitted: no appointment concept exists in the PRD, architecture or backend. Logged as the one deviation on this screen. Tests: stat queries with a fixed clock; empty state.
- **11.5.** Photo cap stays 200 (user decision); hint reads "Upload up to 200 at once". No backend change.
- **11.6.** Client holds all edits; one atomic `POST /uploads/{id}/commit` carries groups, assignments, tags, names, descriptions, discards, with versions. The inverse-call Undo in `Review.tsx` (about lines 77 to 99) is replaced by a local undo stack. Consequence: leaving the screen mid-review loses edits, so add a "Leave without saving?" guard. Per-edit persistence across app restarts goes away. "Rewrite" is a new endpoint reusing `describeOne`, one AI call per click. Tests: commit conflict (stale version), partial-failure atomicity, undo stack, guard.
- **11.7.** UI label "folder" (PRD and prototype agree); desktop's "gown" wording changes.
- **11.9.** UI word "Customer"; API, DB and code keep `client`. PRD glossary line 92 rewritten.
- **11.10.** AI usage and Keys become Admin sub-tabs (neither is in the prototype). Fixes keyboard tab movement.
- **11.12.** The PRD marked automatic sending to clients NON-GOAL (no public intake). User confirmed: lift it; send one away reply per new inquiry created during a closure window, via the existing `MailPort`, once per client per window. Leak test on the template.
- **11.13.** Per-user per-event email toggles; digest job uses the existing `@EnableScheduling` (see `ObjectSweepJob`); frequencies Real-time, Hourly, Daily, Weekly, Never ("Never" overrides toggles). Templates get leak tests. Needs an architecture note (scheduler, retry, opt-out through Settings).
- **11.14.** TOTP (RFC 6238) using stdlib HMAC. Secret stored encrypted (`_ct`, NFR-1); recovery codes hashed; rate-limited with the existing auth `RateLimiter`; audit entries for enable, disable and failure. Sign-in on Auth Web gains a code step; desktop PKCE flow unchanged. QR drawing uses zxing core (approved). Admin-required setting not built (the prototype shows an audit row only). New ADR in `architecture.md`.

### PRD (`docs/prd.md`)

| Section | OLD | NEW | Why |
|---|---|---|---|
| FR-9 | Confidence = mean pairwise similarity; no verify step | Grouping includes a vision verify pass; confidence blends mean and minimum pair, capped at Medium when unverified; share can only lower it | Issue 1 |
| Glossary line 83 | Confidence bands 90/80 on mean similarity | Same cut-offs, new meaning; refit by Story 10.4 | Issue 1 |
| FR-8 | Cap 200 `[ASSUMPTION]` | Cap 200 kept (user decision) | Prototype's 100 does not apply |
| Glossary line 92 | "customer" means Client | UI says Customer; Client stays the domain term in API and code | User decision |
| FR-32 | DEFERRED (Gate 3) | In scope, Story 11.12; line 415 auto-send NON-GOAL lifted pending confirmation | User decision |
| FR-34 | Email toggles and digest DEFERRED | In scope, Story 11.13 | User decision |
| New FR-44 | none | Two-factor authentication with an authenticator app, recovery codes, on and off in Profile | User decision |

### Architecture (`docs/architecture.md`)

| Section | OLD | NEW | Why |
|---|---|---|---|
| 8.1 egress table | Grouping: "none (in memory)" | Add Verify row: vision model, thumbnails only, step 2 | Issue 1; the PRD egress table (line 636) already lists vision models during batch processing |
| 4.3 grouping row (~231) | Cluster in memory with the sensitivity threshold | Cluster, then verify per group | Issue 1 |
| `ai_usage` purposes | TEST, EMBED, DESCRIBE, CHAT | add VERIFY | Issue 1 |
| New | none | Scheduler note (digest job) and 2FA ADR | Epic 11 |
| **S-1 note** | Provider error 400, cause not recorded | Operator ruling recorded (separate embedding and LLM URL and key); measured cause still not recorded | Appendix E |

### UX spec (`docs/ux-spec.md`)

Rewrite sections 1 and 2 to the prototype-aligned `DESIGN.md` (revised 2026-11-10): no framed sheet, 64 px top bar, radii 4/8/12, `--elev-raised`. Reverse "never a greeting". Replace A-UX5 (tooltip) with inline bar plus pill. Update lines 126, 127, 140, 141, 146, 149, 154, 164, 190, 197, 228 to 233 and A-UX15 for the reinstated features and the new Settings structure. Full list in Appendix B.

### Wireframe inventory (`docs/wireframe-inventory.md`)

Remove or flag as screenshot-only: sidebar credits meter (line 41), in-thread AI panel and composer variants (lines 38, 128, 129), "Saved as draft" (line 93). Customer source list: prototype uses "Google search".

### Epics (`docs/epics/epics.md`)

Done in this change: `updated: 2026-11-10`; Epic 10 and 11 in the Epic List; FR map (FR-9, FR-32, FR-34, FR-44); FR-44 in the requirements inventory; "Nine epics, 42 stories" changed to "Eleven epics, 60 stories". The coverage script line notes 10.1 to 11.14 are not yet covered by the script.

## 5. Implementation handoff

Scope: **Major**.

| Role | Responsibility |
|---|---|
| Product Manager | Approve PRD edits (FR-8, FR-9, FR-32, FR-34, FR-44, glossary lines 83 and 92). Decide open items 2 to 4. |
| Solution Architect | Verify design (Issue 1 option C), scheduler note, 2FA ADR, S-1 text once the cause is given. |
| Developer | Implement Epic 10 then Epic 11 in order. Each story: tests named in its criteria, `./mvnw verify`, desktop tests, axe on UI stories. |
| Operator (user) | Provide gown photos and the embeddings URL, key and model for 10.1 and 10.4; name the S-1 provider, model and fix. |

Success criteria:

1. 10.1 reports precision and recall per sensitivity on the operator's labelled folder.
2. A and B no longer share a High group on that folder, or the report shows why not.
3. No unverified group reads High.
4. Every UI story passes axe on its screens and shows no remaining "verify" row from Appendix A.
5. No outbound email, away reply or digest is sent without a template leak test.
6. NFR-1 leak suite passes after each story.

## Appendix A: UI gap table

`P` = `prototype/v0.1.0`, `D` = `desktop/src`. Rows marked **verify** were not read line by line; the owning story's first task confirms them. Not gaps: prototype "Wireframe state" switch, "View as" toggle, "Replies are simulated" footer (demo-only, omitted).

| screen | prototype | current | gap | sev |
|---|---|---|---|---|
| Tokens: type | body 16/1.5, h1 26/700/-0.033em | body about 14/20, h1 24/600 (`tokens.css`, verify) | whole app one step smaller | High |
| Tokens: icons | SVG set on nav, buttons, bell, toasts | 0 `<svg>` in D | no iconography | High |
| Tokens: font files | weight 700 | Inter 400/500/600 only | bold synthesized | Med |
| Tokens: radii | 4 / 8 / 12 | 4 / 6 / 8 / 12 | controls 6 vs 4, panels 8 vs 12 | Med |
| Tokens: elevation | `--elev-raised` on menus, search popup, toast, dialog, drawer | none | flat surfaces | Med |
| Tokens: pills | blue/green/gray/warn palette | different hexes | Open/New/Replied/Closed recoloured | Med |
| Tokens: focus ring | `#097fe8` + 3px glow | `#0063bf` 2px | keep desktop (contrast) | Low |
| Tokens: meta text | `#a39e98` | `#716c66` | prototype fails WCAG AA; keep desktop | Low |
| Tokens: skeleton, avatar | shimmer; dark 32px circle | flat; tinted 28px | cosmetic | Low |
| Shell: brand | "K" mark in sidebar | text wordmark in topbar | move and add mark | Med |
| Shell: nav | icons, "Workspace" eyebrow, tint + 600 active | text only | add icons, eyebrow | Med |
| Shell: skip link | "Skip to main content" | none | a11y regression | Med |
| Shell: search | placeholder "Search gowns, inquiries…", popup shadow, empty "No results for “{q}”" + Clear search; 480 wide | 548 wide, copy differs, empty verify | copy, shadow, width | Med |
| Shell: bell | icon, unread dot, 360 menu, footer "Go to Inquiries", "You’re all caught up" | text, no footer, straight apostrophe | add | Med |
| Shell: dialog, buttons | 480 dialog with shadow; radius 4; filled secondary | no shadow; radius 6; outlined | align | Med |
| Shell: toast, profile, topbar | 24 offset + check icon; 32 pill; pad 24 | 16, no icon; 28; pad 16 | cosmetic | Low |
| Auth: desktop login | 440 card, K mark, "Welcome back" / "Sign in to manage gowns and inquiries." | h1 "Klei Bridal", "Sign in to open the studio dashboard" | copy and card | High |
| Auth Web: login | "Work email" + placeholder, show/hide, "Signing in…" busy, error with remedy | "Email", no busy, error "Email or password is incorrect." | add | Med |
| Auth Web: inline validation | cause + remedy on focusout | none | add | Med |
| Auth Web: invite | "Join Klei Bridal", inviter + role, readonly email note, "Sign in" footer | "Create your account" | copy | Med |
| Auth Web: verify | 6 digit boxes, "Check your email", "Verify email" | one input, "Verify your email" | boxes and copy | Med |
| Auth Web: forgot/reset | "Forgot your password?" | "Reset your password" | copy | Low |
| Auth: desktop phases | not modelled | loading, expired, no-access | needs design | Med |
| Dashboard: header | "Good morning, {first}", date line, "Upload photos" CTA | "Dashboard" | add | High |
| Dashboard: stats | 4 cards: Total gowns, Unread inquiries, Photos this month, Avg. reply time | none | add and 2 new queries | High |
| Dashboard: widgets | recent uploads thumbs, AI processing (pill, bar, "Review groups"), unread | text lines, conditional | rebuild | Med |
| Dashboard: empty | art + sub-copy + CTA | one lede line | add | Med |
| Upload: dropzone | "Drop gown photos here", "JPG, PNG or WebP up to 25 MB each. Upload up to 100…" | cap 200, "JPEG" | cap 200 vs 100 | Med |
| Upload: errors | summary alert "N files couldn’t be uploaded" + "Retry upload" | per-file strip | align | Med |
| Upload: processing | "AI is grouping images", %, 4 step labels, skeleton grid, Cancel | "Grouping your photos", native progress | align | Med |
| Review: save model | banner "N photos → M gowns. Nothing is saved until you confirm." | autosave + Undo | staged edits | High |
| Review: group list | thumb strip, confidence bar + pill ("Low · check") | verify | align | Med |
| Review: organize | Move / Merge / Split controls, toasts "Moved N photo(s) to {name}" | different UI, toasts differ | align | Med |
| Review: save bar, discard dialog | "{n} gowns · {m} photos will be added to Gallery", "Confirm and save"; "Discard this batch?" / "Keep reviewing" | titles, body, buttons differ | copy | Med |
| Review: description | "Rewrite" action | verify | needs endpoint | Low |
| Gallery: grid, card | 4 fixed columns; meta "Silhouette · Fabric" | auto-fill 200; meta missing | align | Med |
| Gallery: bulk, selection | persistent checkbox, bulk bar | verify | align | Med |
| Gallery: delete dialog | "folder" wording (PRD agrees), names + photo count | "gown", no count | copy | Med |
| Gallery: header, empty | "{n} of {total} gowns · latest upload first"; two empty variants | verify; one art | copy | Low |
| Viewer: actions | header row: Edit / Download .zip / Copy description / Delete folder | in a menu | move | Med |
| Edit gown | toast "Gown updated", "Name is required" | "Changes saved" | copy | Med |
| Inquiries: empty list | 144 art, sub-copy, CTAs "Show all" / "View website form" | title only | add | High |
| Inquiries: empty thread, closed | art + "Open first message"; icon banner | one line | add | Med |
| Inquiries: customer hover card | `.hc` card with View profile | none | add | Med |
| Composer: toolbar, hints | icon-only toolbar; "Write your reply…"; "Enter to send · Shift+Enter for a new line · Signature added on send" | labelled text buttons, numbered list; copy differs | align | Med |
| Composer: link, send errors | Apply bar, auto-prefix; "Write a message before sending.", "{name} is over 10 MB" | Enter applies; strict; verify | align | Med |
| Customer profile: naming | "Customer" | "Client" | decision: Customer | Med |
| Customer profile: header, facts | avatar 72, "{city} · Wedding {date}", Email {First}; "Personal details" card (Heard about us, Notes) | h1 + Edit; Fact rows | align | Med |
| Customer profile: inquiries | "All inquiries (n)" rows | h2 "Inquiries" | align | Med |
| Settings: structure | 4 tabs + Admin (Staff / Roles and permissions / AI settings / Audit log) | 10 flat tabs (adds AI usage, Keys) | adopt prototype | High |
| Settings: tab keyboard | roving tabindex, arrows | none | a11y regression | Med |
| Settings: Profile | cards Profile / Password / Two-factor; toast "Profile saved" | "Changes saved"; no 2FA | build 2FA | High |
| Settings: Away message | toggle, schedule once/weekly/daily, message | absent | build | Med |
| Settings: Preferences | "Language and region" + "Inquiries" cards; "Preference saved" | differ | copy | Med |
| Settings: Notifications | in-app + email toggles + digest (Real-time/Hourly/Daily/Weekly/Never) | in-app only | build and send | Med |
| Settings: Staff | "Edit staff member", delete body, empty state | drift | copy | Med |
| Settings: AI settings | sections "Model provider" + "AI settings" | verify | align | Med |
| Assistant | chips "Draft a reply to Hannah", "Suggest gowns for a beach wedding"; placeholder; dots; footer | chips shortened; no placeholder; text busy | copy | Med |

Desktop-only items kept: Edit client dialog, AI usage and Keys (moved under Admin sub-tabs), inquiry paging, draft autosave, close-permission gating, 409/404 toasts, assistant Copy / New chat / history.

Not read in detail: `Thread.tsx` message markup, `.cprof` and `.set-col` widths, field-level `AiTab`, `SignatureTab` and `PreferencesTab` parity, `Composer.tsx` empty-send and 10 MB strings, `Assistant.tsx` header, `Review.tsx`, `Gallery.tsx`, `Viewer.tsx` internals. Prototype CSS line numbers are approximate.

## Appendix B: docs that disagree with the prototype

| doc | section | doc says | prototype shows |
|---|---|---|---|
| `ux-spec.md` | sections 1, 2; lines 27, 32, 46 | framed sheet, 48px bar, radii 16/12/8/6, flat, primary `#1f1e1c` | 64px bar, radii 4/8/12, `--elev-raised`, accent `#0075de`. `DESIGN.md` (revised 2026-11-10) already follows the prototype. |
| `ux-spec.md` / `wireframe-inventory.md` | line 45 / line 41 | one says no credits meter, the other lists "AI credits 640 / 1,000" | no meter in the shell; `ux-spec` is right |
| `ux-spec.md`, `DESIGN.md` | Dashboard | "never a greeting" | "Good morning, {first}" and a date line |
| `ux-spec.md` | A-UX5 | confidence as tooltip | inline bar plus pill ("High", "Medium", "Low · check") |
| `ux-spec.md` | U1 review | Low-confidence-first ordering, mosaic | thumb strip (5 per group), seed order |
| `ux-spec.md` | line 126 | client name underlined | dotted underline plus hover card (not in `ux-spec`) |
| `ux-spec.md` | line 127 | composer: numbered list, "Attach files", signature preview, "Saved as draft", Discard | no numbered list; attach is a toolbar icon; "Signature added on send"; no Discard |
| `ux-spec.md` | lines 140, 141 | profile header avatar/name/email; Edit client dialog; inquiries as table rows | header adds "{city} · Wedding {date}" and Email {First}; read-only profile; "All inquiries (n)" rows |
| `ux-spec.md` | lines 145, 146, 149 | Profile = name, avatar, password; tabs with Admin tabs after a divider; 2FA card removed | adds Two-factor card; one Admin tab with sub-tabs and an "Admin only" badge; tab icons |
| `ux-spec.md` | lines 153, 154, 164, 232, 233, 249 | Away Message, closure schedule, email toggles, digest not rendered; Signature left panel + preview, Studio block | all four rendered; single Signature card with preview below; no Studio block |
| `ux-spec.md` | line 159 | language disabled select; Enter-to-send in Preferences | separate "Inquiries" card with the toggle |
| `ux-spec.md` | line 180 | AI settings: one sticky "Save AI settings" | "Model provider" and "AI settings" saved separately (not fully verified) |
| `ux-spec.md` | line 190 | Audit paged 50 per page | 6 rows, no paging |
| `ux-spec.md` | lines 196, 197 | assistant failure copy; header New chat + Close | prototype has no error state; desktop uses a third string (`UNREACHABLE`) |
| `ux-spec.md` | A1 (auth) | accept-invite deviation | invite is its own view with "Already have an account? Sign in" |
| `ux-spec.md` / `EXPERIENCE.md` | gallery | paging | no paging; full list |
| `wireframe-inventory.md` | lines 38, 128, 129 | in-thread AI panel, three composer variants | only the rich-text composer and the global drawer |
| `wireframe-inventory.md` | line 93 | "Saved as draft", Discard | neither string exists; drafts held silently |
| `wireframe-inventory.md` | line 79 | source list "Instagram / Friend referral / Google / Website / Pinterest" | "Google search" in `data.js` |
| `wireframe-inventory.md` | line 29 | Preferences = language, timezone, date format, start page | also an "Inquiries" card |
| `wireframe-inventory.md` | section 8 | "AI confidence", "Share in a reply" screenshot-only | confidence UI exists; no share action |
| `wireframe-inventory.md` | D1 | widget list | greeting, 4 stat cards (two are mock figures), 3 widgets |

## Appendix C: decisions log (user answers in this session)

| Topic | Decision |
|---|---|
| S-1 state | "Resolved", cause not given. Embedding model and LLM must stay separate, each with its own URL and API key |
| Numbering | Epic 10 Matching accuracy, Epic 11 UI fidelity; files `docs/stories/10.n-*.md`, `11.n-*.md` |
| Deferred features (2FA, Away Message, closure schedule, email toggles, digest) | Build all, full stack |
| Email toggles and digest | Store and actually send |
| Dashboard | Match the prototype exactly, except the "appointments today" suffix (no data source; user chose "omit suffix, rest exact") |
| Review save model | Stage all edits client-side until "Confirm and save" |
| Settings structure | Adopt the prototype (4 personal tabs + Admin with sub-tabs) |
| Wording | UI says "Customer" (overrides PRD glossary line 92) |
| Priority | Matching accuracy first, then UI fidelity |
| Away Message auto-send | Yes: confirmed, once per client per closure window |
| Photo cap | 200 stays (prototype's 100 does not apply) |
| 2FA QR library | zxing core approved |
| Admin-required 2FA | Not built (reply "yes" read as accepting the defaults; flagged for the user to correct) |

## Appendix D: open items

1. **S-1 provider, embedding model and fix.** Not named. The note records only the separate URL and key ruling.
2. **Admin-required 2FA.** The reply "yes" to item 4 was read as accepting the defaults (zxing yes, Admin requirement not built). Say so if you meant a requirement.

Answered 2026-11-10: Away Message auto-send (yes), photo cap (200), zxing (yes).

## Appendix E: S-1 note

`docs/architecture.md` section 8.1 (S-1) now carries one added paragraph: the operator ruling that the embedding model and the LLM keep separate URLs and API keys. It does not claim a measured cause, because the provider, the embedding model and the fix were not named. The data-URI `input` shape is still proven only by the loopback stub. Story 10.3 relies on chat data-URI images, which Story 4.4 recorded as "Not verified", and verify uses the chat gateway, never the Embeddings address. The note changes again when the user names the cause.
