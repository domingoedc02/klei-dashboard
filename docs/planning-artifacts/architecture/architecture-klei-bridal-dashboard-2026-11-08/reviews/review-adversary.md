# Adversarial review: ARCHITECTURE-SPINE.md (+ docs/architecture.md)

Reviewer stance: two developers (or stories) one level down, each obeying every AD literally, still ship incompatible code. Each hole = pair, AD text both obey, clash, exact fix. Spine wins over companion; where the companion adds a rule the spine lacks, I flag it (spine silent = rule not binding).

## Verdict

REVISE before story breakdown. Layering, crypto envelope and auth flow are sound. Gaps are in (a) the single definition of blind index / codecs, (b) the concurrency model for state that lives in encrypted columns (no CAS possible), (c) DB/S3 and DB/SMTP boundaries, (d) rotation under rolling deploy, (e) ownership of cross-row derived data (terms, notifications, audit). 24 holes below; 5 are build-breaking. Proposed new ADs: AD-18..AD-26 (text given per hole, consolidated in section C).

## A. Spine vs companion contradictions (fix first, cheap)

| # | Spine says | Companion says | Result |
| --- | --- | --- | --- |
| C1 | AD-6: `HMAC(BIDX_KEY, table\|column\|normalize(value))` | §4.2: `"<table>.<column>\|" + normalize(value)` | Separator differs (`\|` vs `.`). Two devs produce different hashes; lookups silently return 0 rows. |
| C2 | AD-3: plaintext is "JSON-free UTF-8 text or raw bytes" | §4.3: `upload_group.attributes_ct` "JSON list", `prefs_ct`, `advanced_ct`; §4.1 booleans/numbers/dates "serialized to text" with no format | Spine forbids what tables require; no canonical codec for Instant/Boolean/number/enum. |
| C3 | AD-10: React calls "one Rust command `api_request`" | §9.5: commands `api_request, sign_in, sign_out, check_update, install_update, save_zip` + `klei-img://` scheme handler that performs HTTP | Second network path; token attach and refresh implemented twice (see H3). |
| C4 | AD-4/AD-16: env vars `KEK_<n>`, `KEK_ACTIVE`, `BIDX_KEY` | §9.2 + spine Config convention: `KLEI_KEK_n`, `KLEI_KEK_ACTIVE`, `KLEI_BIDX_KEY`, plus `KLEI_JWT_KEY` | Infra story writes compose with one set, crypto story binds the other. Boot fails or, worse, falls back silently. `JWT_KEY` is in no AD at all. |
| C5 | AD-4: rotation "re-wrap job rewrites wrapped DEKs only" | §5.4 step 1: "blob carries kek_version" so reads pick the KEK from the blob; AD-3 blob has `kek_version:2` for *column* ciphertext that is encrypted by a DEK | Which KEK version does a column blob name, and is it ever updated? Stale after rewrap (H5). |
| C6 | AD-2: `core` may import only `CryptoService, @Encrypted, BlindIndex, ObjectCipher` | ADR-4: Flyway `JavaMigration`s "call CryptoService through a narrow interface"; §5.3 `@RawCiphertext` repositories, native queries rule | Rule exists only in companion; spine ArchUnit rule has no carve-out. Migration story and rewrap story both violate AD-2 or both invent different exceptions. |
| C7 | AD-9: every endpoint declares a Permission | §7.2: many endpoints "token" or "none"; search "Viewer gets gowns only" | No declared form for "authenticated only" / "public" / "conditional inside handler". ArchUnit test cannot be written without it. |

Fix for C1..C7: spine becomes the only place for the definitions below; companion section cites them by AD number.

## B. Holes

### H1. Blind index has no single definition (BUILD-BREAKING)

Units: Gallery story (filters on `gown_attribute.attr_bidx`) and Taxonomy story (FR-38 "in use" check using `taxonomy_value.attr_bidx`).
Both obey AD-6 "HMAC(BIDX_KEY, table|column|normalize(value))".
Clash: hash input includes table and column, so `gown_attribute.attr_bidx("silhouette:a-line")` != `taxonomy_value.attr_bidx("silhouette:a-line")`. §4.2 lists them as one row serving "in use" checks. The in-use check can never match; a Taxonomy value in use by 40 Gowns is deletable. Also each caller passes literal `table`/`column` strings to `BlindIndex` (AD-2 allows importing `BlindIndex`), so a typo is a silent miss.
More clashes under the same AD:
- Query-side vs write-side: `@BlindIndexed(of="email")` computes in the listener; lookups call `BlindIndex` by hand. Two normalize call sites.
- `normalize` = "NFKC, trim, lowercase": locale for lowercase unspecified (Turkish dotless i), internal whitespace collapse unspecified.
- Term tokenizer unspecified: gown_term builder (Upload story, Gown edit story) vs search (Search story) split on whitespace vs `\p{L}\p{N}+`, punctuation ("A-line", "Chantilly/lace"), min length, stopwords, max terms. "A-line" is one term for one dev, two for the other.
- `day_bidx`: "UTC yyyy-MM-dd" from which clock/field; "Last 7" = today plus 6 or 7 hashes; Dashboard "new this week" (FR-7) vs Gallery filter compute windows differently (A2 admits UTC only).
- Query "lace lace": `HAVING count(DISTINCT term_bidx) = :n` with n=2, distinct=1, returns nothing.
- Any change of tokenizer/normalizer makes every stored index stale; no version, no rebuild command.

