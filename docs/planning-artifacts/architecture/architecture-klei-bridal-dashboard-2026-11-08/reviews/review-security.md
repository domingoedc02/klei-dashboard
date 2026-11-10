# Security / crypto review: Klei Bridal Dashboard architecture

Reviewer lens: security and cryptography against PRD NFR-1 (verbatim) and NFR-5/6/8.
Scope: `ARCHITECTURE-SPINE.md`, `docs/architecture.md` §4 to §8 (plus §9 where it touches secrets, backups, mail).
Date: 2026-11-08. Read-only review; no other file changed.

## Verdict

**Not ready to build as written. Conditional pass after fixing C-1, H-1..H-6.**

The core scheme is sound: AES-256-GCM, random nonce, AAD binding, envelope, KEK ring, separate BIDX key, client-side object encryption, Rust-only network client, PKCE flow. Nonce math is fine (see L-1). The weaknesses are not in the primitives. They are in what the design leaves outside the ciphertext: ciphertext length, low-entropy blind indexes, plaintext FK/NULL/seq structure, URLs and logs outside the app, and several unspecified trust boundaries (AI base URL, integration token, image decoder, redirect validation).

Ratings: critical / high / medium / low.

---

## Critical

### C-1. Ciphertext length leaks every enum-like and boolean value (no padding)

- Location: AD-3 envelope; §4.1 "Booleans, numbers, enums and dates are serialized to text before encryption"; §4.3 columns `status_ct`, `direction_ct`, `kind_ct`, `read_ct`, `revoked_ct`, `verified_ct`, `is_new_ct`, `enabled_ct`, `phase_ct`, `mail_state_ct`, `outcome_ct`, `purpose_ct`, `type_ct`, `role.name_ct`, `role_permission.permission_ct`.
- Issue: GCM is a stream mode, so `len(blob) = 31 + len(plaintext)`. `new`=3, `closed`=6, `replied`=7. `true`=4, `false`=5. `invite`=6, `reset`=5. `Admin`=5, `Staff`=5, `Viewer`=6. `silhouette`=10, `fabric`=6. Anyone with a DB dump (the exact NFR-1 threat) reads status, unread/read, revoked sessions, consumed credentials, direction of every message, and which permissions each role holds, with no key. This also voids the §4.2 claim that `status_bidx` reveals "three groups, not which group is which": the length of `status_ct` names the group. The sentinel suite cannot catch it because no sentinel string appears.
- Fix: add a padding step inside `CryptoService` (so no feature code is involved). Encode `[len:2][plaintext][zero pad]` and pad to a bucket: fixed 32 bytes for any field under 32 bytes, then next power of two for larger fields (bodies, descriptions, prompts). Booleans become single bytes `1`/`0`, enums become fixed-width codes. Add an AD-3 line and a schema test asserting `min/max(octet_length)` per enum-like `*_ct` column is one value in the leak suite. Also pad `api_key_ct` (key length/prefix) and `vector_ct` is already fixed.

---

## High

### H-1. Blind indexes on low-entropy fields are frequency-analysable and brute-forceable

- Location: §4.2 `inquiry.status_bidx`, `inquiry.unread_bidx`, `gown.day_bidx`, `gown_attribute.attr_bidx`, `taxonomy_value.attr_bidx`, `gown_term.term_bidx`, `inquiry_term.term_bidx`, `*.email_bidx`; AD-6.
- Issue:
  1. Domain size 2 to 3 (status, unread): group cardinality plus correlation with plaintext `seq` order identifies the group (most rows are Closed; unread rows are the newest). Even if C-1 is fixed.
  2. `day_bidx` plus plaintext `seq` gives an ordered activity-per-day histogram for every upload. Behavior timeline is exactly what NFR-1 says to encrypt "unless an ADR justifies otherwise". ADR-10 mentions day buckets but never weighs this leak, and it is not an OQ like `seq`.
  3. `attr_bidx` domain is the Taxonomy (tens of values), `term_bidx` is a natural-language vocabulary (Zipf). Frequency analysis against the public bridal vocabulary ("lace", "a-line", "satin") works without the key. Term count per Gown also reveals name length.
  4. `BIDX_KEY` sits in the same Dokploy env as the KEKs and `JWT_KEY` (§9.3). If it leaks (host, logs, `docker inspect`) every low-entropy index and every email falls to an offline dictionary in milliseconds. §4.2 admits this only for email.
