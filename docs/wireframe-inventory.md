# Wireframe Inventory: Klei Bridal Dashboard

Source (READ-ONLY, never modified): `/Users/ej/Library/Application Support/Open Design/namespaces/release-stable/data/projects/98402068-55fa-4114-a99b-5b49051d7af2`
Form: vanilla-JS clickable prototype, desktop 1440x900. Original design brief is in `.file-versions/*/manifest.json` (4 versions: v1 full brief, v2 manual edit, v3 "fix this in the bottom", v4 "Add the AI Assistant button ... drawer from the right ... AI Chat").

> **Note 2026-11-10 (course correction, `docs/planning-artifacts/sprint-change-proposal-2026-11-10.md`).** This inventory describes the prototype and stays unchanged below. The prototype at `prototype/v0.1.0` now wins over `docs/ux-spec.md` unless the user says otherwise, so the 2FA card (S1), the away message and closure schedule (S2), and email toggles plus digest (S4) listed here are in scope again (PRD FR-44, FR-32, FR-34). Differences kept on purpose: no "appointments today" suffix on the Dashboard greeting, photo cap stays 200 per batch (user decision 2026-11-10; PRD OQ 14), UI word "Customer" for the data model's `client`, focus ring `#0063bf` and meta text `#716c66`. The full screen-by-screen gap table is the appendix of the proposal.

## Assumptions
- Product = internal staff dashboard for one bridal studio ("Klei Bridal"). Derived from v1 brief: "Staff upload gown photos. AI groups images of the same gown, tags attributes, writes a description. Staff also manage website inquiries and admin settings."
- Seed data, canned AI replies and timings in the prototype are mocks. Only structure and fields are requirements.
- Wireframe state toggles (Default/Loading/Empty/Error, "View as Staff/Admin") are prototype tooling, not product features.
- Prototype tokens (Notion-like: `--accent:#0075de`, Inter, radii 4/8/12, 8px scale) are the design baseline for the UX step.

## 1. Screen list

| # | Route | Screen | States in wireframe | Role |
|---|---|---|---|---|
| A1 | `auth/login` | Sign in (email, password, "Keep me signed in", forgot link, accept-invite link) | default, error (bad creds), loading | public |
| A2 | `auth/invite` | Accept invite (email read-only, full name, password + 4-bar strength, confirm) | default, error (link expired), loading | public |
| A3 | `auth/verify` | Verify email: 6-digit code OR "link sent" mode, resend, 30-min expiry | default, error (bad/expired code), loading, link-sent, resent | public |
| A4 | `auth/forgot` | Request reset link (anti-enumeration copy), "sent" confirmation | default, error (send failed), loading, sent | public |
| A5 | `auth/reset` | New password + confirm + strength | default, error (link expired), loading | public |
| D1 | `dashboard` | Greeting and date line, Upload photos, four stat cards (total gowns, unread inquiries, photos this month, avg. reply time), widgets: recent uploads, AI processing status, unread inquiries (Story 11.4) | default, loading, empty | all |
| U1 | `upload` | AI Upload: drag-drop zone, processing (4 steps), review (banner, group list with confidence bar and pill, editor with Rewrite; edits staged until Confirm and save; Undo; leave guard), discard batch | empty, processing, review, error | Admin, Staff |
| G1 | `gallery` | Folder grid (4-up mosaic, "New" pill, checkbox select), filters Silhouette/Fabric/Date, fixed sort "Latest upload first", bulk Download .zip / Delete | default, loading (skeleton), empty, no-match-filter | all |
| G2 | `gallery` (viewer) | Gown viewer: photo stage + thumbs, details panel, description. Actions: Edit (dialog), Download .zip, Copy description, Delete folder (confirm) | default | all (mutations per permissions) |
| I1 | `inquiries` | Email-client layout: inbox list with filter chips All/New/Replied/Closed, thread, composer | default, loading, empty | Admin, Staff |
| I2 | `inquiries/profile` | Client profile (customer record) | default | Admin, Staff |
| S1 | `settings` > Profile | Avatar, name, email, password, 2FA (authenticator app, on/off) | default, error | all |
| S2 | `settings` > Signature | Reply signature (sign-off, name, title, phone), live preview. Admin-only: away message + closure schedule (once / weekly / daily) | default, error | all; away = Admin |
| S3 | `settings` > Preferences | Language, timezone, date format, start page (`prefs.start`) | default | all |
| S4 | `settings` > Notifications | Email + in-app per event (new inquiry, AI finished, team activity), digest frequency (Real-time/Hourly/Daily/Weekly/Never) | default | all |
| S5 | `settings` > Admin > Staff | Table: add/invite, edit, resend invite, delete (confirm) | default, empty | Admin |
| S6 | `settings` > Admin > Roles & permissions | Matrix 8 perms x Admin/Staff/Viewer; Admin column locked | default | Admin |
| S7 | `settings` > Admin > AI settings | Provider (preset OpenAI/OpenRouter/Groq/Ollama/Custom, base URL, API key, org, chat model, vision model, temperature, max tokens), Test connection, grouping sensitivity (1-5), description tone (Warm/Editorial/...), tag taxonomy editor, model toggle | untested/testing/ok/fail | Admin |
| S8 | `settings` > Admin > Audit log | Table: timestamp, actor, action, IP | default | Admin |
| X1 | global | AI Assistant right drawer (chat): greeting, 3 suggestion chips, new chat, close, Enter-to-send | idle, busy (typing dots) | Admin, Staff |
| X2 | global | Topbar: search popover (gowns + inquiries, max 6 hits, no-result empty), notifications menu (clear all, empty), profile menu | default, empty | all |
| X3 | global | Dialogs (`<dialog>`), toasts, Notion-style line-art empty states (6 PNGs in `assets/empty/`) | n/a | all |
| X4 | Inquiries I1 | In-thread AI Assistant panel (from screenshot + v1 brief): actions Draft reply / Summarize / Suggest gowns / (Simulate error), tone chips Warm/Formal/Concise/Playful. Copy: "AI reads this thread only and never sends anything without you." Not present in current JS. | see screenshots | Admin, Staff |

