# Review: Architecture Spine + architecture.md vs PRD and UX spec

Reviewed: `ARCHITECTURE-SPINE.md` (spine), `docs/architecture.md` (arch; spine wins), against `docs/prd.md` (final) and `docs/ux-spec.md`. Date 2026-11-08. Read-only review.

Severity: critical = violates non-negotiable or blocks build; high = two units will diverge or requirement unmet; medium = gap likely to cause rework; low = polish or consistency.

## 1. Verdict

**Revise before story breakdown. No critical findings. 9 high, 26 medium, 15 low.**

Strengths: crypto core (AD-2..AD-7) is concrete and enforceable (ArchUnit, schema allowlist, leak suite). Blind-index list and limits are documented as NFR-1 demands. Stack versions verified current (section 2). Every FR and NFR has a home in arch section 11.

Weaknesses: (a) the design builds on two PRD deviations (plaintext `seq`, Hibernate listener instead of converter) still open as OQ-2/OQ-4 with no fallback; (b) rotation, session and offline rules contradict each other across spine/arch; (c) several divergence points are undecided (Tauri IPC for uploads, integration token, retrieval for the Assistant, rich-text sanitizing of inbound mail); (d) operations dimensions (rollback, observability, environments, deploy gating) thin.

## 2. Tech verification (Maven Central, npm, crates.io, Docker Hub, GitHub; checked 2026-11-08)

| Item | Result |
| --- | --- |
| Spring Boot 4.1.2, Spring FW 7.0.10, Security 7.1.2, Hibernate 7.4.13.Final, Flyway 12.4.0, Kotlin 2.3.21, JUnit 6.0.3, Testcontainers 2.0.5, JDBC 42.7.14, Thymeleaf 3.1.5 | Match `spring-boot-dependencies:4.1.2` BOM exactly. Boot 4.2.0-RC2 exists but is pre-release, so 4.1.2 is right. Newer lines exist (Flyway 13.12.1, Kotlin 2.4.21, JUnit 6.1.3, Hibernate 7.4.15) but BOM pins are correct. See R-37. |
| AWS SDK 2.57.11, bcprov 1.86, OWASP sanitizer 20261103.2, TwelveMonkeys 3.15.3, springdoc 3.2.0, ArchUnit 1.5.1, Maven 3.9.16 | Latest on Central. |
| Mailpit v1.33.0, postgres 18.6, eclipse-temurin 25-jre | Tags exist. |
| Tauri 2.12.5 (crate), CLI/API 2.12.4, updater 2.14.1, deep-link 2.6.3, single-instance 2.5.5, keyring 4.2.0, reqwest 0.13.5, tokio 1.54.1, Rust 1.99.1 | Latest stable. |
| React 19.3.1, Vite 8.3.6, TS 7.0.2, Vitest 5.1.0, TanStack Query 5.107.1, react-router 8.5.1, TipTap 3.33.0, DOMPurify 3.4.17, openapi-typescript 7.13.0 | Latest on npm. **But** openapi-typescript 7.13.0 declares peer `typescript ^5.x`, conflicts with TS 7.0.2 (R-36). |
| MinIO | `minio/minio` GitHub repo archived 2026-04-24 (confirmed). OQ-1 correct. |
| MockK | Named in Conventions, absent from Stack table (R-37). |
| Dokploy claims (rolling deploy, scheduled `pg_dump`, `docker compose run`) | Dokploy compose docs confirm only named-volume backups; zero-downtime and one-off `run` not confirmed (R-19, R-21). |

## 3. FR / NFR coverage

All FR-1..FR-43 and NFR-1..NFR-9 appear in arch section 11, so none is orphaned. Weak spots: spine front matter claims `binds: NFR-1..9` but no AD binds NFR-3 or NFR-7, and NFR-2 only via AD-11 (R-26). Per-FR gaps listed in findings: FR-9 job execution (R-12), FR-16 stale edit (R-20), FR-21 retry (R-15), FR-22 reopen permission (R-34), FR-24 integration token (R-04), FR-26 retrieval (R-08), FR-35 immediate revoke (R-02), FR-43 draft-safe relaunch (R-30), NFR-2 benchmark story (R-18), NFR-4 per-OS CI smoke (R-17).