- Fix: (a) drop `status_bidx` and `unread_bidx`; filter status by decrypting a bounded page, or keep a small count table the app maintains in memory and rebuilds at startup. (b) For `day_bidx`: either bucket coarser (ISO week, group Last 7/30/90 into week hashes) and make it an explicit OQ for the user, or drop date filtering to "decrypt page and filter" for the last N. (c) Keep term/attr indexes but state the frequency-analysis limit as an accepted limit in §4.2 and OQ-2-style user sign-off. (d) Derive per-index subkeys `HKDF(BIDX_KEY, "gown_term")` so one index key use is isolated. (e) Move `BIDX_KEY` to a file-mounted secret separate from KEKs where Dokploy allows.

### H-2. SSRF and credential exfiltration through the AI base URL admin setting

- Location: §8.1; `ai_setting.base_url_ct`; `POST /admin/ai/test`; `PERM_AI_SETTINGS` (§6.3, editable in the matrix, so grantable to Staff).
- Issue: the backend is on both `internal` (postgres, objectstore) and `edge` networks (§9.1), so an arbitrary URL reaches `postgres:5432`, `objectstore:9000`, `127.0.0.1:8081`, `169.254.169.254`. The test result carries `detail` strings. Worse: changing only the URL and clicking Test sends the **stored API key** to the new host; every later call sends Photos and Inquiry text there. One compromised or malicious `PERM_AI_SETTINGS` holder exfiltrates the studio. Redirects and DNS rebinding bypass naive checks. No audit entry is specified for a URL change.
- Fix: HTTPS only (dev flag for HTTP); resolve and pin the IP at connect time and reject loopback, link-local, private, CGNAT, ULA, metadata ranges (custom `DnsResolver`/socket factory, not a pre-check); no redirects; response size and time caps; never echo provider body in `detail`; require re-entry of the API key when scheme/host changes; write an Audit Entry on every change; optional `KLEI_AI_ALLOWED_HOSTS` allowlist; make `PERM_AI_SETTINGS` Admin-only and non-editable like `PERM_KEY_ROTATE`. Same rule for the one-time `ai-fetch` URL fallback (S-1): it is an unauthenticated decrypting endpoint, so token 256-bit, constant-time compare, rate limited, never in logs.

### H-3. Plaintext leaks outside the app log: URLs, tokens, proxy and Tomcat access logs

- Location: §7.2 `GET /search?q=`, `GET /gowns?silhouette=&fabric=`, `GET /inquiries?status=`; §6.2 `/invite/{token}`, `/reset/{token}`; §9.3 Dokploy proxy; AD-14; §5.6 "Logs" row.
- Issue: search terms (client names!) and filter values go in the query string. Dokploy's reverse proxy and Tomcat access logs record full request lines. Invite/reset tokens in the path are logged while still unconsumed, so log access equals account takeover. PRD NFR-1 says no plaintext in "any ... log". The leak suite only scans "the captured log buffer" of the backend, so these never get tested. Also unmentioned: Hibernate/Jackson/Bean Validation messages include input (Jackson parse errors quote source snippets; `ConstraintViolation` invalid values; Kotlin `data class` `toString()` on entities holding decrypted fields prints plaintext when logged or when an exception message embeds the entity).
- Fix: search and filters as `POST` bodies (or opaque server-side filter ids); keep the path tokens but exchange them: `GET /invite/{token}` sets a short cookie and 302s to `/invite` (no token in the URL afterward), and configure the proxy and Tomcat access log to log method and path only, no query string, no `Authorization`. Add ArchUnit rules: no `data class` and no `toString` on `@Entity`; ban `logging.level.org.hibernate.orm.jdbc.bind`, `org.hibernate.SQL` above INFO in prod profile; set `server.error.include-message=never`, `include-binding-errors=never`, `spring.jackson` parse messages mapped to fixed codes. Extend the leak suite to scan proxy and Tomcat access logs, PG server log, container stdout.