## 2. Navigation map
- Sidebar: Dashboard, AI Upload, Gallery, Inquiries (blue "N new" count pill), Settings. The prototype's "AI credits 640 / 1,000" meter is not built (open question 8 below; no credits concept in the PRD).
- Topbar: search | AI Assistant button | notification bell (dot) | profile menu (Profile settings, prototype role toggle, Sign out).
- Auth: Login -> (success) `prefs.start || dashboard`. Login -> Forgot -> Reset -> Login. Login -> Invite -> Verify -> start page.
- Notification links: new inquiry -> Inquiries; AI finished -> Upload; invite accepted -> Settings.
- Search hit -> Gallery (opens viewer via `pendingOpen`) or Inquiries (opens thread).
- Dashboard widgets -> Gallery / Inquiries / Upload.
- Upload save -> Gallery (new folders first, only newest marked "New").
- Inquiry thread -> client profile (I2) via customer link.
- Admin tab hidden for non-Admin.

## 3. Roles and permissions (from `K.D.perms`)

| Permission | Admin | Staff | Viewer |
|---|---|---|---|
| Upload images | Y | Y | N |
| Edit gown details | Y | Y | N |
| Delete gown folders | Y | N | N |
| Reply to inquiries | Y | Y | N |
| Close inquiries | Y | Y | N |
| Manage staff | Y | N | N |
| Change AI settings | Y | N | N |
| View audit log | Y | N | N |

Permission edits are toggles; Admin column locked; "Changes apply next sign-in".
Gap: Viewer is in the matrix but no Viewer-specific UI shown. Staff vs Admin views only.

## 4. Data entities per screen