Fix, new AD-18 (replace AD-6 first sentence):
> AD-18 Blind index domains. A blind index is `HMAC-SHA-256(BIDX_KEY, "v1|" + domain + "|" + canon(value))`. `domain` is a constant from the closed enum `BidxDomain` in `crypto` (`APP_USER_EMAIL, CLIENT_EMAIL, INQUIRY_STATUS, INQUIRY_UNREAD, ATTR, GOWN_DAY, GOWN_TERM, INQUIRY_TERM, CREDENTIAL, REFRESH, IDEM`); two columns that must be comparable share one domain (`ATTR` serves `gown_attribute.attr_bidx` and `taxonomy_value.attr_bidx`). `canon` = `Normalizer(NFKC)`, collapse whitespace runs to one space, trim, `lowercase(Locale.ROOT)`. Only `BidxDomain` is accepted by `BlindIndex.of(domain, value)`; string table/column arguments do not exist. Tokenizer = one function `Terms.of(text)`: split on `[^\p{L}\p{N}]+`, canon each, drop empty, drop length > 64, dedupe, cap 32 per row; the same function builds terms and parses queries (dedupe before the `count = n` check). Day bucket = `DayBucket.of(Instant)` = UTC `yyyy-MM-dd`; `DayBucket.lastN(n, clock)` = today and the previous n-1 days, used by Gallery and Dashboard alike. The `v1` literal is bumped with any change above and ships with a `ReindexJob` that rebuilds every `*_bidx` and `*_term` table from decrypted values.
Spine AD-6 then drops the formula and the `docs/architecture.md` §4.2 table is the domain registry.

### H2. Atomic state in encrypted columns is impossible; no version column allowed (BUILD-BREAKING)

Units: Auth story (invite/reset consume, 6-digit code attempts, refresh rotation, last-Admin guard) and Inquiry story (stale edit, status).
Both obey AD-5 ("everything else is `_ct`; allowlist: ids, seq, flyway, envelope fields") and AD-3 (random nonce, so the same plaintext encrypts differently every time).
Clash:
- `auth_credential.attempts_ct` is read, decrypted, incremented, re-encrypted. A guesser fires 1000 parallel requests; all read `attempts=0`; 6-digit code brute-forced past the limit. Same for `consumed_at_ct` (two redemptions of one reset link both succeed) and `refresh_token.revoked_ct` (rotation "single use" is a read-then-write; also reuse detection depends on it).
- `UPDATE ... WHERE status_ct = ?` cannot work; no CAS on ciphertext.
- §7.3 lists 409 `conflict` "stale edit" yet there is no plaintext `version`/`updated_at` column permitted, so no mechanism exists. Two PATCH /gowns/{id} = last writer wins and `gown_term` rebuild interleaves (H8).
- "Last Admin cannot be demoted": two Admins demote each other concurrently; each sees 2 Admins; zero remain.
- Role→Permission has no unique key on encrypted `permission_ct`: duplicates possible, and `PUT /admin/roles` as delete-by-value must decrypt.
Fix, new AD-19 (and amend AD-5 allowlist to add `version bigint`):
> AD-19 Concurrency. (1) Every mutable table has plaintext `version bigint` (JPA `@Version`); `PATCH`/`PUT` of an existing row requires `If-Match: <version>`; mismatch = 409 `conflict`. (2) Single-use is expressed by deleting the row: consume = `DELETE ... WHERE id = ?` and success iff 1 row affected. Refresh rotation = delete old row, insert new row in the same `family_id` (plaintext), in one transaction; reuse = delete returned 0 → revoke family by `DELETE WHERE family_id`. (3) Counters (code attempts, rate limits) live in memory (A1) or in a plaintext-allowlisted `smallint`; never inside a `_ct` read-modify-write. (4) Any cross-row invariant (last Admin, Taxonomy delete vs in-use, Client email uniqueness, batch ≤ 200, one live credential per user+kind) takes `SELECT ... FOR UPDATE` on the owning parent row first; the lock owner is named in the story. (5) Sets (role permissions) are replaced whole: delete all children of the role then insert, one transaction, role row locked.