## 4. Findings

Format: id, severity, location, issue, suggested fix. "arch" = `docs/architecture.md`.

### 4.1 High

| Id | Location | Issue | Fix |
| --- | --- | --- | --- |
| R-01 | Spine AD-3/5/6/11, Deferred OQ-2, OQ-4; PRD NFR-1 | Design stands on two deviations from NFR-1 wording: plaintext `seq` (not on the NFR-1 allowed list) and Hibernate listener instead of `AttributeConverter`. Both still open, no fallback. If user rejects OQ-2, AD-5/6/11 (ordering, keyset paging, audit order) all change. | Get user decision before story breakdown. Move OQ-2/OQ-4 from Deferred to Decisions with PRD amendment. Record fallback (e.g. encrypted time + app-side sort, or converter + row-id AAD via entity callback). |
| R-02 | Spine AD-9; arch §6.1, §6.3 | Permissions fixed in JWT for 15 min; no per-request user/session check. FR-35 "loses access immediately" and FR-5/FR-30 session end unmet. Arch §6.1 contradicts itself ("fixed in JWT" vs "refresh re-reads matrix"). | Pick one: short-lived check of `session`/`app_user.active` per request (cached ms), or revocation list keyed by `jti`. State in AD-9 Rule. Fix §6.1 text. |
| R-03 | Spine AD-3, AD-4; arch §5.1, §5.3 | Blob carries `kek_version`, but re-wrap leaves column ciphertext untouched, so field goes stale. Removing old KEK is safe only if no unit reads it. | AD-3: `kek_version` informational only on column blobs (DEK id selects the key), or drop it from column blobs and keep it on wrapped DEKs only. |
| R-04 | Arch §7.2 `POST /inquiries`; FR-24 | "Integration token" undefined: issuance, scope, storage, rotation, revocation. Leak suite needs it. Two units will invent two schemes. | Add AD: static API key, hashed in DB, permission `PERM_INQUIRY_INTAKE`, rate limited, rotatable by Admin. Add to §6 matrix and §7.2. |
| R-05 | Spine AD-10 vs arch §9.5; FR-8, FR-17 | AD-10 says one Rust command `api_request(method, path, body)`; arch §9.5 lists six. No binary or multipart upload command for up to 200 photos at 25 MB, no download/zip IPC contract. `POST /gowns/export` payload unspecified. | Define IPC command set in spine (names, args, streaming of files, progress events). Pick one of the two texts. Specify export format and size cap. |
| R-06 | Arch §8.1 `ai-fetch/{token}`; AD-9, AD-1, §7.2 | Unauthenticated decrypting endpoint exists in §8.1 only. Absent from §7.2 contract, breaks AD-9 ArchUnit "every endpoint declares a Permission", and conflicts with port guard. Also S-1 may make it unnecessary. | Add to §7.2 with explicit `permitAll` exception rule in AD-9, token entropy, single use, 60 s, no logging of token. Or drop until S-1 fails. |
| R-07 | Arch A1, §9.3; AD-8 | Auth codes, rate limits and Auth Web sessions are in memory (A1). §9.3 says old container serves until new is healthy. Overlap breaks in-flight sign-in and rate limit counts. Rolling deploy unconfirmed on Dokploy. | State deploy = stop-then-start (brief downtime accepted), or move those states to PostgreSQL. Update AD-16. |
| R-12 | FR-9; arch §5.3 `RewrapJob`, orphan sweep, mail retry, credential expiry | No background-job model. Who runs FR-9 processing, re-wrap, orphan sweep, mail retry, expired-credential cleanup (expiry is encrypted, needs decrypt sweep)? Restart behaviour undefined; `phase_ct=processing` can hang forever. | Add AD: in-process scheduler plus `job` table with lease and retry, idempotent steps, startup recovery of stuck phases. Add to Deferred only what is truly later. |
| R-19 | Spine AD-16; arch §9.3, §9.4 | Ops rely on unverified Dokploy features: scheduled `pg_dump` and bucket copy, `internal: true` network behind Traefik, domain and port routing for two domains. Dokploy docs confirm only named-volume backups. | Verify against Dokploy docs/test instance, or own backup via a compose sidecar with cron. Record result as decision or OQ. |