### H-4. Untrusted image decoding in the process that holds all keys

- Location: §5.5 steps 1 to 2; A6; AD-7; stack row TwelveMonkeys WebP, `ImageIO`.
- Issue: only a 25 MB byte cap is specified. A 25 MB PNG or WebP can declare gigapixel dimensions (decompression bomb) and OOM the JVM that holds the DEK, KEKs and JWT key. With `HeapDumpOnOutOfMemoryError` set (a common default in images) the OOM writes keys plus plaintext to disk. Native JPEG decoding in the JDK and third-party WebP decoders have a CVE history. ImageIO dimension metadata can lie. "Strip metadata" is ambiguous: if the original is stored as uploaded, EXIF GPS and embedded payloads (polyglots) survive into the export zip and the `klei-img://` response.
- Fix: read header dimensions through `ImageReader.getWidth/getHeight` before decode and reject above a pixel cap (for example 40 MP); semaphore on concurrent decodes; per-decode timeout; `-XX:-HeapDumpOnOutOfMemoryError`, `-XX:+ExitOnOutOfMemoryError`, `-XX:+DisableAttachMechanism`; container memory limit. Re-encode the original too (decode then encode) so what is stored and served is generated by you, or state it explicitly as an accepted risk. Longer term, decode in a keyless sidecar or short-lived process. Serve images with forced `Content-Type: image/jpeg|png|webp`, `X-Content-Type-Options: nosniff`, `Content-Disposition` fixed.

### H-5. "Integration token" for `POST /inquiries` is an undesigned credential

- Location: §7.2 Inquiries row (`PERM_REPLY` or an integration token); FR-24.
- Issue: it is the only ingest path for untrusted third-party content and it appears nowhere else: no storage (hash? bidx? encrypted?), scope, rotation, rate limit, size limit, attachment policy, or audit. Without it the auth model has an undocumented bypass of the JWT/permission design (AD-9 says every endpoint declares a Permission).
- Fix: model it as a table `integration_token` (`token_bidx`, `name_ct`, `scope_ct`, revoked), authority `PERM_INGEST` only, 256-bit random, shown once, rotation and revoke in Admin, per-token rate limit and body cap (for example 256 KB, no attachments in MVP), body HTML sanitized on ingest and display, Audit Entry per creation. Or delete it from the MVP contract (YAGNI: PRD §9.2 already defers public intake).

### H-6. Sign-out does not end the Auth Web session; `/authorize` silently re-issues codes

- Location: §6.1 flow ("login page (or session still valid)"), "Keep me signed in lengthens the Auth Web cookie", `POST /auth/logout` revokes only the refresh family.
- Issue: after Sign out in the desktop app, the browser still holds a valid Auth Web cookie (possibly long-lived). The next "Sign in" returns a code with no password. On a shared studio Mac, sign-out is not sign-out. Silent issuance also means any web page can trigger `GET /authorize?...redirect=http://127.0.0.1:<port>/callback` in the victim's browser and a code is released to whatever listens on that port (PKCE limits the damage to local processes, but there is no consent step and parallel flows clobber the single session-held `state`/`challenge`).
- Fix: never auto-issue. `/authorize` always requires a fresh password entry, or shows an explicit "Continue as <name>?" confirm page with CSRF token. `POST /auth/logout` response tells the shell to open `GET /logout` (or use `prompt=login`). Key the stored authorize parameters to a per-flow id carried in the login form, not the session. Validate `redirect` by exact parsed comparison: scheme `klei` host `auth` path `/callback`, or scheme `http`, host exactly `127.0.0.1`, no userinfo, port 1024..65535, path `/callback`, no query; reject `localhost`, IPv6, prefixes, backslashes, encoded dots. Error redirects use only the validated URI. Bind the code to `client` and `redirect` as well as the challenge and re-check both at `/auth/token`.