### H3. Two Rust network paths race the rotating refresh token (BUILD-BREAKING)

Units: Rust story A (`api_request`: attach token, refresh on 401) and Rust story B (`klei-img://` handler fetching 48 thumbnails; also `save_zip`, `check_update` use HTTP).
Both obey AD-10 and AD-8 ("Refresh = opaque, rotating, single use"; §6.1 reuse of a spent token revokes the family).
Clash: token expires; Gallery fires 48 image requests plus a list call; each gets 401 and each calls refresh with the same refresh token. First succeeds, the other 48 present a spent token → family revoked → user force-logged-out, plus a spurious security Audit Entry. Happens every 15 minutes.
Fix, amend AD-10:
> The Rust shell has one `HttpClient` module holding the only token state behind a mutex; every outbound call (including the `klei-img` handler and zip export) goes through it. Refresh is single-flight: concurrent 401s await one refresh then retry once. The `klei-img` scheme is the only other webview entry point and is listed in the AD. Backend refresh endpoint is idempotent for 10 s: re-presenting the just-spent token with the same `family_id` returns the same successor (store successor hash in the spent row); beyond 10 s = reuse = revoke family.

### H4. DB rows vs S3 objects: sweep eats live uploads, delete order undefined, object envelope undefined (BUILD-BREAKING)

Units: Upload story (puts objects, then inserts rows; batches stay open for hours) and Ops/cleanup story (§4.1 "nightly sweep removes objects with no stored_object row"). Plus Gown-delete story.
Both obey AD-7 and §4.1.
Clash:
- Sweeper lists bucket at 02:00; an in-flight upload has PUT objects but not committed `stored_object` → live photo deleted (S3 object gone, row committed milliseconds later: permanent data loss, and no DB constraint notices).
- Gown delete: "deletes its object rows and S3 objects in the same service call". Dev A deletes S3 first then commits (rollback leaves rows pointing at nothing); dev B commits then deletes S3 (failure leaves orphans, which is fine). Both match the text.
- Orphan *rows*: `stored_object` has no owner reference; avatar replace (`PUT /me/avatar`), attachment, photo, thumb each own one. Replacing an avatar leaves the old `stored_object` row + object forever; sweep only checks object→row, not row→owner.
- AD-7 gives AAD `bucket|key`; AD-4 says per-object DEK is "wrapped the same way ... AAD = data_key|dek|id". `id` of what? Rewrap job (unwraps with AAD A) vs ObjectCipher (wraps with AAD B) fail each other.
- On-wire object format never specified (is the S3 body the AD-3 envelope with `dek_id` of an object DEK? raw `nonce|ct|tag`?). Export/thumb/download stories each guess. §5.5 says "ObjectCipher streams", AD-7 "single shot".
Fix, new AD-20:
> AD-20 Objects. S3 body = `[version:1][nonce:12][ciphertext+tag]`, single-shot AES-256-GCM, AAD `"obj|" + bucket + "|" + objectId`; the DEK is only in `stored_object`, wrapped with AAD `"stored_object|dek|" + objectId`; the tenant DEK is wrapped with AAD `"data_key|dek|" + dataKeyId`. Write order: PUT object → commit row; DELETE order: commit row delete → afterCommit DELETE object (failures retried by the sweep). Never delete S3 inside a transaction that can still roll back. Sweeper deletes only objects older than 24 h by S3 `LastModified` with no row, and only rows older than 24 h with no referencing owner (owner FKs: `photo.original_object_id`, `photo.thumb_object_id`, `attachment.object_id`, `app_user.avatar_object_id`; one owner per object, never shared; replacing an owner deletes the old object per the delete order). Cascade deletes of entities are done by the service, not DB `ON DELETE CASCADE`, because DB cascade cannot reach S3 or `stored_object` (it is the referenced side).

### H5. Key rotation vs rolling deploy and vs stale blob `kek_version` (BUILD-BREAKING)