### 4.2 Medium

| Id | Location | Issue | Fix |
| --- | --- | --- | --- |
| R-08 | FR-26; arch §8 | Assistant retrieval undecided: which data reaches the model, how scoped by permission, token budget, whether decrypted content is sent. Two units will diverge. | Add AD or arch subsection: retrieval = backend builds context from permitted rows, size cap, logged egress (counts only). |
| R-09 | Spine AD-6 vs arch; spine AD-4/Conventions vs arch §2/§5/§9.2; arch §10 | Cross-ref and naming conflicts: spine cites blind-index list at arch "§4.3", it is §4.2. ADR-n vs AD-n collide (ADR-3 = listener, AD-3 = envelope; ADR-11/13 vs AD-11/13). Env vars `KEK_<n>`/`BIDX_KEY` (AD-4, §2, §5) vs `KLEI_KEK_n`/`KLEI_BIDX_KEY` (Conventions, §9.2). | Fix §ref. Renumber ADRs or map table AD to ADR. One env naming, `KLEI_` prefixed everywhere. |
| R-10 | Spine ER diagram, AD-5/6; arch §4.3 | ER names (SESSION, INVITATION, UPLOAD_PHOTO, USER) differ from arch tables (`refresh_token`, `auth_credential`, `photo`, `app_user`). Spine lists `seq` on 5 tables, arch gives every table `seq`. | Align ER to real table names; AD-6 state one rule for which tables carry `seq`. |
| R-11 | Spine AD-2 | Import allowlist omits `@BlindIndexed`, `@RawCiphertext`, password hashing (Argon2/BouncyCastle), `SecureRandom`, JWT signer. `core` "never imports crypto" yet needs `@Encrypted`. `RewrapJob` in `crypto` needs entity tables. | Extend allowlist explicitly; name a `PasswordHasher` and `TokenSigner` owner; place `RewrapJob` in `app` calling a `crypto` API. |
| R-13 | Spine AD-3 | "Plaintext is JSON-free UTF-8" but `attributes_ct`, `prefs_ct`, `advanced_ct` hold JSON. | Say: plaintext is opaque bytes; JSON allowed, serialized by one mapper. |
| R-14 | Arch §5.4, ADR-3 | Listener decrypts all fields eagerly on `PostLoad` (NFR-2 budget risk). Unchanged updates re-encrypt (ciphertext churn). String-to-`bytea` mapping mechanism unspecified. ADR-3 says fallback both "kept" and "rejected". | Specify lazy or field-level decrypt, dirty check on plaintext, mapping via `AttributeConverter` shell + listener. Clean ADR-3 text. Story 1.3 acceptance tests it. |
| R-15 | FR-21; arch §7.4, mail | Reply retry after `mail_state=failed` conflicts with "repeat returns first result". No outbox or state machine for SMTP-after-commit. | Define `mail_state` machine (pending, sent, failed), retry endpoint or job, idempotency semantics. |
| R-16 | Spine AD-5, AD-17 | Allowlist test checks column names only. A plaintext value written into a `_ct` column passes. | Add per-column check: leak suite must write a Sentinel to every `_ct` column, or a test that every `_ct` value parses as envelope (version byte, length). |
| R-17 | NFR-4, NFR-7, SM-5; arch §9.5 | No per-OS CI install/smoke (macOS, Windows, Linux). No a11y check in CI. | Add CI matrix job: build, install, launch, Deep Link smoke. Add axe or equivalent on key screens. |
| R-18 | NFR-2 | No benchmark story. Gallery 48 x 4 thumbnail fetches go UI -> Rust -> API -> S3 -> decrypt; budget unproven. | Add perf test in `mvn verify` or a story: p95 per endpoint on seeded 5k gowns, thumbnail batch endpoint. |
| R-20 | FR-16; arch §7 | Stale-edit 409 has no mechanism (no version column or ETag). | Add `version` field (plaintext int allowed? needs allowlist entry) or encrypted `rev_ct` plus `If-Match`. |
| R-21 | FR-1; arch §9.3, Deferred SMTP | `docker compose run --rm backend bootstrap-admin` assumed on Dokploy, unconfirmed. Production SMTP Deferred, yet Invitation, verification, reset all need it. | Verify or provide env-based first admin. Move SMTP to OQ with owner, blocks go-live. |
| R-22 | Arch §5.2 vs §4.3, spine AD-3 | Nonce-limit text mentions a `data_key` counter and DEK replacement before 2^31 writes; §4.3 has no counter column; DEK rotation is Deferred. Spine omits the 2^32 limit. | Add counter column or drop claim; state the limit and trigger in AD-3/AD-4. |
| R-23 | AD-6; arch §4.2 | No unified tokenizer spec for term indexes (hyphens, multiword attribute values, Unicode). `inquiry_term` not rebuilt on Client rename. `status_bidx`/`unread_bidx` inferable by frequency. | One `Tokenizer` rule in AD-6; rebuild trigger list; document low-entropy leakage as accepted. |
| R-24 | AD-11; arch §4.4; UX audit | Keyset by `seq`, but Inquiry `seq` bumps on new Message so rows move between pages. UX audit shows "Page n of m", keyset gives no total. | Define cursor on activity `seq` with snapshot semantics; change UX or add encrypted-safe count endpoint. |
| R-25 | NFR-3; arch §7.1, §7.4 | Idempotency-Key and offline rules live only in arch, no AD in spine binds them. | Add AD: Idempotency-Key on all POST, retention, offline = read-only banner and Draft local only. |
| R-26 | Spine front matter `binds` | Claims NFR-1..9 but no AD binds NFR-3 or NFR-7; NFR-2 only AD-11. | Add ADs or edit `binds` honestly. |
| R-27 | FR-8, FR-9; arch §8, §9.2 | Photo upload retry not idempotent (duplicates). No decode-bomb or memory limit for image decode. Container memory, Tomcat multipart limits, tmpfs for read-only FS unspecified. | Per-photo client id for dedupe; pixel and size caps; set heap, multipart, tmpfs in compose. |
| R-28 | AD-14; arch §6 | `/invite/{token}`, `/reset/{token}` leak credentials into Tomcat and proxy access logs; AD-14 covers app logs only. Client IP and `X-Forwarded-*` trust behind Dokploy proxy unspecified (Secure cookies, rate limits, audit IP). | Tokens in POST body or fragment-free one-time form; access-log pattern without path; configure `ForwardedHeaderFilter` with trusted proxy. |
| R-29 | FR-3..5; arch §6 | Verification-code attempt limit and Invitation expiry unspecified. Audit table append-only plus failed-sign-in logging allows unbounded growth; retention Deferred. | Set numbers (e.g. 5 attempts, 7 days). Cap or aggregate failed-sign-in audit rows. |
| R-30 | AD-15; FR-43; OQ-3 | Updater private-key custody and loss strand every installed client; update host URL baked in bundle. Restart can lose an unsent in-memory Draft; mechanism undefined. | Document key escrow and compromise plan; endpoint indirection. Flush Draft to server (or block install while dirty) before restart. |
| R-31 | Spine Deferred | Omits DEK rotation, `BIDX_KEY` rotation, JWT key rotation, job runner. Deferred items let units diverge (e.g. DEK id handling). | List them with the constraint each unit must keep (dek_id in blob, bidx version tag). |
| R-32 | AD-16; arch §9 | Backup order (DB vs bucket consistency) and destination unspecified. No migration rollback plan (forward-only plus encrypted data migrations). Observability beyond logs undecided: liveness vs readiness, metrics, alerts, explicit no-telemetry stance. Environments: only dev compose and prod, no staging stance. | Add Operations section to spine: backup order and restore drill, rollback = restore, health endpoints, metrics decision, environments decision. |
| R-33 | AD-17; OQ-1 | Leak suite needs an S3 container but OQ-1 unresolved. Rule "Sentinel email must not appear in Mailpit" conflicts with invite recipient header. | Pick test S3 image independent of prod (e.g. pinned alternative). Define recipient-address exemption. |
| R-34 | Arch §6.2 matrix; FR-22 | `PERM_REPLY` conflates inbox read with Reply. Reopen permission unspecified. Dashboard permission scoping unspecified. | Split `PERM_INQUIRY_READ`/`PERM_REPLY`; state reopen and dashboard rules in matrix. |
| R-35 | AD-11; arch §7.3 | problem+json has no extension slot for Taxonomy "Used by {n} gowns" count and 502 `detail.check`. | Add `extensions` object with schema per `code`. |

