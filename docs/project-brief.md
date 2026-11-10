# Project Brief: Klei Bridal Dashboard (desktop)

Author: Analyst (BMAD). Status: REVISED with user answers, awaiting explicit approval (Gate 1). Inputs: `docs/wireframe-inventory.md`, orchestrator brief.

## 1. Summary

Desktop app for a bridal studio's staff. Upload gown photos; AI groups photos of the same gown, tags attributes, writes a description. Staff browse the gown gallery, handle client inquiries (email-style threads, rich-text replies, AI draft/summarize/suggest gowns), and admins manage staff, roles, AI provider and audit log. All stored data is encrypted at rest.

## 2. Problem and opportunity

- Gown photo cataloguing is manual: grouping, naming, tagging, describing.
- Client inquiries arrive from the website form and need fast, consistent, on-brand replies that reference matching gowns.
- Client and business data is personal (names, emails, phones, wedding dates, photos). A leak is a trust and legal risk. Hence encryption is a core requirement, not an add-on.

## 3. Users and roles


| Role   | Can                                                                 | Cannot                                         |
| ------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| Admin  | everything incl. staff, roles, AI settings, audit log, delete gowns | n/a                                            |
| Staff  | upload, edit gowns, reply and close inquiries                       | delete gowns, manage staff, AI settings, audit |
| Viewer | read (assumed)                                                      | all mutations                                  |

One workspace, unlimited staff (decided). Seeded team size: 5.

## 4. Goals and success measures (proposed, confirm in PRD)

- G1: 30 photos -> grouped, tagged, described gowns in one review session; user confirms or edits before save. Metric: staff edits per group (target to set in PRD).
- G2: Reply to a new inquiry in minutes with an AI draft the user always reviews. AI never sends.
- G3: Zero plaintext PII/business data in PostgreSQL or MinIO, proven by an automated sentinel test on every build.
- G4: macOS, Windows and Linux builds install and run against the dockerised backend.

## 5. Scope

**In (MVP, from wireframe)**: auth (login, invite, verify, forgot/reset; no 2FA), dashboard, AI Upload (process, review, move/split/merge, save, discard), Gallery (filter, viewer, edit, zip, bulk delete), Inquiries (inbox, thread, composer, status, drafts, customer profile), AI assistance, Settings (profile, signature, away message/closure, preferences, notifications, admin: staff, roles, AI provider/settings, audit), global search, notifications.
**Decided in**: global AI chat drawer (single AI surface), AI confidence in upload review.
**Dropped for good**: per-thread AI panel with tone chips, reply templates, "Share in a reply".
**Deferred / out of MVP**: inquiry intake channel (website form, IMAP, forwarding), TOTP 2FA, i18n, AI credits metering.
**Added to wireframe scope**: "Embedding model" field in AI provider settings (wireframe has only Model and Vision model). Default `dinov2-base`.
**Out (assumed)**: public website form UI, billing, multi-workspace tenancy, mobile, calendar/booking.

## 6. Fixed constraints

- Stack: Tauri (Rust + web frontend), Kotlin on Maven backend, PostgreSQL, MinIO (S3), SMTP (Mailpit dev/test), Docker Compose (backend, PostgreSQL, MinIO, Mailpit).
- Chosen later via ADR in architecture doc: Ktor vs Spring Boot, frontend framework, Flyway vs Liquibase, auth mechanism, transport (HTTPS REST/JSON unless realtime needed).
- Secrets only via git-ignored `.env`; committed `.env.example`. Tauri bundle holds no secrets; tokens in OS keychain.
- Design: taste-skill + frontend-design at UX step; follow wireframe layout and flow.

## 7. Non-negotiable: encryption at rest (carried verbatim into PRD as top-level NFR)

Summary only here; the PRD will reproduce the orchestrator text verbatim.