Units: Ops story (Dokploy deploy: "old container keeps serving until the new one is healthy", §9.3) and Crypto story (RewrapJob, startup check).
Both obey AD-4 steps (add KEK_2, set active, redeploy, run job, remove old).
Clash:
- Redeploy with `KEK_ACTIVE=2`: new container up, old container (has only KEK_1) is still serving. Old container wraps new `stored_object` DEKs with v1 and cannot read v2-wrapped rows → `crypto_failure` 500s during the overlap. Job reports zero at old version, operator removes KEK_1, but the old container's late writes at v1 remain → next boot fails "row references missing KEK version".
- Two backend instances at first boot on an empty DB each create a tenant DEK (A1 "one instance" is false during overlap); `DekStore` "unwraps once and caches" has no behaviour for an unknown `dek_id` seen in a blob.
- "A counter in data_key" checked at startup: if every write increments it, every write contends one row; if estimated, two impls disagree. Only counted at startup = useless.
- C5: column blobs name `kek_version` but column data is protected by the DEK; after rewrap the field is stale. A dev that picks the KEK from the blob breaks after KEK_1 removal.
- Rewrap through an entity load would fire PostLoad/PreUpdate and re-encrypt every `_ct` field with fresh nonces; "does not touch *_ct" depends on remembering `@RawCiphertext` (companion only).
Fix, new AD-21 and amend AD-3/AD-4:
> AD-21 Rotation. Rotation is three deploys: (1) add `KEK_n+1` with `KEK_ACTIVE` unchanged (every instance can read both), (2) flip `KEK_ACTIVE`, (3) run rewrap, wait for zero, remove old KEK in a fourth deploy. Backend refuses to run `rewrap` unless `KEK_ACTIVE` equals the highest configured version. Column blob byte `kek_version` is informational and never used for key choice: decrypt resolves `dek_id` → `data_key` row → its `kek_version`; unknown `dek_id` triggers one reload from `data_key`, then fails. Tenant DEK creation uses `INSERT ... ON CONFLICT DO NOTHING` on a plaintext `slot = 1` unique column, then selects; DEK replacement is Deferred (no counter) until a volume estimate shows need. RewrapJob and leak tests use only repositories marked `@RawCiphertext` with native SQL, enforced by ArchUnit in the spine.

### H6. Hibernate listener vs bulk/native/projection queries (spine silent)

Units: Inbox story (mark-all-read, bulk status) and Gallery story (48-row list).
Both obey AD-2/AD-5 and "no manual `encrypt()` calls in services".
Clash:
- Bulk JPQL/native `UPDATE inquiry SET unread_bidx = :h` bypasses the listener: `unread_ct`/`status_ct` (if exist) and `*_bidx` diverge; `POST /notifications/read` and `DELETE /gowns` have the same shape. The only guard is the companion's §5.3 and applies to native queries on `_ct` only; JPQL bulk and `select new` projections are not covered.
- Projections return raw bytes (§5.3): list endpoints either load full entities (decrypt description/body/preview for 48 rows needlessly) or call `CryptoService.decrypt` by hand in services (contradicts the convention).
- PreUpdate re-encrypts only dirty fields or every field? A naive listener rewrites all `_ct` on every flush (write amplification, `version` churn, audit trigger irrelevance).
- `status_bidx` and `unread_bidx` are derived from `status_ct` / a flag; `inquiry.unread` has no `_ct` source column in §4.3 (`unread_bidx` only), so `@BlindIndexed(of=...)` has nothing to derive from.
Fix, new AD-22:
> AD-22 Persistence discipline. Entities with `@Encrypted` fields are written only via the entity API (`save`, dirty checking). JPQL/native `UPDATE`/`INSERT` on any table containing `_ct` or `_bidx` columns is forbidden outside `@RawCiphertext` repositories (ArchUnit, spine-level). `DELETE` by id/ids is allowed. Listener re-encrypts a field only when its plaintext differs from the loaded value. Every `_bidx` has a source `@Encrypted` field in the same entity (add `unread_ct`). List endpoints read through `*View` entities (read-only `@Immutable` entity mapped to the same table exposing only the needed `@Encrypted` fields), never `select new`.

### H7. Audit entry has no single writer

Units: Auth story (login/refresh-reuse/lockout events), Admin story (staff/role/AI/taxonomy), Key-rotation story (`key_rotation` entry), Upload/Gown stories (delete, export).
Obey FR-40 and AD-5; the spine says nothing on audit.
Clash:
- Dev A writes audit in the same transaction as the action; dev B writes after the action in a service wrapper, so a failed/denied action (403, wrong password, rejected reuse) either rolls its audit back with the business tx, or is never written.
- `action_ct` vocabulary (`user.invited` vs `invite_sent`) and `detail_ct` shape differ per story; Audit screen needs one display form.
- `ip_ct` (see H17).
- `audit_entry` seq assigned at insert; concurrent writers commit out of order, so seq order != causal order; `ts_ct` and seq disagree on screen.
- Hibernate entity for the table must be `@Immutable`; a dirty-check UPDATE hits the append-only trigger and aborts the business tx.
Fix, new AD-23:
> AD-23 Audit. One `AuditPort.record(AuditAction, actorId, detail: AuditDetail)` in `core`; `AuditAction` is a closed enum, `AuditDetail` a sealed class per action holding ids and counts only (AD-14). Success events: written inside the business transaction (so both or neither). Denial/security events (login failure, lockout, refresh reuse, 403 on admin endpoints): written with `REQUIRES_NEW`. `AuditEntry` entity is `@Immutable`. Screen order is `seq DESC` and the displayed time is `ts_ct`; nothing else.

### H8. Two owners of derived term and attribute data