| Entity | Fields (wireframe) | Screens | Sensitivity |
|---|---|---|---|
| User/Staff | id, name, email, role (Admin/Staff/Viewer), status (Active/Invited), last active, avatar, password, 2FA flag/secret, prefs (lang, tz, date fmt, start), notification prefs, signature (on, sign-off, name, title, phone, away flag/message, closure schedule) | A1-A5, S1-S6 | PII; secrets |
| Invitation | email, role, inviter, token, expiry | A2, S5 | token secret |
| Email verification / reset token | code or link token, 30-min expiry, resend | A3-A5 | secret |
| Gown (folder) | id, name, silhouette[], fabric[], neckline[], sleeve[], train[], description, photo count, date added, "New" flag, AI confidence | G1, G2, U1, D1, X2 | business data; encrypt |
| Photo | gown id, order, binary image | G2, U1 | object storage, client-side encrypted |
| Upload batch / group | batch status, steps, N photos, groups[] with images, auto-name, tags, description, confidence | U1 | transient then promoted |
| Tag taxonomy | Silhouette A-line/Mermaid/Ball gown; Fabric Mikado/Tulle/Lace; Neckline Sweetheart/V-neck/Off-shoulder/Bateau/Square; Sleeve Strapless/Cap/Long/Sheer long; Train Sweep/Chapel/Cathedral/None (admin-editable) | S7, U1, G1, G2 | config |
| Inquiry | id, client name, client email, subject, preview, received time, status New/Replied/Closed, unread, body[], replies[] (html, sig, files), draft, attachments | I1, D1, X2, X4 | PII, free text |
| Customer | id, name, email, phone, city, wedding date, source (Instagram/Friend referral/Google/Website/Pinterest), since, note | I2 | PII |
| Notification | title, time, target route, unread | X2 | low |
| Audit entry | timestamp, actor, action text, IP | S8 | PII-ish (IP, actor) |
| Role/permission matrix | permission x role boolean | S6 | config |
| AI provider settings | preset, base URL, API key, org, chat model, vision model, temperature, max tokens, sensitivity, tone, model toggle, connection status | S7 | secret (key) |
| AI conversation | msgs[] (user/ai), draft | X1, X4 | PII (may quote inquiries) |
| AI usage / credits | used / quota (640/1000) | sidebar | usage log; encrypt per brief |
| Closure schedule / away message | mode, dates/days/hours, message | S2 | low |

## 5. Flows (clickable in wireframe)
1. **Onboard**: admin invites (S5) -> email -> A2 set name/password -> A3 verify code/link -> app.
2. **Sign in / recover**: A1; A4 neutral "If an account exists..." message; A5 reset, link expires 30 min.
3. **AI upload**: drop N images -> processing (4 steps: reading, grouping same gown, tagging silhouette/fabric/neckline, writing descriptions) -> review groups (confidence High >=90, Medium >=80, else "Low - check"; editable name/tags (combobox)/description; move image, split, merge, discard) -> Save N gowns -> gallery; Discard batch (confirm).
4. **Gallery**: filter (Silhouette/Fabric/Date) -> open folder -> edit (name, 5 tag groups, description) / zip / copy description / delete; bulk select -> zip or delete.
5. **Inquiry handling**: list (filter chips) -> open (marks read) -> read thread -> compose rich-text reply (B/I/U/lists/link, attachments, signature auto-append, auto "Saved as draft", Discard, Send) -> status Replied; manual status select; Close inquiry; closed threads show "reopen to reply".
6. **AI assistance**: global drawer chat (summarize new inquiries, draft reply, suggest gowns) and in-thread panel (Draft reply / Summarize / Suggest gowns + tone).
7. **Admin**: staff CRUD + resend invite; permissions matrix; AI provider config + Test connection; grouping sensitivity; description tone; taxonomy; audit log; closure schedule/away message; admin 2FA requirement (audit shows "Enabled two-factor requirement for admins").
8. **Search**: global search over gowns + inquiries.

## 6. Mock behaviours to replace (real implementation)
| Wireframe mock | Real requirement |
|---|---|
| Seed gallery/inquiries/customers/staff in `data.js` | Backend persistence (all encrypted at rest) |
| `setTimeout` AI steps and canned replies | Backend AI pipeline: vision tagging + grouping + descriptions; LLM chat |
| Client-side store-only ZIP | Zip after decrypt (Tauri/backend); photos are client-side encrypted in MinIO |
| Test connection stub (key length >= 8 = ok) | Server-side call to provider `/models`, never from UI |
| Role toggle in profile menu | Real RBAC from session |
| Inquiry arrival, "Reply sent" | Inbound: website form (per notif copy "When a client submits the website form"); outbound: SMTP |
| `contenteditable` + `execCommand` editor | Sanitized rich-text (allow-list B/I/U/STRONG/EM/UL/OL/LI/A/BR/DIV) |
| Dashboard "128 gowns" | Real counts |