- AES-256-GCM, unique random 96-bit nonce, AAD = table+column+row id. Envelope: DEK wrapped by env/secret-store KEK, `key_version` stored, re-wrap job for rotation.
- One `CryptoService` + transparent column converter; feature code never calls crypto primitives.
- Blind index (HMAC-SHA-256, separate key, normalized value) for exact-match search only.
- Unencrypted allowed: random UUIDv4 keys, schema-version tables, ciphertext envelope fields. Timestamps encrypted unless ADR says otherwise. Passwords Argon2id, also enveloped.
- MinIO objects client-side encrypted with the same envelope; random UUID keys; filenames/metadata encrypted in DB.
- Logs, errors, Mailpit mail carry no plaintext PII; outbound mail minimal and documented.
- AI data (prompts, responses, settings, keys, usage logs) encrypted; document what leaves the system and when.
- Sentinel verification suite: insert via API, dump all tables via SQL, assert no plaintext.

## 8. Analyst findings that shape later phases

1. **Encryption vs search.** Gallery filters (silhouette/fabric/date), global search (gown name/tags, inquiry name/subject), status filters and similarity all want plaintext queries. Direction: blind index for exact-match fields (tags, status, email); free-text search and similarity in memory after decrypt. Limits (no prefix/substring/range in SQL; scale ceiling of in-memory scan) go in an ADR.
2. **Embeddings (dinov2-base or siglip2-base, already on LiteLLM).** For grouping same-gown photos and "suggest gowns". Backend fetches vectors from LiteLLM. Vectors derive from client photos, so store encrypted; no pgvector on plaintext. Similarity runs in backend memory, bounded per A6. ADR needed. Photos leave the system for LiteLLM: document it.
3. **Data leaving the system.** Photos (vision model), inquiry text (assistant), prompts go to the configured OpenAI-compatible provider (or local Ollama). Must be documented, key stored encrypted, "Test connection" and `/models` server-side only. Per-thread assistant promise: "reads this thread only, never sends anything without you".
4. **Inbound inquiries.** Intake deferred (A8). Inquiry records come in through the authenticated API only. Gap: without intake the Inquiries screen has no real data source; acceptable for MVP, flagged. Outbound reply = SMTP. Reply body, attachments and signature are PII; Mailpit mail must stay minimal.
5. **Offline.** Desktop shell but backend-dependent. Needs explicit connection-loss behaviour in PRD (read cache? queued drafts?). Draft autosave exists in wireframe.
6. **Zip download** moves from client-side to post-decrypt on the Tauri or backend side.
7. **Taxonomy** is admin-editable, so tag values are data (encrypted, blind-indexed), not enums.
8. **Audit IP and actor** are PII; encrypt.
9. **2FA** deferred (A9). Remove the 2FA card and "admin 2FA requirement" copy from MVP UX.

## 9. Risks


| Risk                                       | Impact                     | Mitigation                                            |
| ------------------------------------------ | -------------------------- | ----------------------------------------------------- |
| R1 No scale limit vs in-memory similarity/search | slow or memory-bound at large corpus | design targets in PRD (A6); ADR; blind-index pre-filter; paged decrypt; load test story |
| R2 LiteLLM dependency for embeddings, vision, chat | feature outage; photos and inquiry text egress | health check, clear error states, documented egress, admin-set endpoint, key encrypted |
| R3 3-OS packaging (Windows/Linux) | extra CI, keychain differences, webview quirks | CI matrix from first desktop story; Tauri per-OS smoke test |
| Plaintext leak via logs, AI provider, mail | breach                     | leak test in CI; log scrubber; documented egress      |
| Key loss                                   | data unrecoverable         | KEK backup/rotation runbook; re-wrap job              |
| Toolchain gaps (see below)                 | blocked dev start          | install in Story 1.x or pin in architecture           |
| Wireframe screenshots disagree with code   | wrong build                | JS authoritative (A2); UX step flags remaining deltas |

## 10. Environment