Units: Gown-edit story (PATCH name/attributes), Upload-save story (creates gown), Taxonomy-rename story (FR-38), Client-edit story (PATCH /clients/{id}), Inquiry-intake story.
Obey §4.3 "gown_term rebuilt in the same transaction whenever name or attributes change" and AD-6.
Clash:
- Each story rebuilds terms inline with its own tokenizer (H1) or forgets (Upload-save, Taxonomy rename). Nobody owns `inquiry_term` at all: Client name change must rebuild terms for all that Client's Inquiries; `subject_ct` for `inquiry_term` is created at intake only.
- Concurrent PATCH: delete-all/insert-all interleaves, duplicates (no unique `(gown_id, term_bidx)`, which is possible since it is a plaintext FK + bidx) or loses terms.
- Taxonomy rename: `gown_attribute.value_ct` and `attr_bidx` are copies of the Taxonomy value, so a rename must rewrite every gown_attribute and gown_term; nobody is told.
- Gown/inquiry delete leaves terms (no DB cascade defined) and search returns ids whose decrypt/join then yields null names.
Fix, amend §4.3 and new AD-24:
> AD-24 Derived rows. `gown_term`/`inquiry_term` are written only by `TermIndexer` (in `core`), invoked from a JPA `@PostPersist/@PostUpdate` hook on `Gown`, `Client` (fans out to its Inquiries) and `Inquiry`, in the owning transaction, replacing the set (unique `(owner_id, term_bidx)`). `gown_attribute` references `taxonomy_value_id` (FK, `ON DELETE RESTRICT`) and stores no value copy; type/value are decrypted from `taxonomy_value`; `attr_bidx` lives only on `taxonomy_value` and Gallery filters join through the FK. In-use check = the FK. Term rows are `ON DELETE CASCADE` from their owner (no S3 involved, so DB cascade is fine here).

### H9. Seq assignment, keyset direction and "since" polling

Units: Inbox/Notification story (polls every 30 s, ADR-6) and Messages/Audit story (thread, oldest first).
Obey AD-6 ("monotonic bigint seq"), AD-11 ("keyset-paged by seq (`limit` ≤ 100, `after`)"), §4.3 "inquiry seq bumped on every new Message".
Clash:
- `after` means `seq < :after` (Gallery, DESC) in one story and `seq > :after` (message thread ASC) in another; same param name, opposite meaning.
- Sequences are non-transactional and commit order differs from seq order. Polling with `after=<last seen seq>` ("what is new") misses a row with a lower seq committed later → notification/inquiry silently never appears.
- "monotonic" is not true for what the spec calls monotonic: gaps and out-of-order commits.
- Who assigns the bump: DB trigger, listener, or service `UPDATE inquiry SET seq = nextval`? The last is a bulk update that breaks H6; the first duplicates the sequence per table; "per-table sequence" conflicts with bumping an existing row's seq (same sequence reused or a new one?).
- Concurrent reply and inbound message both bump; status/unread write order undefined (H10).
Fix, amend AD-11 and Conventions:
> Lists are newest first (`seq DESC`) unless the endpoint table says otherwise; cursor param is `before=<seq>` (rows with `seq < before`); ascending lists (message thread) use `after=<seq>`. Page 1 is always refetched whole; a client never uses a seq as a "changes since" watermark. `seq` default is `nextval('<table>_seq')`; bumping an Inquiry assigns `nextval('inquiry_seq')` from the entity's `@PreUpdate` when a Message is added (never a bulk update), in the same transaction as the Message insert.

### H10. Inquiry status/unread: three sources of truth, no state machine

Units: Dashboard story (FR-7 count), Sidebar badge story, Reply story, Intake story.
Obey A3 ("Unread means Status New"), §4.2 (`status_bidx`, `unread_bidx` both), §4.4 (badge = status new AND unread true).
Clash: Dashboard uses `unread_bidx`, badge uses both, a third dev uses `status_bidx` alone per A3. Reply and inbound race: reply sets Replied after SMTP success (H12) while inbound sets New+unread=1; last writer wins with no version (H2); inquiry shows Replied with an unread inbound message hidden.
Fix, new AD-25 (and delete `unread_bidx`, or delete A3):
> AD-25 Inquiry state. One `InquiryStateService` owns transitions: `NEW(unread) → REPLIED → CLOSED`, inbound message on any state → `NEW(unread)`, open of a `NEW` inquiry by a user with PERM_REPLY → `NEW(read)`. Counts are defined once: Dashboard = Sidebar = `status=NEW AND unread`. All transitions run with `SELECT ... FOR UPDATE` on the inquiry row (H2) and compare `version`.

### H11. Notification writers and shape