---

## Medium

### M-1. Plaintext FK, NULL, presence and `seq` structure leaks semantics ("no meaning" claim is false)

- Location: §4.1, §4.3; AD-5, AD-6; OQ-2.
- Issue: NFR-1 allows surrogate keys "random, no meaning". These carry meaning:
  - `message.author_user_id` NULL means the message is from a Client; `message.idem_bidx` present means a staff Reply sent via API. Direction is therefore plaintext even though `direction_ct` exists.
  - `photo.gown_id` NULL means "still in a batch"; `app_user.avatar_object_id` NULL, `draft` row existence (which user is drafting which Inquiry), `embedding` existence.
  - `app_user.role_id`, `auth_credential.role_id`, `invited_by`: the org chart and who is Admin (role table has 3 rows, one has one user).
  - `refresh_token.user_id/family_id` plus `seq`: login frequency per user. `ai_usage.user_id`, `notification.user_id`, `assistant_chat.user_id`: per-user behavior.
  - §4.3 says "Every table also has `seq` unless noted" but AD-6 lists only gown, inquiry, audit, notification, message. The wider set (credentials, refresh tokens, terms, usage) adds behavior timelines.
  - OQ-2 states `seq` "reveals order and volume, not time". Combined with S3 `LastModified`, `xmin`, WAL/backup timestamps, and `pg_xact_commit_timestamp`, `seq` maps to wall-clock time. The OQ understates the trade and must be reworded for the user.
- Fix: restrict `seq` to the five paged tables only and add a schema test enforcing the list; replace nullable-FK semantics with always-present FKs plus encrypted state (for example a placeholder "batch" gown row, or a `direction` that is never derivable); move `role_id` into the encrypted user payload and resolve in memory (dozens of rows); restate OQ-2 honestly (order + volume + activity pattern per user, time-correlatable) and require the user's explicit yes; or accept and record it in an ADR.

### M-2. S3 metadata leaks sizes and times; spine only encrypts DB-side metadata

- Location: AD-7, §5.5, §5.6 S3 row.
- Issue: object `Content-Length` = plaintext + 28, so photo sizes (and thumbnail/original pair sizes, count of objects per upload) are visible. `LastModified` is a plaintext timestamp per upload, defeating "timestamps encrypted". `ETag`/`x-amz-meta-*` and `Content-Type` are whatever the SDK sends. The leak suite "lists keys, downloads, scans" content only, not metadata. The Mailpit/DB paths treat these as protected; the S3 path does not.
- Fix: set `Content-Type: application/octet-stream`, no user metadata, no tagging; pad object plaintext to size buckets (for example next multiple of 64 KB for thumbnails, 1 MB steps for originals) with the in-blob length prefix; record `LastModified` as an accepted leak in an ADR, or batch-write objects at rounded times (not practical), and tell the user. Add to the suite: assert all objects have the same Content-Type and zero metadata keys.

### M-3. Refresh rotation race and lockout design