Present: node 24, npm, Java 27 (non-LTS), Docker 29. Missing: Maven, Rust toolchain (`cargo`/`rustc`). Architecture doc pins JDK LTS and lists installs. BMAD v6.12.4 installed (core + BMM, Claude Code skills under `.claude/skills`, output folder `docs`).

## 11. Assumptions

- A1: One workspace, no tenancy model.
- A2: Wireframe JS is authoritative over screenshots (user chose the global drawer, which is the JS design).
- A3: AI surface = global chat drawer only. Reads inquiries and gallery on request, never sends anything itself.
- A4: Targets macOS, Windows, Linux from MVP.
- A5: Mock data, timings and canned AI text are not requirements.
- A6: No hard caps, but PRD design targets (to be confirmed): usable at 10k gowns / 100k photos / 50k inquiries with paged queries. Exact-match filters via blind index in SQL. Free-text search and similarity must not require decrypting the whole corpus per request: needs ADR (e.g. encrypted per-gown vectors cached in server memory after warm-up, bounded candidate set from blind-index tag filters).
- A7: Embeddings, vision and chat all go through one OpenAI-compatible provider configured in AI settings. LiteLLM (`https://nextgen-ai.enlinka.co`, embedding `dinov2-base`) is the default preset; wireframe presets stay selectable.
- A8: Inquiries enter via authenticated API; no public intake, no IMAP, no website form in MVP.
- A9: No 2FA in MVP. Auth = invite, email verify, password, reset.

## 12. Decisions from user (answers to the 5 gate questions)

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | AI design | **Global chat drawer wins.** | Per-thread panel (Draft reply / Summarize / Suggest gowns / tone chips) out of MVP. Meaning of red boxes not stated: treated as focus areas; JS is authoritative. Composer templates, Share-in-a-reply: dropped for good. AI confidence stays (already in JS upload review). |
| 2 | Packaging | **macOS + Windows + Linux.** | Tauri build matrix x3. Token storage: macOS Keychain, Windows Credential Manager, Linux Secret Service. Rust toolchain + per-OS CI runners needed. |
| 3 | Tenancy / scale | **One workspace. No limit on staff, gowns, photos.** | Conflicts with "similarity and free-text search in memory after decrypt". See risk R1 and assumption A6. |
| 4 | Embeddings | **Already deployed on LiteLLM**, model `dinov2-base`, URL `https://nextgen-ai.enlinka.co`. Config lives in AI settings. | No local/sidecar inference. Backend calls LiteLLM (OpenAI-compatible) server-side. Photos leave the system to that endpoint: document egress. Vectors stored encrypted. |
| 5 | Inquiry intake and 2FA | **Disregard for now.** | Intake channel and TOTP 2FA deferred, not in MVP. Inquiries exist via authenticated API only (also what the sentinel test uses). 2FA card/audit copy dropped from MVP. |

Follow-up answers:
- **LiteLLM connection**: no credentials needed from the user. Admin enters URL, key and models in Settings > Admin > AI settings (already in wireframe). Default endpoint `https://nextgen-ai.enlinka.co`, embedding model `dinov2-base`. The key is entered at runtime, stored encrypted, never in `.env` or the repo.
- **Template / Share-in-a-reply / per-thread AI panel**: dropped for good.

## 12b. Remaining OPEN QUESTIONS (non-blocking for PRD)
1. Scale vs encryption: "no limit" cannot mean in-memory decrypt of everything. PM sets design targets (A6) unless you give numbers.
2. Spike for Architecture, not a user question: confirm the LiteLLM endpoint accepts images on `/embeddings` for `dinov2-base`. Admin "Test connection" must cover it. If it does not, fallback is an ADR.

## 13. Next (after approval)

PM writes `docs/prd.md` (encryption NFR verbatim, performance, offline, packaging). Then UX, Architect + readiness check, Scrum Master (story order: docker-compose -> Maven skeleton -> CryptoService + converter + leak test -> auth -> features), Dev/QA per story.