Units: Intake, Upload (batch finished), Staff (invite accepted) stories.
Obey §4.3 `notification(type_ct, title_ct, target_ct)`.
Clash: `type_ct` strings and `target_ct` format (route? `inquiry:{id}`? JSON?) differ; fan-out recipient set (all PERM_REPLY users honoring `prefs_ct` toggles) is computed by each in its own way, some inside the business tx, some after commit (notification for a rolled-back inquiry). Purge/age-out of old notifications impossible without plaintext time (see H14).
Fix: add to AD-23's style: `NotificationPort.publish(NotificationType, TargetRef, recipients: RecipientRule)`; `NotificationType` closed enum; `TargetRef` sealed (`InquiryRef(id)`, `GownRef(id)`, `BatchRef(id)`) serialized by one codec; delivered afterCommit via `TransactionalEventListener`.

### H12. Reply: DB row vs SMTP vs retry vs draft (mail boundary)

Units: Reply story and Reply-retry story; Draft autosave story.
Obey §7.1 (Idempotency-Key), §8.2 ("SMTP failure leaves Message in mail_state=failed, status unchanged, Retry"), `message.idem_bidx unique`.
Clash:
- Ordering: dev A sends SMTP inside the DB tx (SMTP ok, commit fails → client retried → duplicate email); dev B commits then sends (crash between → Message stuck `pending`; retry with same key returns the first result which says pending forever; no worker).
- "Retry": new `Idempotency-Key` creates a second Message row in the thread (failed + new); no endpoint exists to resend an existing Message.
- Concurrent duplicate while the first is in flight hits the unique index → 500 or 409, unspecified; idem key scope global rather than per user.
- Draft: autosave PUT in flight after Send's DELETE resurrects the sent text as a Draft. Two Drafts stories (Inquiry-switch autosave, send) disagree.
- Attachments: stored before the Message exists (S3 first); no rule for abandoned attachments (H4).
Fix, new AD-26:
> AD-26 Outbound mail. Reply = tx 1: insert Message `mail_state=pending` (+ attachments, delete Draft, state transition deferred) and commit; then a `MailOutbox` worker (same JVM, polling `pending`) sends via `MailPort`, then tx 2 sets `sent`/`failed` and performs the Inquiry transition. Retry = `POST /messages/{id}/resend` on a `failed` Message, same row. Idempotency scope = `(author_user_id, key)` hashed under `BidxDomain.IDEM`; a concurrent duplicate gets 409 `in_progress` with `Retry-After`. Draft `PUT` requires `If-Match`; a Draft whose `inquiry` has a newer Message from that author than the Draft's `baseVersion` is rejected 409. No external call (SMTP, AI Provider, S3) runs while a DB transaction is open.

### H13. AI calls inside transactions, batch processing state, batch cap

Units: Upload-AI story and Upload-review story.
Obey AD-12/AD-13 and §4.3 `upload_batch.phase_ct`.
Clash: calls to the AI Provider (60 s timeout, one retry, per photo) made inside the batch tx hold DB connections; `ai_usage` written in the same tx rolls back on failure so failed egress is "unlogged" (AD-12 "Prevents unlogged egress"). `phase_ct`/`progress_ct` updated by the worker while the user polls: read-modify-write on encrypted column from two threads (H2). Crash mid-processing leaves `processing` forever; no resume/timeout owner. `POST /uploads/{id}/photos` concurrent: two requests each see 199 and add the 200th and 201st. One active batch per user (`GET /uploads/current`) not enforced (double `POST /uploads`). Embedding rows retained after `save` though AD-13 says batch-local.
Fix: extend AD-26's last sentence to AI; `ai_usage` is written `REQUIRES_NEW` before returning to the caller (AD-23 pattern); batch phase transitions only by `UploadBatchService` under `FOR UPDATE` on the batch row; worker updates progress in memory (polled endpoint reads memory then DB); on boot, batches stuck in `processing` older than N minutes become `error`; one batch per `user_id` via plaintext unique index; delete `embedding` rows in `save` (AD-13 text: "vectors are deleted when the batch is saved or discarded").

### H14. Time is encrypted, so nothing can expire (retention and sweeps)

Units: Auth story (expired credentials/refresh tokens), Notification story, Ops story (sweeps).
Obey AD-5: "Every time value is `*_at_ct`".
Clash: `expires_at_ct`, `created_at_ct` cannot drive `DELETE ... WHERE expires < now()`. One dev writes a decrypt-everything scan; one never purges (`refresh_token` and `auth_credential` grow forever; user-visible effect none until performance dies); one adds a plaintext `expires_at` (fails the schema test, or the schema test gets edited).
Fix: AD-19 clause: expiry-bearing single-use rows are deleted on use/rotation/logout and by `family_id`; the remaining purge runs as a bounded decrypt-scan job (`PurgeJob`, page by `seq`) with a spine-level statement of cost. Check codes against `expires_at_ct` in memory after the lookup.