- Location: §6.1 refresh token, "401: refresh once, retry once".
- Issue: several parallel `api_request` calls get 401 together (the Gallery fires many). Each refreshes with the same token; the second presents a spent token, the server treats it as theft and revokes the family: user logged out and an Audit Entry created for a non-attack. Crash between server rotation and keychain write loses the only valid token. With no grace window, a mere retry after a lost response also kills the session. Failure counters: 5 failures per account lets any attacker lock out the Admin (account lockout DoS); the IP counter keyed on the TCP peer is the Dokploy proxy for everyone, and keyed on `X-Forwarded-For` unconditionally is spoofable.
- Fix: single-flight mutex in the Rust shell around refresh (one refresh, other requests wait and reuse the result). Server: allow the just-rotated predecessor for 10 s and return the same successor (idempotent), otherwise treat as reuse. Persist new tokens to keychain before using them. Rate limits: key on account+IP pair with exponential backoff rather than hard lock; trust `X-Forwarded-For` only from the configured proxy hop (`server.forward-headers-strategy=NATIVE` plus an explicit trusted-proxy list). Extend limits to `/auth/token`, `/auth/refresh`, `/forgot`, `/verify`, resend (mail-bomb), and cap Argon2id concurrency (64 MiB each; add semaphore and max password length 128).

### M-4. Verify-code attempts counter is an encrypted read-modify-write

- Location: `auth_credential.attempts_ct`, 6-digit code (§4.2 last paragraph).
- Issue: a counter stored as ciphertext cannot be incremented with SQL. Parallel guesses read the same value and all pass the limit. The domain is only 10^6. The rate limiter is in memory (resets on deploy).
- Fix: `SELECT … FOR UPDATE` on the credential row and increment inside the transaction; delete the credential after 5 attempts; hash the code (HMAC with BIDX key under prefix) instead of reversible `code_ct`; constant-time compare.

### M-5. Sessions not revoked on password change, reset, user disable, role change

- Location: §6.1, §6.3, FR-35/36.
- Issue: nothing says refresh families die on `POST /me/password`, reset completion, user deletion/deactivation, or role demotion. Refresh "re-reads the matrix" but the spec does not say it checks the user is still Active. A fired employee keeps access. Access JWT is also not checked against `sid` revocation within its 15 minutes.
- Fix: those events revoke all of the user's families and Auth Web sessions; refresh checks user Active and re-resolves `perms`; sensitive endpoints (Admin, key rotation, AI settings) check `sid` against a revoked set (in memory, A1).

### M-6. Token and secret handling around the keychain and `api_request`