## 7. Unknowns / OPEN QUESTIONs
1. **Annotated PNGs**: red dashed boxes in 4 screenshots (AI Assistant panel in Inquiries, Gallery grid, Gallery viewer near "Copy description", AI settings heading) = change requests or reference only? (Pending screenshot review, see section 8.)
2. **AI Assistant**: v1 brief = in-thread panel (draft/tone/summarize/suggest). v4 = global chat drawer. Treat both as in scope? (Working assumption: yes, both.)
3. **Inbound inquiry channel**: notif copy says "website form". Form hosted by whom (Klei public site calling our API? embedded widget?) Client follow-up replies: how threaded?
4. **Embeddings (user note: dinov2-base or siglip2-base)**: used for grouping photos of the same gown (and maybe suggest-similar). Where inference runs (desktop Rust/ONNX vs server container) and which model default. Vectors derive from client photos -> stored encrypted; similarity in memory (no pgvector on plaintext).
5. **Tenancy/scale**: single studio assumed. Staff count (5 seeded), photos/month unknown.
6. **Packaging**: macOS required; Windows/Linux unknown.
7. **Web vs desktop**: wireframe says "web dashboard"; brief says Tauri desktop. Offline/connection-loss behaviour unspecified.
8. **AI credits** (640/1,000): whose quota (provider tokens? internal counter)? Reset cadence?
9. **Viewer role** UI never shown; "Share in a reply" button appears in a screenshot (gallery viewer) but not in JS. Needs confirmation.
10. **Phone/signature mismatch** between screenshot (New York, 212) and JS (415): placeholder data, ignore.
11. **Language/timezone** prefs: only labels; i18n in scope?
12. **Audit log scope**: which actions are logged beyond the six seeded; retention.

## 8. Screenshot findings
27 images: 24 `drawing-*.png` (screens with red dashed boxes, no text annotations) + 3 Gemini JPEGs (black-ink line-art brides, unannotated, likely brand/empty-state art). Filename-to-screen pairing unverified; grouped by screen. Box intent is unstated, so all deltas below are OPEN QUESTION, not requirements.

**Newer than the JS (screenshots ahead of code)**
- Inquiries: per-thread AI Assistant panel (Beta). Actions: Draft reply, Summarize, Suggest gowns, Simulate error. Tone chips: Warm, Formal, Concise, Playful. Footer: "AI reads this thread only and never sends anything without you." Replaces the global chat drawer in `assistant.js`. Some shots drop the topbar "AI Assistant" button.
- Inquiries composer: 3 variants (rich toolbar B/I/U/list/link; template row "Offer a fitting / Ask for details / Say we will follow up" + textarea; chat-style chips + single-line input). Signature shows studio address.
- Inquiries: sender name dotted-underlined (link to customer profile, matches I2). Empty control slot top-right of thread header (unknown). Topbar "Admin" pill (not in code).
- Gallery viewer: "AI confidence NN%" bar, primary "Share in a reply" button (not in JS).
- Settings > Signature: "Away message" card (toggle, required message, "Sent once to each new inquiry"). Present in current JS with closure schedule.
- Settings > AI settings: tone radio cards (Warm / Editorial / Factual), tag taxonomy chips + Add. Heading boxed. Model provider form not in shots (in JS).
- Settings: "Admin only" tab pill; sidebar "AI credits 640 / 1,000" widget boxed.
- Seed copy bugs visible ("straplesss", "a a-line"): fix at generation.

**Older than the JS (code ahead of screenshots)**
- Gallery grid: no bulk select / Download .zip / Delete / Edit in shots; JS has all.
- AI Upload review: tags and Move/Split/Merge are plain selects in shots; JS has chip comboboxes.

**Net-new feature candidates to confirm**: per-thread AI panel + tone, reply templates, Share-in-a-reply (attach gown to reply), AI confidence on gown, away message, studio address in signature.