### H15. Canonical codec for encrypted scalars and JSON

Units: any two stories reading/writing the same `_ct` field (Auth writes `expires_at_ct`, a Cleanup story reads it; Settings writes `prefs_ct`, Dashboard reads `date format`).
Obey §4.1 ("serialized to text before encryption").
Clash: Instant as ISO-8601 vs epoch millis; Boolean `true`/`1`; number locale; enum `Name` vs `NAME`; `prefs_ct` and `upload_group.attributes_ct` JSON shape (`[{"type","value"}]` vs `{"silhouette":["A-line"]}`); `advanced_ct` free-form; JSON key casing; schema evolution without a version.
Fix (amend AD-3, resolving C2):
> Plaintext is UTF-8. Scalars: Instant = ISO-8601 UTC with millis and `Z`; Boolean = `1`/`0`; integers/decimals = invariant-locale ASCII; enums = lowercase `snake_case`. Structured values = JSON `camelCase` in a `@Serializable` class in `core` named after the column, with a top-level `v` integer; no `Map<String,Any>` columns. One `FieldCodec` in `crypto` does all of this; ad-hoc `toString()` forbidden.

### H16. Singleton rows and bootstrap races

Units: Settings story (`ai_setting`, `workspace` "one row") and Bootstrap story.
Obey §4.3.
Clash: two concurrent first `PUT /admin/ai` insert two rows (no key to unique on, since rows hold only ciphertext); readers take `findAll().first()` vs `findTop...` and see different rows. `workspace` not in the ER diagram. AI settings cache cleared per instance only.
Fix: singleton table id is the constant UUID `00000000-0000-0000-0000-000000000001`, created by a Flyway migration with empty fields; writes are `UPDATE` with `If-Match` (H2). Same for `data_key slot=1` (H5).

### H17. Client IP and rate limiting behind the proxy

Units: Auth Web story (login rate limit 20/IP) and Audit story (`ip_ct`).
Obey §6.1 rate limit, `audit_entry.ip_ct`.
Clash: remote address behind Dokploy's proxy is always the proxy's: dev A uses `request.remoteAddr` (everyone shares one bucket, 20 failures lock the whole studio out), dev B trusts `X-Forwarded-For` (attacker spoofs to bypass limit). Also two connectors/domains.
Fix: add to AD-1: `server.forward-headers-strategy=native` with `server.tomcat.remoteip.internal-proxies` set to the compose network; a single `ClientIp` resolver used by rate limiter and audit; `X-Forwarded-For` otherwise ignored.

### H18. Auth token contents and the "perms at sign-in" ambiguity

Units: Token endpoint story and Refresh story.
Obey AD-9 ("Role→Permission loaded at sign-in into the token").
Clash: §6.1 says refresh re-reads the matrix; AD-9 says sign-in. Dev A copies `perms[]` from the old JWT on refresh; dev B reloads. Deleted/deactivated user: refresh must check `app_user` status and delete the family, but AD-9 and AD-8 do not say. Integration token for `POST /inquiries` (FR-24, §7.2) appears nowhere in AD-8/AD-9 or the data model; Auth and Intake stories each invent it (static secret in env? DB token?).
Fix: amend AD-8: "Refresh re-reads role permissions and user status; a missing/deactivated user deletes the family and returns 401. Deleting a user or changing a role deletes that user's refresh family." Add an explicit `integration_token` (domain `CREDENTIAL`, hash only, shown once, authority `PERM_INTAKE`) to the data model, or move FR-24 out of MVP.

### H19. Permission declaration forms

Units: any two controller stories.
Obey AD-9 ("every endpoint declares a Permission").
Clash: "token only" → `@PreAuthorize("isAuthenticated()")` vs none-and-rely-on-filter vs `PERM_AUTHENTICATED`; Search conditional ("Viewer gets gowns only") implemented as programmatic check in handler vs two endpoints; reading Inquiries needs `PERM_REPLY` (semantic mismatch invites a new `PERM_VIEW_INQUIRIES` in one story); `PERM_KEY_ROTATE` outside the editable matrix.
Fix: amend AD-9: the permission list is closed (the 9 in §6.3); annotations allowed: `@PreAuthorize("hasAuthority('PERM_X')")`, `@Authenticated` (meta-annotation for `isAuthenticated()`), `@Public` (allowlist of exactly `/health`, `/auth/token`, `/auth/refresh`); conditional content is a second service call guarded by `hasAuthority`, never inline role logic; ArchUnit checks all three forms.

### H20. Flyway data migrations vs crypto