- Location: AD-10, §9.5, ADR-12.
- Issue:
  - Windows Credential Manager blobs are capped at 2,560 bytes. A JWT with `perms[]` plus a refresh token can exceed it through the `keyring` crate. macOS: unsigned or ad-hoc builds change code identity on each update, so the keychain ACL prompts or denies. Linux Secret Service has no per-app isolation: any process in the session reads it. None of this is mentioned.
  - `api_request(method, path, body)`: the path comes from the webview. If concatenated onto the base URL, `@evil.host`, `.evil.host`, `//evil`, `\`, `..` or encoded dots can redirect the bearer token to another host. `save_zip` must not accept a path from the webview, or an XSS in the webview gives an arbitrary file write.
  - A compromised webview cannot read tokens but can drive the full API as the user; residual risk should be stated.
- Fix: keychain stores only the refresh token (separate small entries for refresh and optionally verifier); access JWT lives in Rust memory. Rust builds the URL with `Url::join` on a fixed origin, requires path matching `^/api/v1/[a-z0-9/_-]+$` plus validated query, rejects everything else, and never follows cross-origin redirects. `save_zip` opens the save dialog itself in Rust and takes only a list of gown ids. Document Linux keyring and macOS unsigned-ACL behavior; spike S-3 should test keychain persistence across an update.

### M-7. SMTP transport and mail header safety unspecified

- Location: §8.2, `KLEI_SMTP_*`.
- Issue: Reply mail is the one mail with content (and invite links). Nothing requires STARTTLS/TLS or certificate validation in production, so content and links may traverse the network in plaintext. Client-controlled strings (subject, attachment filenames, display names) go into headers and `Content-Disposition`; CRLF/folding injection and long names are not addressed. The leak suite says "fail if the sentinel email appears" in Mailpit, which conflicts with invite/verify mail addressed to that email.
- Fix: `mail.smtp.starttls.required=true` and `ssl.checkserver=true` outside the dev profile, boot check fails otherwise; build messages only through `MimeMessageHelper` with encoded words and strip CR/LF/control characters and path separators from subject and filenames; `Reply-To` only from a verified User email; mail links built only from `KLEI_AUTH_BASE_URL` (already stated, keep as a tested rule: never from `Host`). Define sentinel classes in the suite: client PII must never appear in system mails; recipient address in `To` of a system mail is allowed.

### M-8. Leak suite blind spots

- Location: §5.7, AD-17.
- Issue: it scans COPY output, bytea decoded as text, S3 bodies, Mailpit, backend log buffer. It does not scan: WAL and `pg_dump` output, PG server log, `pg_stat_statements`/`pg_stat_activity`, index pages, Flyway history, proxy/Tomcat logs (H-3), S3 metadata (M-2), base64/hex/URL-encoded and case-folded variants of each sentinel, error paths (failed mail, AI provider failure, invalid input, crypto failure), the `ai-fetch` fallback, or a rotated-KEK state. It runs happy paths only, so exceptions and DEBUG logs that leak are never hit. It cannot detect length leaks (C-1) or FK/NULL semantics (M-1).
- Fix: add sentinel encodings; drive failure paths with the stub AI, a failing SMTP, malformed JSON and oversized uploads; scan `pg_dump -Fc` and a base backup; add structural assertions (per-column length-set size, S3 metadata keys, nullable-FK list from an allowlist). Run once with `KEK_ACTIVE=2` after a rewrap.

### M-9. Envelope header not authenticated; AAD uses DB identifiers; key-wrap spec missing

- Location: AD-3, §5.2, `data_key`, `stored_object`.
- Issue: `version`, `kek_version`, `dek_id` are outside the AAD, so they are unauthenticated (tamper gives decrypt failure or a downgrade path when a second `version` appears). AAD uses physical `table|column` names, so a Flyway rename invalidates every ciphertext. The wrap algorithm and its AAD for `wrapped_dek` are not given, so a wrapped DEK is not bound to its row. `kek_version` in every column blob goes stale after a re-wrap (columns are never rewritten), so it contradicts NFR-1 "store key_version with each ciphertext" literally and is misleading; the object-blob format `[dek_id:16]` also does not match per-object DEKs held in `stored_object`.
- Fix: AAD = `version|dek_id|<logical-table>|<logical-column>|<rowId>` where logical names are annotation constants, not DB names; specify DEK wrap as AES-256-GCM (or AES-KW) with AAD `"dek|"+dek_id+"|"+kek_version`; remove `kek_version` from column blobs (keep in `data_key`/`stored_object`) and note the reading of NFR-1 as an OQ for the user; define the object blob (`[version][dek wrapped in row][nonce]…`).

### M-10. Secrets surface in Dokploy, actuator and JVM

- Location: §9.2, §9.3, AD-16.
- Issue: Dokploy keeps env in its own store and writes the `.env` on the host; `docker inspect` and `/proc/<pid>/environ` expose every secret to anyone with host or Docker access. The KEKs, `BIDX_KEY`, `JWT_KEY`, DB password and SMTP password sit together. Nothing says Actuator `/env`, `/configprops`, `/heapdump`, `/threaddump` are disabled; `GET /health` on both ports is unauthenticated (should expose status only). JWT key rotation (`kid` is mentioned) has no procedure. Startup check only compares `BIDX_KEY == KEK`; keys derived from one another are not caught, and `JWT_KEY` separation is not checked.
- Fix: file-mounted secrets (`KLEI_KEK_1_FILE`, Docker/Swarm secrets) with 0400 perms where Dokploy allows; document the residual host-compromise risk (PRD NFR-8 already accepts it). `management.endpoints.web.exposure.include=health`, `health.show-details=never`. Startup check: all key materials pairwise distinct and distinct from the DB/SMTP passwords. Write the JWT rotation procedure (two public keys accepted during overlap).

---

## Low

### L-1. Nonce-bound math is fine; counter design is not

- §5.2 claims collision risk "below 10^-6" at about 10^7 ciphertexts. The birthday bound is about n²/2^97 = 10^14 / 1.6×10^29 ≈ 6×10^-16, so the claim is true and very loose. NIST SP 800-38D caps random-nonce invocations at 2^32 per key; replacing the DEK before 2^31 is correct. Problems: (a) a `counter` in `data_key` is a plaintext column outside the AD-5 allowlist; (b) counting every write is a hot-row update; (c) every `PreUpdate` encrypts again, so budget is "all writes including re-encrypts of unchanged columns". Fix: persist a high-water mark every 2^20 encryptions in an encrypted `counter_ct`, encrypt only dirty columns, and derive per-column subkeys `HKDF(DEK, table|column)` so budgets multiply and key use is separated. Also note DEK replacement is deferred as "separate offline job" but old DEKs stay in use for reads forever; acceptable.

### L-2. `CryptoService` is not the only crypto-touching class

- §5.1 says it is the only class touching `Cipher` and `Mac`, yet `ObjectCipher` (AES-GCM) and `BlindIndex` (HMAC) are separate, and AD-2 lets `app` import `CryptoService` directly while §2 says `core` never imports crypto. Flyway Java migrations call `CryptoService` through a narrow interface. This partially deviates from NFR-1 "one CryptoService; feature code must not call primitives". Fix: make `ObjectCipher` and `BlindIndex` internal delegates of `CryptoService`, and ArchUnit-forbid `javax.crypto`, `java.security.MessageDigest/Mac/SecureRandom` outside `crypto` (JWT library excepted by name).

### L-3. Argon2id and password policy

- m=64 MiB, t=3, p=1 exceeds the OWASP minimum, fine. Add a maximum length (128) to bound work and request size, a concurrency semaphore (memory DoS: 64 MiB each plus a dummy verify), and a breached/very-common password check beyond "8 chars and a number". Dummy verify must use the same parameters as real hashes after any rehash.

### L-4. Enumeration timing on `/forgot` and invite resend

- Equal bodies are specified, but sending SMTP synchronously only for existing accounts is a latency oracle. Queue mail asynchronously and respond immediately for both cases.

### L-5. Auth Web hardening gaps

- Add `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`; forbid `Set-Cookie` on 8080 and CORS on both; `__Host-` cookies require Path=/ and no Domain, which breaks nothing but note dev (`localhost:8080/8081` share cookies). Keep-me-signed-in length should have an upper bound.

### L-6. Update path

- Minisign key compromise has no recovery (public key is embedded). Document key custody and a rotation release signed by the old key. Unsigned installers plus "run `xattr -d com.apple.quarantine`" training weakens first-install trust; publish SHA-256/minisign signatures of installers with the install guide and make the first-run page show the version hash. Linux `.deb` is unauthenticated update path (manual).

### L-7. Zip export

- `POST /gowns/export {ids}` returns all decrypted bytes in one response: unbounded `ids` (10k Gowns times 4 photos times up to 25 MB) is a memory DoS on the key-holding process. Cap ids (for example 100 Gowns), stream per photo. Zip entry names derive from user content (`filename_ct`, Gown name): the Rust zip builder must strip `/ \ .. NUL`, drive letters and reserved Windows names, enforce unique names and length limits, and never use a name as a path. Same sanitization for `Content-Disposition` and mail attachments.

### L-8. Audit log integrity and backups

- `audit_entry` is append-only via a trigger that the DB owner can drop, and rows can be deleted by a DB writer. Add an HMAC chain (`prev_mac_ct`) keyed from the BIDX or a separate audit key if tamper-evidence matters. Backup destination, its credentials and retention are not specified; the Dokploy backup S3 target holds both halves (DB and bucket ciphertext), so the offline keys must not be reachable from it (stated, keep).

### L-9. AI and untrusted content

- Inbound Client text goes to the Assistant prompt and drafts: prompt injection can steer replies. The AI has no tools, rendered output passes DOMPurify and the CSP blocks remote images, so impact is low; state that the AI output is never auto-sent (PRD non-goal) as a security control. `ai_usage.prompt_ct/response_ct` retain full prompts: acceptable per NFR-1 but unbounded growth; add retention (PRD OQ).

---

## Deviations from verbatim NFR-1 not flagged as open questions

| # | NFR-1 text | Design | Flagged? |
|---|---|---|---|
| 1 | "transparent column converter (JPA AttributeConverter ...)" | Hibernate listener (ADR-3) | Yes, OQ-4 |
| 2 | "MinIO objects" | any S3 store | Yes, OQ-1 |
| 3 | Timestamps "encrypt unless an ADR justifies"; allowed plaintext = surrogate keys, schema tables, envelope fields | Plaintext `seq` on every table | Yes, OQ-2 (but understated, see M-1; scope wider than AD-6 list) |
| 4 | Blind index for "searchable fields (email, client name lookup)", exact match | Blind index on status, unread flag, day bucket, attributes, per-word terms (a term index is a new construct, not an exact match on a field) | **No** (ADR-10 only; no leak analysis, no user sign-off) |
| 5 | "No plaintext business data in any column ... enum-like values encrypted" | Ciphertext length reveals enums and booleans (C-1) | **No** |
| 6 | "surrogate keys, random, **no meaning**" | Nullable FKs, presence of `idem_bidx`, `role_id` carry meaning (M-1) | **No** |
| 7 | "No plaintext ... in any ... log" | Proxy/Tomcat access logs, query strings, path tokens (H-3) | **No** |
| 8 | "store key_version with each ciphertext" | `kek_version` in column blobs goes stale after re-wrap; real key id is `dek_id` (M-9) | **No** |
| 9 | "one CryptoService ... Feature code must not call crypto primitives" | Separate `ObjectCipher`/`BlindIndex`, `app` allowed to import `CryptoService` (L-2) | **No** |
| 10 | "Timestamps that reveal behavior: encrypt" | `day_bidx`, S3 `LastModified`, `refresh_token.seq` (H-1, M-1, M-2) | **No** |
| 11 | "Mail ... keep it minimal and document it" | Documented; transport security undefined (M-7) | Partly |
| 12 | "AI info ... Document what leaves the system" | Documented in §8.1; destination URL is user-controlled and unchecked (H-2) | Partly |

Add OQs for rows 4, 5 to 8, and 10, each with a "needs user yes" marker like OQ-2.

---

## Checked, no finding

- Hibernate SQL/bind logging, `pg_stat_statements`, PG error `DETAIL`: app-side encryption means bind values are ciphertext or HMACs, as long as no native query inlines plaintext and the pinned ArchUnit rule on native queries holds (§5.3).
- JWT claims (`sub`, `perms[]`, `sid`): no business PII. Pin `alg=EdDSA` and `kid` in the resource server config.
- Flyway history: schema metadata only.
- Mailpit exposure in production: not in the production compose.
- Argon2id parameters, EdDSA access tokens, opaque 256-bit hashed refresh tokens, PKCE S256, `state` check, `__Host-` cookies, CSRF on POST, no CDN: adequate.

## Priority order for fixes before story 1.3 (schema)

1. C-1 padding (changes the envelope format; do before any data exists).
2. H-1 drop low-entropy indexes and rework day filter; M-1 `seq` and FK shape; M-9 AAD/header and key-wrap spec (all change the schema or envelope).
3. H-2, H-4, H-5, H-6 (small spec changes before the AI, Upload and Auth stories).
4. H-3 plus M-8 (logging rules and suite scope, before story 1.1 CI).
5. Remaining mediums and lows can ride with their feature stories.