### 4.3 Low

| Id | Location | Issue | Fix |
| --- | --- | --- | --- |
| R-36 | Spine Stack | `openapi-typescript` 7.13.0 peer `typescript ^5.x` vs pinned TS 7.0.2. | Verify install, or pin TS 5.x for tooling, or note `--legacy-peer-deps`. |
| R-37 | Spine Conventions/Stack | MockK named in Conventions, absent from Stack. Newer upstream lines exist (Flyway 13, Kotlin 2.4, JUnit 6.1) beyond BOM pins. | Add MockK with version; note BOM-pin policy. |
| R-38 | Arch §12 | Readiness check is a dangling placeholder. | Fill or delete. |
| R-39 | Spine Deferred S-2, S-3 | Spikes not defined in arch. | Add one-line acceptance per spike. |
| R-40 | Arch front matter | Sources omit wireframe inventory (spine lists it). | Add. |
| R-41 | Arch §6.2 | `PERM_KEY_ROTATE` is a ninth permission outside PRD's eight. | Note PRD delta or fold into Admin. |
| R-42 | Arch §9.2 | Bootstrap admin password remains in env after first run. | Document removal after bootstrap. |
| R-43 | Arch §7.2 | `DELETE /gowns` carries a body; some proxies strip it. | Use `POST /gowns/delete`. |
| R-44 | AD-16 | Image tags pinned by version, not digest. | Pin digests in prod compose. |
| R-45 | Arch §4.3 | `is_new_ct` stored flag semantics; `last_active_ct` write amplification; notification recipient fan-out undefined. | Derive or throttle; define fan-out rule. |
| R-46 | UX A-UX11 | Draft undo toast is a client-side re-PUT, not described in API. | Note in §7. |
| R-47 | Arch A3 | Unread semantics are cross-unit, belong in spine. | Promote to a Convention. |
| R-48 | Spine AD-6 | "Needs an ADR line" is process, not testable. | Test: bidx list in code equals doc table. |
| R-49 | AD-10; CSP | `connect-src 'none'` with Tauri IPC and `klei-img://` plus `style-src 'self'` viability not spiked. | Add spike note. |
| R-50 | AD-13 | Embedding retention after Save unstated. | State: keep or delete vectors after Save. |

## 5. Internal consistency summary

- Ids: AD vs ADR numbering collide (R-09). OQ-1..5 consistent across spine and arch. S-2/S-3 not in arch (R-39).
- Section refs: spine "§4.3" should be §4.2 (R-09); arch §12 dangling (R-38).
- Names: env vars, ER vs table names, `seq` scope (R-09, R-10).
- Endpoints: `ai-fetch` missing in §7.2 (R-06); IPC command count (R-05).
- NFR-1 wording vs design: plaintext `seq` and listener are deviations (R-01); blind indexes, term indexes, day buckets documented as leakage; `kek_version` staleness (R-03).

## 6. Not checked

Runtime behaviour (no code exists). Dokploy features beyond docs. Full wireframe inventory against UX. Counts in section 1 are final.