Units: Migration story (forward-only; add an encrypted column to populated tables), Crypto story (first DEK on empty DB).
Obey AD-16 "Flyway runs at startup", ADR-4 "JavaMigration calls CryptoService through a narrow interface".
Clash: Flyway runs before the Spring crypto beans/`DekStore` exist, and `data_key` is empty on a fresh DB; a migration adding NOT NULL `_ct` with a value fails. AAD needs row ids; migration re-encrypts through a third path outside the listener. AD-2's import rule conflicts.
Fix: amend AD-2/ADR-4: crypto beans initialize before Flyway (Spring `FlywayMigrationInitializer` depends on `DekStore`; `DekStore` uses a plain JDBC `DataSource` with its own `CREATE TABLE IF NOT EXISTS data_key` bootstrap in V1); migrations needing encryption use `MigrationCrypto` (a spine-named narrow interface in `crypto`) and a new column is first added nullable, filled, then constrained in a later migration.

### H21. Env var names and secret classes (C4)

Fix: one table in the spine: `KLEI_KEK_<n>`, `KLEI_KEK_ACTIVE`, `KLEI_BIDX_KEY`, `KLEI_JWT_KEY` (with a note that JWT key rotation signs out everyone; `kid` support is single-key until needed). Delete the bare names from AD-4/AD-16.

### H22. Shared JSON shapes across API/UI (types are generated, but semantics are not)

Units: Gallery UI story and Gown API story.
Obey AD-11.
Clash: `total` is optional "where the UI shows it" (companion) so one list returns it, another doesn't; `next` is `<seq|null>` raw; `fields[].code` vocabulary undefined; `confidence` encrypted as text: float 0..1 vs integer percent; image sizes `size=thumb|full` string vs enum. OpenAPI drift test cannot catch semantic disagreements.
Fix: amend AD-11: `ListResponse<T> = {items, next, total?}` as one generated schema; `total` returned only when `?total=true`; `confidence` is a decimal 0..1 with 3 places; a `docs/api/conventions` table lists enum value sets; error `code` values are a Kotlin enum emitted into OpenAPI.

### H23. Export and zip memory/authority path

Units: Gallery export story (Backend `POST /gowns/export` returns "decrypted photo bytes list"), Rust `save_zip`.
Obey AD-10/A6.
Clash: backend returns N×25 MB in one buffer; or streams multipart; Rust builds zip in memory; "no persistent plaintext cache on disk" vs writing a zip to the user's chosen path (fine) but via temp file (not fine). Authorization per gown id unspecified for a mixed list (some ids deleted/unauthorized).
Fix: one rule: export is `POST /gowns/export` returning a streamed `multipart/mixed` with per-part ids; Rust streams parts directly into the zip file at the user-chosen path (no temp file); missing ids are reported in a trailing part.

### H24. Deploy overlap vs in-memory state (A1)

Units: Auth story (in-memory auth codes, sessions, rate counters), Ops (Dokploy zero-downtime).
Obey A1 "one instance" and §9.3 "old container serves until new one healthy".
Clash: code issued by the old container is redeemed at the new one (60 s window) → sign-in fails during deploy; Auth Web session lost; rate counters reset.
Fix: state in AD-16 that deploy is stop-then-start (Dokploy `recreate`), or that A1 state is moved to DB (single-use delete per H2). Pick one; stop-then-start is cheapest and also fixes H5 overlap.

## C. Consolidated new/changed AD text (paste order)

- AD-3: replace "JSON-free" with the H15 codec rule; remove `kek_version` from the column blob or declare it informational (H5).
- AD-4: env names per H21; rotation per AD-21; AAD strings per AD-20.
- AD-5: add `version bigint` and `slot` to the allowlist; add `unread_ct`.
- AD-6: reference AD-18 for formula, domains, tokenizer, day bucket, reindex.
- AD-10: single `HttpClient`, single-flight refresh, `klei-img` listed.
- AD-11: list direction and cursor names, `If-Match`, `ListResponse`.
- AD-19 Concurrency; AD-20 Objects; AD-21 Rotation; AD-22 Persistence discipline; AD-23 Audit; AD-24 Derived rows; AD-25 Inquiry state; AD-26 Outbound mail and no external call in a transaction.
- AD-1: ClientIp, deploy mode (H17, H24). AD-8/9: H18, H19.

## D. Priority (what blocks story writing)

1. H1 blind index definition (every searchable story depends on it).
2. H2/AD-19 (Auth, Inquiry, Settings stories all need a concurrency primitive).
3. H3 refresh single-flight (cross-story Rust).
4. H4/AD-20 + H5/AD-21 (storage and rotation formats must exist before Upload story and 1.3).
5. H12/AD-26 and H7/AD-23 (mail and audit writers are cross-cutting).
Then C1..C7 cleanup, H6, H8-H11, H13-H24.

Not checked: PRD/UX files (not read; FR numbering taken from spine/companion), Rust crate behaviour of `keyring` on Linux without a keystore, Hibernate 7.4 event-listener ability to mutate `state[]` in PreInsert (story 1.3 spike).
