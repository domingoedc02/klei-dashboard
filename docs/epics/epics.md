---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/prd.md
  - docs/ux-spec.md
  - docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/EXPERIENCE.md
  - docs/architecture.md
  - docs/planning-artifacts/architecture/architecture-klei-bridal-dashboard-2026-11-08/ARCHITECTURE-SPINE.md
created: 2026-11-08
updated: 2026-11-10
---

# klei-bridal-dashboard - Epic Breakdown

## Overview

Epic and story breakdown for Klei Bridal Dashboard, from the final PRD (FR-1..FR-44, NFR-1..NFR-9; FR-44 added by the 2026-11-10 course correction), the UX spec and spines, and the final architecture (AD-1..AD-21, ADR-1..ADR-16). Stories live one per file in `docs/stories/`, named `<epic>.<n>-<slug>.md`. This file is the index: inventory, coverage map, epic list.

Assumptions (this document):
- S-A1. Architecture names no starter template. Story 1.1 sets up the repo and infrastructure; Story 1.7 scaffolds the Tauri app (hand-written files in the architecture's layout).
- S-A2. Story 1.1 delivers PostgreSQL, SeaweedFS and Mailpit plus the compose file, env template and smoke script. The `backend` service is added by Story 1.2, the first story that has something to build. The brief listed the backend in 1.1; no backend code exists before the Maven skeleton. `[ASSUMPTION]`
- S-A3. The brief's "1.3 CryptoService + converter/listener + plaintext-leak test -> 1.4 auth" is cut into 1.3 (crypto core and listener proof), 1.4 (users, bootstrap Admin, leak suite), then auth in 1.5 (API security), 1.6 (Auth Web and tokens), 1.7 (desktop sign-in), 1.8 (app frame), so each fits one dev session. The leak suite starts in 1.4 because it needs a real table with real rows. `[ASSUMPTION]`
- S-A4. Tables are created by the first story that needs them, as Flyway migrations `V<n>__<story>.sql`. The column allowlist test and the leak suite grow in each story's acceptance criteria.
- S-A5. "Stories end with runnable checks" (NFR-9): every story lists `Checks` with the exact commands. Backend: `cd backend && ./mvnw verify`. Desktop: `cd desktop && npm test && (cd src-tauri && cargo test)`. Smoke: `docker compose -f infra/docker-compose.yml up -d --wait && infra/ci/smoke.sh`. A story that does not touch a surface says so and skips that command.
- S-A6. Spike S-1 (data URI to the embedding model) is the first task of Story 4.3. Spikes S-2 (Deep Link on Linux) and S-4 (CSP with Tauri IPC) are tasks inside Story 1.7; S-3 (updater on unsigned builds) is inside Story 9.3.

OPEN QUESTION (non-blocking): OQ-5 holder of the offline key backup; the operator (the user) until named. A production SMTP provider is needed before go-live (owner: operator). Neither blocks a story.

## Requirements Inventory

### Functional Requirements

FR-1: Bootstrap first Admin from environment values at startup.
FR-2: Accept Invitation (name, password, strength rules, expired link copy).
FR-3: Verify email by 6-digit code or link, with Resend.
FR-4: Sign in on the Auth Web, rate-limited, anti-enumeration, return by Deep Link.
FR-5: Request and complete a password reset.
FR-6: Session in OS keychain, PKCE code exchange, sign out, server-side authorization.
FR-7: Dashboard widgets scoped to Permissions.
FR-8: Start an Upload Batch (JPEG, PNG, WebP, 25 MB, no fixed photo limit but a server ceiling of 5,000 per batch since Story 21.6, encrypted storage).
FR-9: Process a batch: embed, group, tag, describe, with progress, notification, retry.
FR-10: Review Groups: edit name, Attributes, Description; Confidence shown.
FR-11: Rearrange Photos: move, split, merge, discard, reversible until Save.
FR-12: Save or discard the batch, with Audit Entries.
FR-13: Browse Gallery, paged, newest first, 4-photo mosaic cards.
FR-14: Filter Gallery by Silhouette, Fabric, date added.
FR-15: View a Gown, copy Description.
FR-16: Edit a Gown (Edit gown details).
FR-17: Download one Gown or a bulk selection as .zip.
FR-18: Delete Gowns (Delete gown folders), hard delete, confirmation.
FR-19: List Inquiries with Status filter and unread state.
FR-20: Read an Inquiry; opening marks it read.
FR-21: Reply with rich text, attachments, Signature; Draft autosave; send by SMTP.
FR-22: Manage Inquiry Status; Close needs Close inquiries.
FR-23: Client profile; edit by Reply holders; match by email blind index.
FR-24: Create an Inquiry via authenticated API.
FR-25: Converse with the AI Assistant drawer.
FR-26: Assistant capabilities: summarize, draft reply, suggest gowns.
FR-27: Assistant boundaries and disclosure; never sends or writes.
FR-28: Global search over Gowns and Inquiries, whole-word.
FR-29: Notifications menu.
FR-30: Profile: name, avatar, password change.
FR-31: Signature with live preview; Studio block set by Admin.
FR-32: Away Message and closure schedule. Deferred at Gate 3, reinstated 2026-11-10 (Story 11.12).
FR-33: Preferences: date format, timezone, start page, Enter to send.
FR-34: Notification preferences: in-app toggles (Story 6.3); email toggles and digest frequency, deferred at Gate 3, reinstated 2026-11-10 (Story 11.13).
FR-35: Staff management: list, invite, edit, resend, delete, last-Admin guard.
FR-36: Roles and permissions matrix.
FR-37: AI Provider settings and Test connection.
FR-38: AI behavior settings: sensitivity, tone, Taxonomy, advanced model toggle.
FR-39: AI usage log.
FR-40: Audit log, append-only, paged.
FR-41: KEK rotation and re-wrap.
FR-42: Plaintext-leak verification suite in `mvn verify`.
FR-43: Automatic desktop update.
FR-44: Two-factor authentication with an authenticator app (TOTP), recovery codes, turn on and off in Profile. New 2026-11-10; not in the original PRD.

### NonFunctional Requirements

NFR-1: Encrypted data at rest (verbatim in `docs/prd.md` §5). Every story that stores data extends the allowlist test and the leak suite.
NFR-2: Performance and scale (10k Gowns, 100k Photos, 50k Inquiries; p95 targets in the PRD table).
NFR-3: Offline and connection-loss behavior; idempotent Reply and Photo upload; nothing lost.
NFR-4: Packaging: Tauri bundles for macOS, Windows, Linux; keychain fail-closed; CI builds all three.
NFR-5: Security beyond NFR-1: HTTPS, Argon2id, RBAC server-side, sanitizer, CSP, secrets only from git-ignored `.env`.
NFR-6: Logs, errors and mail carry no PII or content; Reply mail is the only content mail.
NFR-7: Accessibility, WCAG 2.1 AA.
NFR-8: Operability: health checks, restart, Dokploy deploy, KEKs as secrets, ciphertext backups (RPO 24 h, RTO 4 h), migrations at startup.
NFR-9: Every story ends with `mvn verify`, the desktop test command and a compose smoke test; each story review checks NFR-1.

### Additional Requirements

AR-1: Monorepo `/backend /desktop /infra /docs` (AD-1, architecture §3). No starter template.
AR-2: Spring Boot 4.1.2, Kotlin 2.3.21, JDK 25, Maven wrapper, modules `crypto`, `core`, `app` (app to core to crypto); ArchUnit enforces the arrows and that only `crypto` touches JCA (AD-2).
AR-3: One app, two Tomcat connectors, 8080 API and 8081 Auth Web, with a port guard (AD-1, ADR-7).
AR-4: Flyway migrations at startup; schema test with a column allowlist (AD-5, ADR-4).
AR-5: Compose: `postgres:18.6`, `chrislusf/seaweedfs:4.52` with `server -dir=/data -s3 -volume.max=0`, `axllent/mailpit:v1.33.0`, networks `internal` and `edge`, restart `unless-stopped`, production images pinned by digest (architecture §9.1).
AR-6: `infra/.env.example`, `KLEI_*` variables and `_FILE` variants, `infra/ci/gen-keys.sh`, ordered startup checks (architecture §9.2).
AR-7: `crypto` module pieces: `KeyRing`, `DekStore`, `CryptoService`, `FieldCodec`, `ObjectCipher`, `BlindIndex`, `Terms`, `DayBucket`, `PasswordHasher`, `TokenSigner`, `SecureTokens`, annotations, listener, `KeyRotation`, `MigrationCrypto` (architecture §5.1).
AR-8: Encryption in a Hibernate listener driven by `@Encrypted`, not `AttributeConverter` (accepted OQ-4); recorded fallback if Story 1.3 proof fails.
AR-9: Envelope: HKDF per-column keys, `[version][dek_id][nonce][ciphertext+tag]`, AAD `version|dek_id|table|column|rowId`, padded frames (AD-3).
AR-10: Blind indexes only from the closed `BidxDomain` enum, compared with architecture §4.2 by a test (AD-6).
AR-11: Object encryption with per-object DEK, 64 KB padding, random UUID keys, no metadata (AD-7).
AR-12: Auth: Auth Web authorize, PKCE S256, exact redirect check, EdDSA JWT 15 min with `perms`, `sid`, `epoch`, rotating refresh with 10 s grace, in-memory revocation (AD-8, A1).
AR-13: Every endpoint declares `@PreAuthorize("hasAuthority('PERM_…')")`, `@PermitAll` or `@TokenAuthorized`; ArchUnit fails otherwise (AD-9).
AR-14: API conventions: `/api/v1`, problem+json with `code`, `If-Match`, `Idempotency-Key`, filters as `POST …/query`, cursor paging by `seq`, committed `docs/api/openapi.json` with a drift test, generated TS types (AD-11).
AR-15: `AiProviderPort` with SSRF guards, key from `ai_setting`, `ai_usage` row per call in its own transaction (AD-12).
AR-16: `MailPort` over SMTP with Thymeleaf text templates and per-template leak tests; Reply state machine with `pending`, `sent`, `failed` (AD-14, AD-20).
AR-17: Rust shell is the only network client; webview CSP `connect-src 'none'`; closed command set `api_request`, `sign_in`, `sign_out`, `upload_files`, `export_gowns`, `check_update`, `install_update`, `set_dirty` (AD-10).
AR-18: Tauri updater with minisign signature; update host is a public releases-only repo filled by `tauri-action` cross-repo upload (AD-15, OQ-3 resolved).
AR-19: CI pipelines: backend, desktop, contract, smoke, performance, desktop OS smoke, release (architecture §9.4).
AR-20: `infra/ops/backup.sh` (DB dump first, then bucket) and `infra/ops/restore.md` (architecture §9.3).
AR-21: Single writers: `AuditService`, `InquiryStateService`, `NotificationPort`, `TermIndexer` (AD-21); concurrency by plaintext `version` and `If-Match` (AD-18).
AR-22: Performance benchmark `infra/ci/perf.sh` seeding 5,000 Gowns (AD-17).
AR-23: Background work: batch processing survives screen leave; a batch left in `processing` becomes `error` at startup (AD-20).

### UX Design Requirements

UX-DR1: One `tokens.css` generated from `DESIGN.md` by `infra/ci/` script, imported by the desktop app and the Auth Web templates.
UX-DR2: App frame and sheet shell: sidebar 240 (items hidden by Permission, Inquiries count only when N > 0, no credits meter), top bar 48, banner slot, toast stack (max 3, errors persist), dialog host (480, one at a time), drawer host (400).
UX-DR3: Inter and IBM Plex Mono bundled and self-hosted in both surfaces; no CDN, font or script from any third party.
UX-DR4: Focus ring 2px `#0063bf` with 2px offset on every control; text contrast 4.5:1 on frame and sheet.
UX-DR5: Gown mosaic component (2x2, 2px gaps) used by Gallery cards, Upload groups, Dashboard and search rows.
UX-DR6: Pills: Status (New, Replied, Closed), Role, Staff status, Confidence (High, Medium, "Low · check", percentage in tooltip).
UX-DR7: Loading is flat skeletons at final size; errors sit inside the failed block with cause, last good time and Retry; Dashboard blocks fail independently.
UX-DR8: Role variants follow A-UX7: whole surfaces absent, single controls disabled with a tooltip; default Viewer has Dashboard Gown widgets and Gallery only (`PERM_VIEW_GALLERY`), no Inquiries and no Assistant.
UX-DR9: Desktop-only states: connection-loss banner, session expired, update prompt, Deep Link wait and failure, keychain unavailable, signed-out screen, forbidden view (EXPERIENCE "Responsive & Platform").
UX-DR10: Six empty-state PNGs copied into `desktop/src/assets/empty/` and used only for whole-view empties.
UX-DR11: Auth Web pages A1 to A6 server-rendered with CSRF, the stated CSP, working without script; script adds only strength meter, show/hide and resend countdown.
UX-DR12: Toast copy is verb-consistent with the button (list in the UX spec X3).
UX-DR13: Dialog set per EXPERIENCE `Component Patterns`; destructive dialogs focus Cancel.
UX-DR14: Keyboard map: `/` and Cmd/Ctrl+K focus search, Esc closes drawer or menu, Enter sends and Shift+Enter breaks a line in the Assistant, Enter-to-send preference in the composer.
UX-DR15: Accessibility floor: labelled controls, live regions for status, axe-core checks on key screens in Vitest (NFR-7).
UX-DR16: Minimum window 1100x700; English (US) only; no dark mode.

### FR Coverage Map

FR-1: Epic 1 (1.4) Bootstrap Admin at startup
FR-2: Epic 2 (2.1) Accept Invitation
FR-3: Epic 2 (2.1) Verify email
FR-4: Epic 1 (1.6, 1.7) Sign in on the Auth Web and return by Deep Link
FR-5: Epic 2 (2.2) Password reset
FR-6: Epic 1 (1.5, 1.6, 1.7) Session, keychain, server-side authorization
FR-7: Epic 9 (9.1) Dashboard
FR-8: Epic 4 (4.1, 4.2) Start an Upload Batch
FR-9: Epic 4 (4.3, 4.4) Process a batch; Epic 10 (10.1 to 10.4) grouping accuracy, confidence and verify
FR-10: Epic 4 (4.5) Review Groups
FR-11: Epic 4 (4.6) Rearrange Photos
FR-12: Epic 4 (4.7) Save or discard
FR-13: Epic 5 (5.1) Browse Gallery
FR-14: Epic 5 (5.1) Filter Gallery
FR-15: Epic 5 (5.2) View a Gown
FR-16: Epic 5 (5.3) Edit a Gown
FR-17: Epic 5 (5.4) Download .zip
FR-18: Epic 5 (5.5) Delete Gowns
FR-19: Epic 7 (7.1) List Inquiries
FR-20: Epic 7 (7.2) Read an Inquiry
FR-21: Epic 7 (7.3) Reply
FR-22: Epic 7 (7.4) Manage Status
FR-23: Epic 7 (7.2 read, 7.4 edit) Client profile
FR-24: Epic 7 (7.1) Create an Inquiry via API
FR-25: Epic 8 (8.3) Converse with the Assistant
FR-26: Epic 8 (8.3) Assistant capabilities
FR-27: Epic 8 (8.3) Assistant boundaries and disclosure
FR-28: Epic 8 (8.2) Global search
FR-29: Epic 8 (8.1) Notifications
FR-30: Epic 6 (6.1) Profile
FR-31: Epic 6 (6.2) Signature and Studio
FR-32: Epic 11 (11.12) Away Message and closure schedule (deferred at Gate 3, reinstated 2026-11-10)
FR-33: Epic 6 (6.3) Preferences
FR-34: Epic 6 (6.3) In-app notification preferences; Epic 11 (11.13) email toggles and digest
FR-35: Epic 2 (2.1 invite, 2.3 screen) Staff management
FR-36: Epic 2 (2.4) Roles and permissions
FR-37: Epic 3 (3.1) AI Provider settings
FR-38: Epic 3 (3.2) AI behavior settings and Taxonomy
FR-39: Epic 3 (3.3) AI usage log
FR-40: Epic 2 (1.4 writer, 2.5 screen) Audit log
FR-41: Epic 9 (9.2) KEK rotation and re-wrap
FR-42: Epic 1 (1.4 suite) extended by every story's NFR-1 criteria; 9.2 re-runs it after rotation
FR-43: Epic 9 (9.3) Automatic desktop update
FR-44: Epic 11 (11.14) Two-factor authentication

## Epic List

Thirteen epics. Epic 1 is infrastructure and security foundation by the user's explicit story order; its user value is a running, encrypted-by-construction system in which a Staff member can sign in. Epics 2 to 9 deliver user-visible capability. Epics 10 and 11 come from the 2026-11-10 course correction (`docs/planning-artifacts/sprint-change-proposal-2026-11-10.md`): matching accuracy first, then UI fidelity to the prototype. Dependencies only run forward: Epic N uses Epics before it.

### Epic 1: Foundation and sign-in
A Staff member can sign in to a stack that is encrypted by construction, and the build proves it.
**FRs covered:** FR-1, FR-4, FR-6, FR-42 (start). **NFRs:** NFR-1, NFR-4, NFR-5, NFR-8, NFR-9.
Stories: 1.1 Compose infrastructure stack; 1.2 Maven multi-module skeleton and backend container; 1.3 Crypto core and Hibernate listener; 1.4 Users, bootstrap Admin and plaintext-leak suite; 1.5 API security foundation; 1.6 Auth Web sign-in and token exchange; 1.7 Desktop shell and sign-in; 1.8 App frame and shared UI.

### Epic 2: Staff and access
An Admin can bring staff on, control what each Role may do, and read what happened.
**FRs covered:** FR-2, FR-3, FR-5, FR-35, FR-36, FR-40.
Stories: 2.1 Mail port, Invitation and email verification; 2.2 Password reset; 2.3 Staff management screen; 2.4 Roles and permissions; 2.5 Audit log screen.

### Epic 3: AI provider and Taxonomy
An Admin can connect the AI provider, prove it works, and define the tags the AI may use.
**FRs covered:** FR-37, FR-38, FR-39.
Stories: 3.1 AI provider settings and Test connection; 3.2 AI behavior settings and Taxonomy; 3.3 AI usage log.

### Epic 4: AI Upload
Staff can turn a pile of photos into reviewed, named, tagged Gowns.
**FRs covered:** FR-8, FR-9, FR-10, FR-11, FR-12.
Stories: 4.1 Encrypted object storage and photo upload API; 4.2 Upload screen; 4.3 Embedding and grouping; 4.4 Tagging and descriptions; 4.5 Review Groups; 4.6 Rearrange Photos; 4.7 Save or discard the batch.

### Epic 5: Gallery
Anyone can find a Gown, see it, and (with permission) edit, download or delete it.
**FRs covered:** FR-13, FR-14, FR-15, FR-16, FR-17, FR-18.
Stories: 5.1 Browse and filter the Gallery; 5.2 Gown viewer; 5.3 Edit a Gown; 5.4 Download as .zip; 5.5 Delete Gowns.

### Epic 6: Personal settings
Every User can make the app theirs: profile, signature, preferences.
**FRs covered:** FR-30, FR-31, FR-33, FR-34 (in-app part). (FR-32 and the email part of FR-34 moved to Epic 11.)
Stories: 6.1 Profile and password; 6.2 Signature and Studio; 6.3 Preferences and notification toggles.

### Epic 7: Inquiries and clients
Staff can read client inquiries, reply on brand, and keep status and client details straight.
**FRs covered:** FR-19, FR-20, FR-21, FR-22, FR-23, FR-24.
Stories: 7.1 Create and list Inquiries; 7.2 Read an Inquiry and Client profile; 7.3 Reply; 7.4 Status and Client edits.

### Epic 8: Notifications, search and AI Assistant
Staff find things fast, hear about what matters, and get AI help without losing control.
**FRs covered:** FR-25, FR-26, FR-27, FR-28, FR-29.
Stories: 8.1 Notifications; 8.2 Global search; 8.3 AI Assistant drawer.

### Epic 9: Dashboard, operations and release
The studio lands on a useful home, the operator can rotate keys, back up and update, and staff stay on one version.
**FRs covered:** FR-7, FR-41, FR-43. **NFRs:** NFR-2, NFR-8.
Stories: 9.1 Dashboard; 9.2 Key rotation and re-wrap; 9.3 Automatic desktop update and release pipeline; 9.4 Backup, restore and performance benchmark.

### Epic 10: Matching accuracy
Two different gowns no longer land in one Group at High confidence: grouping is measured, confidence is honest, and a vision check splits what the embeddings merge. No model training.
**FRs covered:** FR-9 (extended). **NFRs:** NFR-1, NFR-6.
Stories: 10.1 Grouping evaluation harness (operator-run, not CI); 10.2 Confidence recalculation; 10.3 Vision verify per group, split on mismatch; 10.4 Calibrate defaults from evaluation data.

### Epic 11: UI fidelity
The desktop app and Auth Web match the wireframe prototype (`prototype/v0.1.0`), and the features the prototype shows that were deferred at Gate 3 are built.
**FRs covered:** FR-32, FR-34 (email part), FR-44; FR-8, FR-10, FR-12 (screen changes). **NFRs:** NFR-1, NFR-5, NFR-6, NFR-7. **UX-DR:** DR1 to DR8, DR10, DR12, DR13, DR15 revised.
Stories: 11.1 Design tokens, icons and shared components; 11.2 Shell; 11.3 Sign-in screens; 11.4 Dashboard; 11.5 Upload and processing screens; 11.6 Review with staged edits; 11.7 Gallery, viewer and edit gown; 11.8 Inquiries, thread and composer; 11.9 Customer profile; 11.10 Settings structure; 11.11 Assistant drawer; 11.12 Away message and closure schedule; 11.13 Email notifications and digest; 11.14 Two-factor authentication.

### Epic 12: UI layout fidelity (SUPERSEDED by Epic 13, 2026-11-11; no story started)
Close the layout and fidelity gaps Epic 11 shipped without a rendered side-by-side check: overlap, overflow, scroll chain, spacing and component drift against the prototype. Adds a screenshot harness so layout is verified at 1100x700 and 1280x800. No backend change, no new dependency.
**FRs covered:** none new (screen changes to FR-7 to FR-17, FR-19 to FR-23, FR-25, FR-30 to FR-32, FR-35). **NFRs:** NFR-5, NFR-7. Source: `docs/planning-artifacts/ui-fidelity-audit.md`, `docs/planning-artifacts/sprint-change-proposal-2026-11-11.md`.
Stories: 12.1 Screenshot harness; 12.2 Frame, tokens and primitives; 12.3 Shared components; 12.4 Top bar and bell; 12.5 Review layout fixes; 12.6 Review inline Move/Merge/Split; 12.7 Upload and processing pass; 12.8 Dashboard layout; 12.9 Gallery layout; 12.10 Viewer and edit gown; 12.11 Inquiries, thread, composer and profile; 12.12 Settings frame, Signature with Away message, Staff; 12.13 Assistant and sign-in polish; 12.14 Narrow-window and keyboard sweep.

### Epic 13: UI/UX parity with prototype
The desktop app matches the exported prototype (`/Users/ej/Downloads/Klei-Bridal-Dashboard-Prototype`) in layout, components, copy and behaviour, proven by rendered side-by-side screenshots and a geometry probe instead of a CSS read. Replaces Epic 12 in full. Desktop app only; no backend or API contract change.
**FRs covered:** none new (screen changes to FR-7 to FR-17, FR-19 to FR-23, FR-25, FR-30 to FR-32, FR-35). **NFRs:** NFR-7, NFR-9. Source: `docs/planning-artifacts/ui-parity/audit.md` (182 gaps: P1 21, P2 115, P3 46), `docs/planning-artifacts/sprint-change-proposal-2026-11-11b.md`. Open decisions D1 to D5 are in the proposal, section 4.3; each story states its assumed option.
Stories: 13.1 Parity harness; 13.2 Tokens and frame; 13.3 Shared components and formatters; 13.4 Shell: top bar, menus and Assistant; 13.5 Dashboard; 13.6 Upload: empty, processing and error; 13.7 Upload Review: layout; 13.8 Upload Review: select, Move, Merge, Split; 13.9 Gallery; 13.10 Gown viewer, edit and delete dialogs; 13.11 Inquiries: list, thread and composer; 13.12 Client profile; 13.13 Settings: frame and personal tabs; 13.14 Settings: Admin tabs; 13.15 Desktop sign-in phases; 13.16 Parity sign-off sweep.

## Stories

Each story is a file in `docs/stories/` named `<epic>.<n>-<slug>.md`. Format: front matter (`id`, `epic`, `status: ready`, `frs`, `depends_on`), user story, Assumptions, Acceptance Criteria (Given/When/Then), Tasks, Checks. The Dev agent works one story at a time; QA reviews NFR-1 on each.

## Validation (step 4 checks, run 2026-11-08)

- FR coverage: FR-1..FR-43 each mapped to at least one story; FR-32 was deferred by the user (no story). Checked by script over story front matter. Update 2026-11-10: FR-32 now maps to 11.12, FR-34's email part to 11.13, new FR-44 to 11.14; stories 10.1 to 11.14 are drafted separately and not yet covered by that script.
- Forward dependencies: none; every `depends_on` points to an earlier story. Epic 1 ends with a working signed-in shell; Epics 2 to 9 each build on earlier epics only.
- Tables are created by the first story that needs them. Migration numbers (`V<n>`) in stories are indicative; the Dev agent takes the next free number.
- Every story has Assumptions, Given/When/Then criteria, Tasks and Checks with `./mvnw verify`, the desktop test command (or "not applicable yet") and the compose smoke test, plus an NFR-1 leak-suite criterion where data is stored.
- UX-DR coverage: DR1, DR3 in 1.6/1.8; DR2, DR4, DR9, DR10, DR16 in 1.7/1.8; DR5 in 5.1; DR6 in 2.3, 4.5, 7.1; DR7, DR8 in every screen story; DR11 in 1.6, 2.1, 2.2; DR12, DR13 in screen stories; DR14 in 8.2, 8.3, 7.3; DR15 in every screen story (axe).
- Not checked: runtime behaviour (no code exists); spikes S-1..S-4 results.

## Decisions at Gate 5

1. Closed. `upload_photos` becomes `upload_files(kind, targetId)` (kind `photo` or `attachment`); Reply attachments stay in the MVP (user ok). AD-10 text in the architecture and spine updated.
2. Closed. New editable Permission `PERM_VIEW_GALLERY` (nine editable in all, plus system `PERM_KEY_ROTATE`), on by default for Admin, Staff and Viewer. Gallery, Search over Gowns and Dashboard Gown figures need it. A User whose Role holds no Permission cannot sign in: "Your account has no access yet. Ask an admin." (Stories 1.4, 1.6, 2.4, 9.1; architecture §6.3). Small PRD delta recorded in architecture §12 (user chose this option).
3. Closed. Permission changes take effect right away; S6 helper copy updated (user ok).
4. Closed. Reset link 30 minutes; architecture §6.1 aligned (user ok).
5. OQ-5 holder of the offline keys, production SMTP provider, releases repo name, backup destination: operator before go-live; none blocks a story.

## Gate 5

Status: approved by the user on 2026-11-08. This file is final; stories stay `ready` until the Dev agent starts them. The Dev to QA loop runs one story at a time, starting with Story 1.1, and pauses after each epic.

## Addendum: Electron migration, Epics 14 to 20 (2026-11-13)

Additive. Epics 1 to 13, their stories and Gate 5 above are unchanged and still describe the protected Tauri app (first baseline commit `51949da2a0f8347c5f1f56fc5d87d8ada6e60643`; re-baselined at `8e2eca27f91f5bfcd7a146961d603117bf8a597b` in Stories 21.5 and 21.7). The migration builds a separate Electron target in `electron/` and is governed by `docs/prd.md` section 13 (MFR-1 to MFR-8). Shards and stories live in `docs/prd/` and `docs/stories/`; the index and authority table are `docs/prd/index.md`. Nothing here is built, run or tested yet.

### Epic 14: Baseline, parity harness and feasibility
Stories: 14.1 Baseline freeze and protected-path gate; 14.2 Electron-owned parity harness; 14.3 Feasibility spikes; 14.4 Read-only renderer build and shim feasibility. Shard: `docs/prd/epic-14-baseline-and-feasibility.md`.

### Epic 15: Electron shell and IPC
Stories: 15.1 Electron scaffold and window; 15.2 Hardened renderer boundary, `app://` and CSP; 15.3 Preload shim and Channel compatibility; 15.4 Closed command registry and error contract. Shard: `docs/prd/epic-15-electron-shell-and-ipc.md`.

### Epic 16: Session and API
Stories: 16.1 Runtime configuration and `api_request`; 16.2 Token refresh and session expiry; 16.3 Credential store, `sign_out` and `session_only`; 16.4 `sign_in` with PKCE; 16.5 Deep link, single instance and loopback; 16.6 `set_dirty`. Shard: `docs/prd/epic-16-session-and-api.md`.

### Epic 17: Native features
Stories: 17.1 Photo upload engine; 17.2 Watched-window drag and drop; 17.3 Attachment and avatar uploads; 17.4 Gown archive export; 17.5 `klei-img` image protocol; 17.6 Webview behavior parity. Shard: `docs/prd/epic-17-native-features.md`.

### Epic 18: Packaging and manual update
Stories: 18.1 Per-OS Electron packaging; 18.2 Unsigned distribution qualification; 18.3 Fixed-page manual update (the one approved Electron-only exception to FR-43); 18.4 Install, upgrade and rollback qualification; 18.5 Download site (Thymeleaf, own port, secret path). Shard: `docs/prd/epic-18-packaging-and-manual-update.md`.

### Epic 19: Isolated CI
Stories: 19.1 Protection workflow; 19.2 Build and test workflow; 19.3 Packaging matrix; 19.4 Isolated release workflow. Shard: `docs/prd/epic-19-isolated-ci.md`.

### Epic 20: Qualification, pilot and cutover
Stories: 20.1 Full-flow parity matrix run; 20.2 Start-up and memory measurement; 20.3 Opt-in pilot; 20.4 Rollback rehearsal and decision records. Shard: `docs/prd/epic-20-qualification-and-cutover.md`.

### Epic 21: Layout and picker fixes
UI fixes in `desktop/src` reported after Epic 13: scrolling frame, Upload Review save bar, Gallery viewer image and full view, group picker. Not part of the Electron migration; the fixes ship in both apps because the Electron renderer builds `desktop/src`. Stories: 21.1 App frame and per-panel scroll; 21.2 Upload Review: fixed save bar and independent panes; 21.3 Gallery viewer: full image and full-view lightbox; 21.4 Group combobox with photo counts (Move, Merge); 21.5 Re-baseline the protected-path gate; 21.6 No-limit upload; 21.7 Large photo pixel cap. Files: `docs/stories/21.1-app-frame-and-per-panel-scroll.md` to `docs/stories/21.7-large-photo-pixel-cap.md`. Order: 21.1 first; 21.2 and 21.3 after 21.1; 21.4 after 21.2; 21.6 after 21.1 (it edits `Upload.tsx`, not the frame); 21.5 last, after 21.6 (owner approval; PRs 21.1 to 21.4 fail `electron-protect` until it lands). 21.3 overlaps 13.10 (`ready`, Viewer); 21.4 reopens UR-15 (13.8); 21.2 replaces the sticky save bar of 13.7.

Total: 7 migration epics (14 to 20), 33 stories; plus Epic 21, 7 stories, outside the migration. Order: 14 first; 15 after 14.1 (15.3 also after 14.4); 16 after 15.4; 17 after 15.3 and 16.2; 18 after 14.3, 15.1, 16.6 and 17; 19.1 after 14.1, rest of 19 after 15.4 and 18; 20 after 14 to 19; 21 independent of 14 to 20, but its 21.5 moves the gate that 14.1 set, and 21.6 and 21.7 also change `backend/`.

### Migration coverage map (inventory to story)

| Surface | Story |
|---|---|
| `api_request` | 16.1, 16.2 |
| `sign_in` | 16.4, 16.5 |
| `sign_out`, `session_only` | 16.3 |
| `set_dirty` | 16.6 |
| `upload_files` kinds `photo`, `dropped`, `cancel` | 17.1 |
| `upload_files` kinds `watch`, `unwatch` and drag and drop | 17.2 |
| `upload_files` kinds `attachment`, `avatar` | 17.3 |
| `export_gowns` `start`, `cancel` | 17.4 |
| `check_update`, `install_update` | 18.3, 18.5 |
| Closed nine-command set, error contract | 15.4 |
| `klei-img://` protocol and Windows host quirk | 17.5, 14.3 |
| `klei://auth/callback`, single instance, loopback | 16.5 |
| OS keychain | 16.3, 14.3 |
| Dialogs, `open::that` | 17.1, 17.3, 17.4, 16.4 |
| Clipboard, `execCommand`, `beforeunload`, hash routing | 17.6 |
| Window, CSP, navigation, permissions | 15.1, 15.2 |
| Tauri JS import `bridge.ts:1` (`invoke`, `Channel`) | 14.4, 15.3 |
| Packaging, signing, updater config, download site, CI, release | 18.1, 18.2, 18.5, 19.1 to 19.4 |
| Cutover, rollback, retirement | 20.1 to 20.4 |
