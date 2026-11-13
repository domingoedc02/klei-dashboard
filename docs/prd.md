---
title: Klei Bridal Dashboard
status: final
created: 2026-11-08
updated: 2026-11-13

# PRD: Klei Bridal Dashboard
*Working title. Confirm.*

## 0. Document Purpose
Audience: UX Designer, Architect, Scrum Master, Dev, QA. Builds on `docs/project-brief.md` (approved Gate 1) and `docs/wireframe-inventory.md`. The wireframe (vanilla-JS prototype, read-only) is the source of truth for scope, layout and flow; this PRD states what the real product must do. Structure: Glossary-anchored vocabulary; Features with FRs nested and globally numbered (FR-1..FR-44; FR-44 added 2026-11-10); cross-cutting NFRs in §5 (NFR-1 is the non-negotiable encryption requirement, verbatim); assumptions tagged inline `[ASSUMPTION]` and indexed in §12; unresolved items marked `OPEN QUESTION` in §11. Tech choices that are not fixed are deferred to the Architecture ADRs.

## 1. Vision
Klei Bridal Dashboard is the desktop workspace for a bridal studio's staff. Staff drop in hundreds of gown photos; AI groups photos of the same gown, tags its attributes and writes a description; staff review and save. The result is a searchable Gallery. The same app is where staff read client inquiries, reply from a rich-text composer with the studio signature, and ask an AI Assistant to summarize inquiries, draft a reply or suggest gowns.

It matters because cataloguing and answering inquiries are slow, repetitive and inconsistent today. The app removes the manual grouping, naming and describing, and shortens reply time, while a human always has the last word: AI proposes, staff decide, AI never sends anything.

Client and business data is personal and commercial. The product's defining constraint is that **everything persisted is encrypted at rest** (NFR-1), so a database dump, backup or object-store leak exposes nothing readable. Runs on macOS, Windows and Linux against a Docker-hosted backend deployed with Dokploy.

## 2. Target User

### 2.1 Jobs To Be Done
- *Functional (Staff):* "Turn a pile of 30 photos into correctly named, tagged, described gowns in one sitting."
- *Functional (Staff):* "Find a gown by silhouette, fabric or name in seconds when a client asks."
- *Functional (Staff):* "Answer a client inquiry quickly, on brand, with the right gown suggestions."
- *Functional (Admin):* "Control who can do what, which AI provider is used, and see what happened (audit)."
- *Emotional (Admin/Owner):* "Trust that client details and our catalogue can't leak, even if the server or a backup is stolen."
- *Contextual (all):* "Keep working through a flaky connection without losing a half-written reply."

### 2.2 Non-Users (v1)
- Clients/brides (no client-facing UI, portal or login).
- Anonymous visitors of the studio website (no public intake in MVP).
- Multiple studios (single Workspace only).

### 2.3 Key User Journeys

- **UJ-1. Eleanor sets up the Workspace and brings Jonah on.**
  - **Persona + context:** Eleanor Park, owner and Admin of Klei Bridal, first launch of the new app.
  - **Entry state:** Backend stack running; first Admin bootstrapped (FR-1); app installed, not signed in.
  - **Path:** Signs in (FR-4) → Settings > Admin > AI settings: picks the LiteLLM-compatible provider, enters URL, key, models (including embedding model `dinov2-base`), taps Test connection (FR-37) → Staff: invites Jonah as Staff (FR-35) → Jonah gets email, opens link, sets name and password (FR-2) and verifies email (FR-3).
  - **Climax:** Test connection returns "Connected" with the model list loaded; Jonah lands on the Dashboard.
  - **Resolution:** Audit log shows both actions (FR-40). Jonah appears as Active.
  - **Edge case:** Jonah's invite link expired → error "invite link has expired, ask your admin"; Eleanor uses Resend invite.

- **UJ-2. Marcus turns 30 photos into 10 gowns.**
  - **Persona + context:** Marcus Bell, Staff, after a vendor photo shoot.
  - **Entry state:** Signed in, AI provider configured, Gallery has existing gowns.
  - **Path:** AI Upload → drops 30 photos (FR-8) → watches progress through reading, grouping, tagging, describing (FR-9) → reviews 10 Groups sorted by confidence, fixes one Low-confidence Group by moving a Photo to another Group (FR-10, FR-11) → Save 10 gowns (FR-12).
  - **Climax:** Gallery opens with 10 new Gowns, newest marked "New".
  - **Resolution:** Upload screen back to empty; notification for others not required.
  - **Edge case:** Provider unreachable mid-batch → error state with Retry; photos already uploaded are kept for the retry (FR-9).

- **UJ-3. Tessa answers Hannah's fitting request.**
  - **Persona + context:** Tessa Moreau, Staff, new inquiry from Hannah Whitfield about an A-line Mikado gown.
  - **Entry state:** Signed in; Inquiry unread with status New.
  - **Path:** Inquiries → opens Hannah's Inquiry (FR-19, FR-20) → opens AI Assistant, asks "Suggest gowns for Hannah" and "Draft a reply" (FR-26) → copies the draft into the composer, edits it, signature appended (FR-21) → Send.
  - **Climax:** "Reply sent to Hannah"; status becomes Replied.
  - **Resolution:** Thread shows her reply; unread count drops.
  - **Edge case:** Connection drops while composing → Draft stays in memory, banner "Offline, reply not sent", Send disabled until reconnected (NFR-3).

- **UJ-4. Ines, a Viewer, browses the catalogue.**
  - **Persona + context:** Ines Carvalho, Viewer, checking gowns for a styling plan.
  - **Entry state:** Signed in as Viewer.
  - **Path:** Dashboard → Gallery → filters Silhouette = Mermaid, Fabric = Lace (FR-14) → opens a Gown (FR-15).
  - **Climax:** Sees photos, attributes and description; edit, delete, download and upload actions are absent or disabled.
  - **Resolution:** Inquiries and Admin are not reachable.
  - **Edge case:** Types an Admin URL/route → server returns forbidden; app shows "You don't have access".

## 3. Glossary
*Used verbatim in all downstream documents.*

- **Workspace** — the single studio tenant. Everything belongs to it. Exactly one.
- **User** — a person who signs in. Has one Role, a Status (Active, Invited).
- **Role** — Admin, Staff or Viewer. Grants Permissions through the permission matrix.
- **Permission** — one of: Upload images, Edit gown details, Delete gown folders, Reply to inquiries, Close inquiries, Manage staff, Change AI settings, View audit log.
- **Invitation** — an Admin-issued, time-limited, single-use credential tied to an email and Role.
- **Gown** — one dress design: name, Photos, Attributes, Description, Confidence, date added. Shown in Gallery as a folder. (UI label "folder"; no other synonym.)
- **Photo** — one image belonging to a Gown or a Group.
- **Attribute** — a typed tag on a Gown. Types: Silhouette, Fabric, Neckline, Sleeve, Train. A Gown may hold several values per type.
- **Taxonomy** — the admin-editable list of allowed values per Attribute type. Seed: Silhouette (A-line, Mermaid, Ball gown); Fabric (Mikado, Tulle, Lace); Neckline (Sweetheart, V-neck, Off-shoulder, Bateau, Square); Sleeve (Strapless, Cap sleeve, Long sleeve, Sheer long sleeve); Train (Sweep, Chapel, Cathedral, None).
- **Description** — AI-written, human-editable text about a Gown.
- **Confidence** — AI's certainty (0-100) that a Group is one Gown with correct Attributes. Levels: High ≥ 90, Medium 80-89, Low < 80 (shown "Low · check"). Revised 2026-11-10 (course correction): a Group the vision check (FR-9) has not confirmed can never read High; the cut-offs are final only after Story 10.4 calibrates them against the evaluation set.
- **Upload Batch** — one set of Photos submitted together for AI processing. Phases: empty, processing, review, error.
- **Group** — AI-proposed Gown inside an Upload Batch before Save.
- **Embedding** — a numeric vector of a Photo produced by the configured embedding model. Derived client data.
- **Inquiry** — a client's request to the studio: Client, subject, status, ordered Messages.
- **Message** — one entry in an Inquiry: client message or staff Reply.
- **Reply** — a staff-authored Message sent to the Client by email.
- **Draft** — an unsent Reply, auto-saved per Inquiry.
- **Status** — New, Replied or Closed.
- **Client** — a person who sent Inquiries: name, email, phone, city, wedding date, source, note. (The wireframe's "customer" means Client.) Revised 2026-11-10 (course correction): the UI word is "Customer", as in the prototype; API, database and code keep `client`.
- **Signature** — per-User block appended to Replies.
- **Away Message** — text for clients while the studio is closed, plus the closure schedule.
- **AI Provider** — the configured OpenAI-compatible endpoint (URL, key, models). Default: LiteLLM.
- **AI Assistant** — the global chat drawer backed by the AI Provider chat model.
- **Audit Entry** — immutable record of timestamp, actor, action, IP.
- **Notification** — in-app item (title, time, target) for a User.
- **KEK / DEK** — Key Encryption Key (versioned, from environment or secret store) and Data Encryption Key (per record or per Workspace, stored wrapped).
- **Blind Index** — HMAC-SHA-256 of a normalized value under a separate key, stored in its own column for exact-match lookup.
- **Sentinel** — a known plaintext test value inserted to prove it never appears in storage.
- **Auth Web** — the Thymeleaf-rendered web app, served on its own port apart from the API, that hosts Invitation acceptance, email verification, sign-in and password reset in the system browser.
- **Deep Link** — the custom-URL redirect from the Auth Web back into the desktop app after a successful sign-in.
- **Update** — a signed new version of the desktop app, fetched and installed by the app itself.

## 4. Features

### 4.1 Authentication and Accounts
**Description:** Account lifecycle from the wireframe auth flow: invite, set password, verify email, sign in, reset. Per the user, these screens (wireframe A1-A5) are served by the **Auth Web** in the system browser, not inside the desktop app; after sign-in the browser returns the User to the desktop app by Deep Link. Layout and copy stay faithful to the wireframe. Anti-enumeration messages throughout. Realizes UJ-1, UJ-4. No 2FA in MVP `[NON-GOAL for MVP]`; no self-registration.

**Functional Requirements:**

#### FR-1: Bootstrap first Admin
An operator can create the first Admin account on a fresh backend through a first-run command using environment values; no UI sign-up exists. Realizes UJ-1.

**Consequences (testable):**
- First-run command fails if an Admin already exists.
- Bootstrap values come from `.env` (documented in `.env.example`), never from code.
- The created account's name, email and password hash are stored encrypted (NFR-1).

#### FR-2: Accept Invitation
An invited person can open an Invitation, see who invited them and the Role, read-only email, set full name and a password, and continue to email verification. Realizes UJ-1.

**Consequences (testable):**
- Password must be ≥ 8 characters with at least one number; 4-level strength meter shown; confirm must match.
- Expired or used Invitation shows "This invite link has expired. Ask your admin to send a new one."
- Password stored only as an Argon2id hash (NFR-1).

#### FR-3: Verify email
A new User can confirm ownership of their email by 6-digit code or by link, with Resend. Realizes UJ-1.

**Consequences (testable):**
- Code/link expires after 30 minutes; wrong or expired code shows "That code is incorrect or has expired."
- Resend invalidates the previous credential.
- A User cannot reach the app until verified.

**Notes:** `[ASSUMPTION: code vs link vs both is decided in the Auth ADR; both appear in the wireframe]`

#### FR-4: Sign in
A User can sign in with email and password, optionally "Keep me signed in". Realizes UJ-1, UJ-3, UJ-4.

**Consequences (testable):**
- Wrong email or password returns the same message "Email or password is incorrect…" for both.
- Login rate-limited per account and per IP; repeated failures delay further attempts.
- Lookup by email uses a Blind Index (NFR-1); no plaintext email is queryable.
- Sign-in happens on the Auth Web in the system browser; the desktop app never shows a credential form and the password never enters the Tauri webview.
- After sign-in the browser returns to the desktop app by Deep Link and the app opens the User's start page preference (default Dashboard).

#### FR-5: Reset password
A User can request a reset link, then choose a new password. Realizes UJ-1.

**Consequences (testable):**
- Request always shows "If an account exists for <email>, you'll get an email in a minute." regardless of existence.
- Link expires in 30 minutes, single use; expired shows "This reset link has expired. Request a new one."
- Reset ends all other sessions for that User.
- The reset email contains only the link and generic text (NFR-6).

#### FR-6: Session, keychain and sign out
The desktop app keeps the User signed in using tokens in the OS keychain and can sign out. Realizes UJ-3.

**Consequences (testable):**
- The Deep Link carries only a single-use, short-lived authorization code, never a token; the app exchanges it with the backend using PKCE `[ASSUMPTION: OAuth 2.0 authorization-code + PKCE per RFC 8252, decided in the Auth ADR]`.
- Where an OS cannot register the Deep Link reliably (e.g. Linux AppImage), a loopback redirect is the fallback `[ASSUMPTION]`.
- The Auth Web runs on its own port, separate from the API, with its own session cookie (HttpOnly, Secure, SameSite), CSRF protection and CSP.
- The desktop app learns the backend and Auth Web URLs from a build-time constant, not a setting `[ASSUMPTION: URLs are not secrets; dev builds point at localhost]`.
- No token or secret appears in the frontend bundle, localStorage, sessionStorage or IndexedDB.
- Sign out deletes the keychain entry and invalidates the session server-side.
- Every API call is authorized server-side against the User's Role; a Viewer calling a Staff endpoint gets 403.
- Role or Permission changes apply at the User's next sign-in `[ASSUMPTION: wireframe copy "Changes apply next sign-in"]`.

#### FR-44: Two-factor authentication
`[ADDED 2026-11-10, course correction; the prototype shows it, Gate 3 had removed it]` A User can turn on a time-based one-time code (TOTP, RFC 6238) as a second sign-in step and turn it off again. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- Settings > Profile shows a Two-factor card. "Set up authenticator" shows a QR code and the secret as text, then asks for a 6-digit code before it turns on; a wrong code leaves it off.
- Turning it on shows 8 single-use recovery codes once. Only their hashes are stored.
- With it on, Auth Web sign-in asks for the code after the password. A wrong code shows the same message for every failure and counts toward the login rate limit (FR-4). A recovery code works once.
- The secret is stored encrypted (NFR-1). The suite finds no plaintext secret or recovery code (FR-42).
- Turning it off asks for the password and a current code. Enable, disable and failed attempts write Audit Entries (FR-40).
- The desktop app is unchanged: the code step happens on the Auth Web (FR-4).
- Decision 2026-11-10 (was OPEN QUESTION 16): 2FA is optional per User. An Admin setting that requires it for every User is not built; the prototype shows only an audit row for it. QR drawing uses `com.google.zxing:core` (approved).

**Notes:** Detail in the Auth ADR (ADR-19).

### 4.2 Dashboard
**Description:** Home with four widgets: Recent uploads, Unread inquiries, AI processing status, Total gowns. Each has loading skeleton and empty state with a call to action. Realizes UJ-2, UJ-4.

**Functional Requirements:**

#### FR-7: Dashboard widgets
A User can see summaries scoped to their Permissions and jump to the detail screen.

**Consequences (testable):**
- Total gowns equals Gallery count.
- Photos this month counts Photos of Gowns saved in the current calendar month (UTC edges) and the sub-line gives the Gown count; hidden for a Role without View gallery.
- Avg. reply time is the mean first-reply time of answered Inquiries from the last 30 days (latest 100 Inquiries only), compared with the 30 days before; "No replies yet" when none; hidden for a Role without Reply.
- Unread inquiries count equals Inquiries with Status New and unread, with the oldest unread's time or date; hidden for Viewer.
- AI processing status reflects the current Upload Batch phase.
- Empty Workspace shows "No uploads yet" with an Upload photos action.

### 4.3 AI Upload
**Description:** Staff drop Photos, AI groups them into Groups, tags and describes each, staff review and save as Gowns. Uses the configured embedding model for grouping and vision/chat models for Attributes and Descriptions. Review is mandatory: nothing is saved without confirmation. Realizes UJ-2.

**Functional Requirements:**

#### FR-8: Start an Upload Batch
A User with Upload images can add Photos by drag-and-drop or file picker and start processing.

**Consequences (testable):**
- Accepted: JPEG, PNG, WebP up to 25 MB each, up to 200 Photos per Upload Batch `[ASSUMPTION]`; rejected files are listed with the reason. Confirmed 2026-11-10 (course correction): the cap stays 200; the prototype's 100 does not apply (Story 11.5).
- Each Photo is encrypted client-side before storage (NFR-1) and stored under a random UUID key.
- Users without Upload images see no upload action; API returns 403.

#### FR-9: Process an Upload Batch
The system can group, tag and describe the Photos, showing progress, and keep working if the User leaves the screen.

**Consequences (testable):**
- Progress shows four steps: Reading N photos, Grouping images of the same gown, Tagging silhouette, fabric, neckline, Writing descriptions.
- Grouping uses Embeddings from the configured embedding model plus the grouping sensitivity setting (FR-38).
- Revised 2026-11-10 (course correction): embeddings alone mis-group look-alike gowns (same colour, fabric and pose) at High confidence. After clustering, each Group of two or more Photos is checked once by the vision model, which sees thumbnails labelled "Photo n of m" and nothing else, and splits the Group where the Photos are not the same gown. A failed or invalid check keeps the Group, unverified, and never fails the Batch. The check runs inside the Grouping step (no fifth step).
- Revised 2026-11-10 (course correction): Confidence reflects both the average and the weakest pair in the group, the Taxonomy match share can only lower it, and an unverified Group is capped below High (Story 10.2, 10.3).
- The embedding model is image-only (confirmed by the user against `dinov2-base`): each Photo is the only input, there is no text embedding, and vector length is read from the response, not hardcoded.
- Stored Photos are encrypted, so how the Provider receives the image (inline data vs a short-lived one-time fetch URL) is an Architecture spike. OPEN QUESTION 3.
- On completion a Notification "AI finished grouping N images into M gowns" is created.
- On Provider error the screen shows an error with Retry; already-uploaded Photos are not re-uploaded.
- Every AI request and response is stored encrypted; egress is as listed in §7.

#### FR-10: Review Groups
A User can inspect each Group and edit its name, Attribute values (chosen from the Taxonomy), and Description, with Confidence shown.

**Consequences (testable):**
- Groups ordered so Low-confidence ones are easy to find; Confidence shown as High, Medium or "Low · check".
- Attribute inputs only accept Taxonomy values; multiple values per type allowed.
- Edits persist while reviewing (page navigation does not lose them). Revised 2026-11-10 (course correction): superseded. Edits are held on the screen and written on "Confirm and save"; leaving with unsaved edits asks first ("Nothing is saved until you confirm", Story 11.6).

#### FR-11: Rearrange Photos
A User can move a Photo to another or new Group, split selected Photos into a new Group, merge Groups, or discard a Photo.

**Consequences (testable):**
- Merge combines Photos and keeps the target Group's name/Attributes.
- A Group with zero Photos is removed automatically.
- Each action is reversible until Save is confirmed `[ASSUMPTION]`.

#### FR-12: Save or discard the Upload Batch
A User can save all Groups as Gowns or discard the Upload Batch after confirmation.

**Consequences (testable):**
- Save creates N Gowns, marks only the newest as "New", and resets Upload to the empty state; Toast "N gowns saved to Gallery".
- Discard asks for confirmation, deletes the batch's stored Photos and Embeddings, and resets Upload.
- Save and discard each create an Audit Entry (FR-40).

**Feature-specific NFRs:** Egress of Photos to the AI Provider is expected and documented (§7). Embeddings are stored encrypted and never in a plaintext vector column.

### 4.4 Gallery
**Description:** Folder grid of Gowns, newest first, with filters and a viewer. Realizes UJ-2, UJ-4.

**Functional Requirements:**

#### FR-13: Browse Gallery
A User can browse Gowns as a paged folder grid sorted by latest upload first.

**Consequences (testable):**
- Each card shows a 4-Photo mosaic, name, Silhouette · Fabric, photo count, date added; newest Gown carries "New".
- States: loading skeleton, empty ("Your gallery is empty" + Upload photos), no-match ("No gowns match these filters" + Clear filters).
- Header shows "N of M gowns · latest upload first".

#### FR-14: Filter Gallery
A User can filter by Silhouette, Fabric and date added (All time, Last 7, 30, 90 days) and clear filters.

**Consequences (testable):**
- Silhouette and Fabric filters are exact-match via Blind Index; date filtering never uses plaintext timestamps in SQL (NFR-1).
- Combined filters AND together.

#### FR-15: View a Gown
A User can open a Gown to see Photos (previous/next, thumbnails), Attributes, photo count, date added, Confidence and Description, and copy the Description.

**Consequences (testable):**
- Photos are decrypted for display only on the client or in transit over TLS.
- Copy description puts the Description on the clipboard and shows a toast.
- Breadcrumb returns to Gallery with the previous filters.

#### FR-16: Edit a Gown
A User with Edit gown details can change name, Attributes and Description.

**Consequences (testable):**
- Name required; Attribute values limited to the Taxonomy.
- Change creates an Audit Entry.

#### FR-17: Download Gown archive
A User can download one Gown or a bulk selection as .zip containing the Photos and a `details.txt`.

**Consequences (testable):**
- Zip is assembled after decryption on the client (Tauri side) or backend; nothing decrypted is persisted server-side.
- Bulk mode: Select all, "N selected", actions disabled when none selected.

#### FR-18: Delete Gowns
A User with Delete gown folders can delete one or many Gowns after a confirmation naming them and the Photo count.

**Consequences (testable):**
- Delete removes DB rows, Embeddings and MinIO objects `[ASSUMPTION: hard delete, no trash]`.
- Confirmation text states it can't be undone; Cancel is the default focus.
- Audit Entry written with the Gown name encrypted.

### 4.5 Inquiries and Clients
**Description:** Email-client layout: inbox list, thread, composer. Inquiries enter through an authenticated API only; the public intake channel is deferred `[NON-GOAL for MVP]`. Realizes UJ-3.

**Functional Requirements:**

#### FR-19: List Inquiries
A User with inbox access can list Inquiries, filter All, New, Replied, Closed, and see unread state.

**Consequences (testable):**
- Row shows Client name, subject, preview, time, Status pill; unread rows are visually distinct.
- Filter by Status uses a Blind Index.
- States: loading, empty. The sidebar shows the New count.

#### FR-20: Read an Inquiry
A User can open an Inquiry and read its Messages in order; opening marks it read.

**Consequences (testable):**
- Client name links to the Client profile (FR-23).
- Closed Inquiry shows "This inquiry is closed. Reopen it to reply."

#### FR-21: Reply
A User with Reply to inquiries can write a Reply in a rich-text composer (bold, italic, underline, lists, link), attach files, see their Signature, and send by email.

**Consequences (testable):**
- To and Subject are pre-filled from the Inquiry; HTML is sanitized to the allow-list B, I, U, STRONG, EM, UL, OL, LI, A, BR, DIV on both client and server.
- Draft auto-saves per Inquiry ("Saved as draft"); Discard removes it; Draft is stored encrypted.
- Send delivers by SMTP, stores the Reply as a Message, sets Status Replied, toasts "Reply sent to <first name>".
- Attachments are encrypted before MinIO upload; file names are stored encrypted.
- Signature is appended automatically when enabled in Signature settings.
- "Press Enter to send" preference is respected (FR-33).

#### FR-22: Manage Inquiry Status
A User can change Status via a select or "Close inquiry"; closing requires Close inquiries.

**Consequences (testable):**
- Sending a Reply sets Replied automatically.
- Setting Closed without Close inquiries returns 403.
- Status changes create an Audit Entry.

#### FR-23: Client profile
A User can open a Client profile showing contact details, wedding date, source, note, and that Client's Inquiries.

**Consequences (testable):**
- Client is matched by email Blind Index, so repeat Inquiries from the same email attach to one Client.
- A User with Reply to inquiries can edit phone, city, wedding date, source, note `[ASSUMPTION]`.

#### FR-24: Create an Inquiry via API
An authenticated integration or test can create an Inquiry (Client name and email, subject, body) through the backend API.

**Consequences (testable):**
- All fields are stored encrypted; Client is matched or created (FR-23).
- This endpoint is what the plaintext-leak suite uses (FR-42).
- Public/unauthenticated intake is not provided `[NON-GOAL for MVP]`.

### 4.6 AI Assistant
**Description:** One global chat drawer opened from the topbar, on every screen. It replaces the wireframe's per-thread panel, which is dropped for good along with reply templates and Share-in-a-reply. Realizes UJ-3.

**Functional Requirements:**

#### FR-25: Converse with the AI Assistant
A User with Reply to inquiries can open the drawer, see a greeting and three suggestion chips, send messages, start a new chat and close it.

**Consequences (testable):**
- Enter sends, Shift+Enter adds a new line; typing indicator while waiting.
- Esc closes the drawer when no menu or dialog is open.
- Chat history is stored encrypted (NFR-1) `[ASSUMPTION: history persists per User until New chat]`.

#### FR-26: Assistant capabilities
The AI Assistant can summarize new Inquiries, draft a Reply for a named Client or Inquiry, and suggest Gowns from the Gallery for a described need.

**Consequences (testable):**
- Answers are grounded in Workspace data (Inquiries, Gallery) provided as context per request.
- A draft appears in the chat as text; the User copies it into the composer. The Assistant has no write access to the composer or inbox.
- Gown suggestions name existing Gowns only; never invented ones.

#### FR-27: Assistant boundaries and disclosure
The AI Assistant must never send email or change data, and the drawer must tell the User what is shared.

**Consequences (testable):**
- No Assistant API path can send email or write Inquiries, Gowns or settings.
- The drawer states that messages and the Inquiry/Gown text it needs are sent to the configured AI Provider.
- If the AI Provider is not configured or fails, the drawer shows a clear error and the rest of the app works.

### 4.7 Search and Notifications
**Description:** Topbar search over Gowns and Inquiries, and a notifications menu. Realizes UJ-3.

**Functional Requirements:**

#### FR-28: Global search
A User can search Gowns (name, Silhouette, Fabric) and Inquiries (Client name, subject) from the topbar and open a result.

**Consequences (testable):**
- Up to 6 results shown; no-result state "No results for “q”" with Clear search.
- A Gown result opens that Gown in Gallery; an Inquiry result opens that thread.
- Viewer sees Gown results only.
- Matching must not use LIKE or equality on ciphertext. Behaviour (accepted by the user at Gate 2): case-insensitive whole-word match. Partial-word matching is not required in MVP.

#### FR-29: Notifications
A User can see in-app Notifications (new Inquiry, AI finished, team activity), open one to navigate, and clear all.

**Consequences (testable):**
- Bell shows a dot when unread exist; empty state "You're all caught up".
- Notification titles may include Client names, so they are stored encrypted.
- Event types respect the User's Notification preferences (FR-34).

### 4.8 Personal Settings
**Description:** Tabs Profile, Signature, Preferences, Notifications for every User. Realizes UJ-1.

**Functional Requirements:**

#### FR-30: Profile
A User can edit name and avatar and change their password.

**Consequences (testable):**
- Password change requires the current password and meets FR-2 rules; other sessions end.
- Name and avatar are stored encrypted (avatar image per NFR-1 MinIO rule).

#### FR-31: Signature
A User can turn the Signature on/off and set sign-off, name, title and phone, with a live preview.

**Consequences (testable):**
- Preview matches what Send appends (FR-21).
- Business name and address appear as set by an Admin `[ASSUMPTION: studio address is a Workspace-level field set by Admin]`.

#### FR-32: Away Message and closure schedule
`[REINSTATED 2026-11-10, course correction; was DEFERRED at Gate 3]` An Admin can write an Away Message and set a closure schedule (one time, weekly, daily).

**Consequences (testable):**
- Schedule validates (end not before start; at least one open/closed day for weekly).
- Saved and summarized in Settings.
- Confirmed 2026-11-10 (was OPEN QUESTION 15). Automatic sending was a non-goal and is now in scope: while the studio is closed, one Inquiry arriving from a Client sends them the Away Message once per closure window, through the existing mail port (Story 11.12).

#### FR-33: Preferences
A User can set date format, timezone, start page and "Press Enter to send".

**Consequences (testable):**
- Start page applies after sign-in (FR-4).
- Language shows English (US) only `[ASSUMPTION: i18n deferred]`.

#### FR-34: Notification preferences
`[REINSTATED 2026-11-10, course correction; was DEFERRED at Gate 3]` A User can set in-app and email toggles per event (new Inquiry, AI finished, team activity) and the email digest frequency (Real-time, Hourly, Daily, Weekly, Never). The settings drive real email (Story 11.13).

**Consequences (testable):**
- Notification emails contain generic text and a link only, never Client names or message content (NFR-6).

### 4.9 Administration
**Description:** Admin-only tabs: Staff, Roles & permissions, AI settings, Audit log. Realizes UJ-1.

**Functional Requirements:**

#### FR-35: Staff management
An Admin can list Users and invite, edit, resend an Invitation to, or delete a User.

**Consequences (testable):**
- Table shows name, email, Role, Status (Active, Invited), last active.
- Invite sends one email with an Invitation link (NFR-6); Resend invalidates the earlier one.
- Delete asks confirmation and the User loses access immediately; their uploads and replies remain.
- An Admin cannot delete or demote the last Admin.
- Every action creates an Audit Entry.

#### FR-36: Roles and permissions
An Admin can view and edit the Permission matrix for Staff and Viewer; the Admin column is locked.

**Consequences (testable):**
- Default matrix: Upload images, Edit gown details, Reply to inquiries, Close inquiries = Admin + Staff; Delete gown folders, Manage staff, Change AI settings, View audit log = Admin only; Viewer has none.
- Server enforces the matrix on every endpoint (FR-6).
- Change creates an Audit Entry.

#### FR-37: AI Provider settings
An Admin with Change AI settings can configure preset (OpenAI, OpenRouter, Groq, Ollama, Custom; default LiteLLM), base URL, API key, organization, chat model, vision model, **embedding model**, temperature and max tokens, and Test connection.

**Consequences (testable):**
- Default values: base URL `https://nextgen-ai.enlinka.co`, embedding model `dinov2-base`.
- Test connection runs on the backend, calls `/models`, sends a one-image probe to the embedding model, and reports Connected or Failed with the cause per check; the browser never calls the Provider.
- API key is write-only: never returned by any API, shown masked, stored encrypted, never in `.env` or the bundle.
- Changing URL, key or organization resets status to "Not tested".
- Validation: URL must start with http(s)://; key required except for local Ollama.

**Notes:** The wireframe has Model and Vision model but no Embedding model field; adding it is a scope change confirmed by the user.

#### FR-38: AI behavior settings
An Admin can set grouping sensitivity (1-5), description tone (Warm, Editorial, Factual), edit the Taxonomy, and toggle "Use advanced AI model".

**Consequences (testable):**
- Sensitivity labels: Very loose, Loose, Balanced, Strict, Very strict.
- Removing a Taxonomy value in use is blocked or requires reassigning; existing Gowns never lose data silently.
- Taxonomy values are stored encrypted and addressed through Blind Indexes (NFR-1).

**Notes:** `[ASSUMPTION: "advanced AI model" selects an optional second vision model configured in FR-37; disabled when none is set]`. OPEN QUESTION 5.

#### FR-39: AI usage log
The system records each AI request (purpose, model, size, outcome, time, User) for the Admin's visibility and future metering.

**Consequences (testable):**
- All fields are stored encrypted; prompts and responses are also stored encrypted (NFR-1).
- A credits/quota meter is not shown in MVP `[NON-GOAL for MVP]`; the sidebar meter is omitted. OPEN QUESTION 6.

#### FR-40: Audit log
An Admin with View audit log can read an append-only list of Audit Entries.

**Consequences (testable):**
- Columns: timestamp, actor, action, IP; newest first, paged.
- Logged: sign-in failures and successes, invite/delete/role change, permission change, AI settings change, Upload save/discard, Gown edit/delete, Inquiry status change, Reply sent, key rotation.
- No API edits or deletes an Audit Entry; timestamp, actor, action and IP are stored encrypted.

### 4.10 Key Management and Verification
**Description:** Operator-facing capabilities that make NFR-1 operable and provable.

**Functional Requirements:**

#### FR-41: KEK rotation and re-wrap
An operator can introduce a new KEK version and run a re-wrap job that re-encrypts all stored DEKs under it without downtime.

**Consequences (testable):**
- Every ciphertext carries `key_version`; reads work with old and new versions during the job.
- Job is resumable and idempotent and writes an Audit Entry on completion.
- After the job, the old KEK can be removed and all data still decrypts.

#### FR-42: Plaintext-leak verification suite
The build can prove no plaintext reaches storage.

**Consequences (testable):**
- Suite inserts Sentinel values through the API (users, Clients, Inquiries and Replies, Gown names/Descriptions/Attributes, AI settings, prompts, audit actions, filenames), then dumps every PostgreSQL table via SQL (and lists MinIO object keys and downloads objects) and asserts no Sentinel appears.
- Also checks backend logs and Mailpit messages for Sentinels beyond the documented minimal mail content.
- Runs in `mvn verify` and CI; a failure blocks the build.

### 4.11 Desktop Updates
**Description:** The desktop app updates itself so Staff on three OSes stay on one version without manual reinstalls. No OS code-signing certificates exist yet (user), so updates are authenticated by a separate updater signature. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-43: Automatic desktop update
The desktop app can check for, download, verify and install an Update, restarting with the User's consent.

**Consequences (testable):**
- The app checks at start and every 24 h `[ASSUMPTION]`; an available Update shows a non-blocking prompt; install and restart happen only on User confirmation and never discard an unsent Draft or Upload review in progress (NFR-3).
- Update packages are signed with an updater key pair; the app verifies the signature against the public key embedded in the bundle and rejects unsigned or tampered packages. The private key lives only in the CI secret store, never in the repo or an image.
- A failed check or install leaves the current version running and shows a non-blocking message.
- The check request carries only app version, OS and architecture (NFR-6).
- Works without OS certificates: first install shows OS warnings (macOS Gatekeeper, Windows SmartScreen), documented in the install guide. Adding certificates later must not change the update flow.
- Linux auto-update applies to the AppImage; the .deb is updated manually `[ASSUMPTION]`.

**Out of Scope:** forced or staged rollouts, delta updates, in-app release notes.

**Notes:** Where Update packages and the manifest are hosted is OPEN QUESTION 13.

## 5. Cross-Cutting Non-Functional Requirements

### NFR-1: Encrypted data at rest (NON-NEGOTIABLE, verbatim)

> NON-NEGOTIABLE: ENCRYPTED DATA AT REST
>
> Every piece of data persisted in PostgreSQL must be stored encrypted. This includes user info, client info, AI-related info (prompts, responses, settings, keys, usage logs), audit logs, settings, and any metadata containing content. No plaintext business data in any column, index, log, backup, or MinIO object.
>
> Mandated design (App-level envelope encryption):
>
> Algorithm: AES-256-GCM, unique random 96-bit nonce per encryption, authenticated with AAD = table + column + row id (prevents ciphertext swapping).
> Envelope: per-record (or per-tenant) Data Encryption Key (DEK) wrapped by a Key Encryption Key (KEK). KEK comes from environment/secret store, never from the DB, never committed. Support KEK versioning and rotation (store key_version with each ciphertext; provide a re-wrap job).
> Implementation: one CryptoService in Kotlin plus a transparent column converter (JPA AttributeConverter or Exposed column type, whichever the chosen framework uses). Feature code must not call crypto primitives directly.
> Searchable fields (e.g. email for login, client name lookup): use a blind index (HMAC-SHA-256 with a separate key, over normalized value) stored in its own column. No plaintext search, no LIKE on ciphertext. Document which fields get blind indexes and the accepted limits (exact match only).
> Allowed unencrypted: surrogate primary/foreign keys (UUIDv4, random, no meaning), schema versioning tables, and ciphertext envelope fields (nonce, key_version, tag). Timestamps that reveal behavior: encrypt unless an ADR justifies otherwise.
> Passwords: Argon2id hash only (hash is the stored form; still wrapped by the envelope).
> MinIO objects: encrypt client-side with the same envelope scheme before upload; object keys are random UUIDs, filenames and metadata stored encrypted in DB.
> Logs, error messages, and Mailpit/SMTP test mail must not leak plaintext PII. Outbound mail inevitably contains content; keep it minimal and document it.
> AI info: any data sent to or received from an AI provider is stored encrypted. Document what leaves the system and when.
> Tauri side: no secrets in the frontend bundle; tokens in OS keychain, not localStorage.
> Include a verification suite (see QA below) proving no plaintext in DB: a test that inserts representative records through the API then dumps every table via SQL and asserts none of the known plaintext sentinel values appear.

**Realized by:** FR-1, FR-2, FR-4, FR-6, FR-37, FR-39, FR-40, FR-41, FR-42 and every feature that stores data.

**Product-level consequences of NFR-1 (agreed with the user):**
- Gallery filters, search and similarity cannot run as SQL over plaintext. Exact-match fields use Blind Indexes; everything else is matched against decrypted data inside the backend within bounded candidate sets. Accepted limits (exact match only in SQL; no prefix/range/LIKE) are documented in the Architecture. Searchable-field list is an Architecture deliverable.
- Embeddings are derived from client Photos, so they are stored encrypted and compared in memory; no pgvector over plaintext vectors.
- Timestamps are encrypted by default; date-range filters use bounded decrypt or bucketed Blind Indexes decided in an ADR.
- No plaintext persistent cache on the desktop.

### NFR-2: Performance and scale
Design scale (no hard limit, per the user): 10,000 Gowns, 100,000 Photos, 50,000 Inquiries, any number of Users (confirmed by the user at Gate 2). Targets below are proposed, to be validated by an Architecture benchmark story, measured on a LAN backend with the Provider excluded.

| Interaction | Target |
|---|---|
| UI feedback to click/keypress | ≤ 100 ms |
| App cold start to Sign-in screen | ≤ 3 s |
| Gallery page (48 Gowns) first render | p95 ≤ 1.5 s |
| Gallery filter change | p95 ≤ 1 s |
| Global search results | p95 ≤ 1 s |
| Inquiry list page / open thread | p95 ≤ 1 s |
| Open Gown viewer, first Photo visible | p95 ≤ 1.5 s |
| Crypto overhead per page of records | ≤ 200 ms |
| Upload Batch of 30 Photos: UI to review-ready | ≤ 3 min plus Provider time |
| Desktop idle memory | ≤ 300 MB |

All list endpoints are paged; no endpoint decrypts the whole corpus per request.

### NFR-3: Offline and connection-loss behavior
The app needs the backend. It must degrade predictably and never lose work, without storing plaintext on disk.
- Connection state is shown (banner "Offline" / "Reconnecting…"); reads already on screen stay visible.
- Writes while offline are blocked with a clear message, except unsent Replies and in-progress Upload review edits, which are kept in memory and the Draft synced when reconnected.
- Upload Batch: Photos already stored are kept; interrupted transfers resume or retry on reconnect.
- In-flight requests use bounded timeouts with retry for idempotent calls; no duplicate sends: Reply Send is idempotent.
- No offline plaintext cache and no offline-first sync in MVP `[NON-GOAL for MVP]`.
- AI Provider outage: AI features show an error; non-AI features keep working.
- Session expiry during use: return to Sign-in, preserve unsent Draft.

### NFR-4: Packaging and platform targets
- Desktop: Tauri bundles for **macOS** (required), **Windows** and **Linux** (user-confirmed). Formats `[ASSUMPTION]`: macOS .dmg (Apple Silicon + Intel), Windows x64 installer (.msi/NSIS), Linux x64 .AppImage and .deb.
- Tokens live in macOS Keychain, Windows Credential Manager, or Linux Secret Service; if no keystore exists the app refuses to persist a session (fail closed). The User may choose "Continue without saving": the refresh token then stays in process memory only, never on disk, and sign-in repeats on the next launch. Debug builds default to that memory mode.
- CI builds and smoke-tests all three targets from the first desktop story.
- Backend: Linux containers; `docker compose up` brings up backend, PostgreSQL, MinIO, Mailpit.
- **Auto-update is in MVP** (FR-43). OS code signing and notarization are deferred: no certificates yet (user). Expect first-install warnings on macOS and Windows; macOS builds carry at most an ad-hoc signature `[ASSUMPTION]`. A spike confirms the updater works on unsigned builds per OS.
- Production backend runs on Dokploy (NFR-8).

### NFR-5: Security (beyond NFR-1)
- Desktop-to-backend over HTTPS REST/JSON (self-signed accepted in local dev only).
- Auth Web (Thymeleaf, user-specified) is server-rendered, on a separate port from the API, HTTPS only, carries no secrets in markup, and shares the wireframe's look via the UX tokens.
- Passwords: Argon2id; policy ≥ 8 characters with a number; login rate limiting; no account enumeration (FR-4, FR-5).
- RBAC enforced server-side on every endpoint (FR-6).
- Rich text sanitized server-side (FR-21); Tauri CSP restricts scripts and network targets.
- Secrets only from a git-ignored `.env` (or secret store); `.env.example` committed with no real values; no hardcoded keys.

### NFR-6: Egress, logs and mail minimalism
- Logs and error responses carry IDs and codes only, never PII or content. Correlation IDs for tracing.
- Outbound mail is limited to: Invitation, email verification, password reset, notification (generic text + link), and staff Replies to Clients (content by necessity). Each template is documented in §7.
- Mailpit in dev/test must pass the Sentinel check (FR-42) except documented Reply content.

### NFR-7: Accessibility and usability
Target WCAG 2.1 AA `[ASSUMPTION]`: keyboard-operable, visible focus, labelled controls, live regions for status, error messages that give cause and remedy (as in the wireframe). Contrast and focus follow the tokens defined in the UX spec.

### NFR-8: Operability and reliability
- Health checks on backend, PostgreSQL, MinIO; `docker compose` services restart on failure.
- Production runs as the same Docker Compose services deployed by Dokploy (user); Dokploy's proxy terminates TLS and routes the API and Auth Web ports to separate domains `[ASSUMPTION]`.
- KEKs and the Blind Index key are supplied as Dokploy environment variables, never in the repo, an image or the DB; an offline copy is held apart from the DB and MinIO backups. `[ASSUMPTION: recommended; protects against DB, backup and object-store leaks, the NFR-1 threat, but not against compromise of the Dokploy host itself; a KMS is a later upgrade]`
- Backups of PostgreSQL and MinIO are ciphertext; KEK backup is separate and documented. RPO ≤ 24 h, RTO ≤ 4 h `[ASSUMPTION]`.
- Schema migrations are versioned and run at startup.

### NFR-9: Delivery quality gates
Every story ends with runnable checks: `mvn verify` (backend, includes FR-42), the desktop test command, and a `docker compose up` smoke test. Each story review checks the encryption NFR.

## 6. Constraints and Guardrails
- **Fixed stack:** Tauri (Rust core + web frontend), Kotlin on Maven, PostgreSQL, MinIO (S3), SMTP with Mailpit for dev/test, Docker Compose. Open decisions go to Architecture ADRs: Kotlin framework (decided by user: Spring Boot), frontend framework, Flyway vs Liquibase, auth mechanism, transport details.
- **Deployment and auth surface (user):** containers deploy on Dokploy. Sign-in, Invitation, verification and reset are a Thymeleaf **Auth Web** on a separate port from the API; sign-in returns to the desktop app. Process boundary (second connector in the backend vs separate module) is an Architecture decision; Thymeleaf favors a Spring-based backend in the Kotlin framework ADR.
- **Repo layout:** monorepo `/desktop`, `/backend`, `/infra`, `/docs`.
- **Design:** UI follows the wireframe's layout and flow; `taste-skill` and `frontend-design` govern visual polish at the UX step, not structure.
- **Privacy:** minimum data to the AI Provider; user is told what is sent (FR-27, §7).
- **Cost:** AI usage is logged (FR-39); no quotas in MVP.

## 7. Data Governance and Egress

### 7.1 What leaves the system, and when
| Data | Destination | When |
|---|---|---|
| Photos (bytes) | AI Provider (embedding + vision models) | During Upload Batch processing (FR-9) |
| Gown Attributes request, Taxonomy, tone | AI Provider chat model | Writing Descriptions (FR-9) |
| Thumbnails of one Group, labelled "Photo n of m", no names, ids or Client data | AI Provider vision model | Checking each Group during Upload Batch processing (FR-9). Revised 2026-11-10 (course correction) |
| Away Message | Client's email via SMTP | Inquiry arrives during a closure window (FR-32). Revised 2026-11-10 (course correction) |
| User's message plus Inquiry/Gown text needed for the answer | AI Provider chat model | Each AI Assistant message (FR-25, FR-26) |
| API key | AI Provider | Test connection and each AI call, from the backend only |
| Invitation / verification / reset links | User's email address via SMTP | FR-2, FR-3, FR-5, FR-35 |
| Generic notification text + link | User's email via SMTP | Per FR-34 |
| Reply body, Signature, attachments | Client's email via SMTP | Send (FR-21) |

| App version, OS, architecture | Update host | Desktop update check (FR-43) |

Nothing else leaves: no telemetry or analytics `[ASSUMPTION]`.

### 7.2 Data classes (all stored encrypted, NFR-1)
User and staff info; Client info; Inquiries, Messages, Drafts, attachments; Gown names, Attributes, Descriptions, Photos, Embeddings; AI settings, key, prompts, responses, usage logs; Audit Entries; Notifications; Signature, Away Message, Preferences; Taxonomy and permission matrix. Only random UUID keys, schema-version tables and envelope fields are plaintext.

## 8. Non-Goals (Explicit)
- Not a public website, client portal, booking/calendar, billing or POS system.
- Not multi-studio or multi-Workspace.
- Not an email client for general mail: only Inquiries and Replies.
- Not a place for AI to act on its own: no auto-send, auto-save of Groups or auto-delete.
- Not offline-first: no local database or sync engine.
- Not a self-hosted ML platform: embeddings come from the configured AI Provider.

## 9. MVP Scope

### 9.1 In Scope
Authentication (FR-1..6), Dashboard, AI Upload, Gallery, Inquiries and Client profiles (API-created), global AI Assistant drawer, Search, Notifications, personal Settings, Administration (staff, permissions, AI provider and behavior, usage log, audit), key rotation and the plaintext-leak suite, desktop auto-update, on macOS, Windows and Linux.

### 9.2 Out of Scope for MVP
- Public inquiry intake (website form, IMAP, forwarded mail) — deferred by user; `[NOTE FOR PM]` without it Inquiries only come from the API, so the screen has no real-world data source until revisited.
- TOTP/2FA — Revised 2026-11-10 (course correction): now in scope as FR-44.
- Automatic sending of the Away Message — Revised 2026-11-10 (course correction): now in scope with FR-32, confirmed 2026-11-10.
- AI credits quota meter and 2× credit messaging.
- i18n beyond English (US).
- Per-thread AI panel, reply templates, Share-in-a-reply — dropped for good.
- Offline cache.
- OS code signing and notarization (no certificates yet).

## 10. Success Metrics

**Primary**
- **SM-1**: Share of AI-proposed Groups saved with no move/split/merge. Target ≥ 70% after the first month. Validates FR-9, FR-10, FR-11.
- **SM-2**: Median time from opening a New Inquiry to Reply sent. Target ≤ 5 min. Validates FR-21, FR-26.
- **SM-3**: Plaintext-leak suite passes on 100% of builds. Validates NFR-1, FR-42.
- **SM-4**: All NFR-2 p95 targets met in the benchmark at design scale. Validates FR-13, FR-14, FR-28.

**Secondary**
- **SM-5**: Clean install and smoke test passes on macOS, Windows and Linux in CI each release. Validates NFR-4.
- **SM-6**: Test-connection success on first attempt by Admin. Validates FR-37.

**Counter-metrics (do not optimize)**
- **SM-C1**: Auto-accept rate of Groups. Staff must still review; do not push SM-1 by hiding low Confidence or pre-saving. Counterbalances SM-1.
- **SM-C2**: Replies sent unedited from an AI draft. Do not maximize; speed must not cost review. Counterbalances SM-2.

## 11. Open Questions
Resolved at Gate 2 (logged in memlog): scale numbers confirmed; whole-word search accepted; embedding endpoint contract confirmed by user; hosting is Dokploy; KEK custody delegated and recommended; auto-update in MVP, no OS certificates.

1. **Search ADR follow-up.** Architect proposes the whole-word design and its leakage trade-offs (what a DB reader learns from word-level Blind Indexes).
2. **Dokploy topology.** Domains and TLS for the API and Auth Web, and whether the Auth Web port is public. Architect to propose; confirm domains when known.
3. **Image delivery to the embedding model.** The endpoint takes an image only (user curl: `input` is an image URL string). Stored Photos are encrypted, so the backend must either send an inline data URI (check support) or expose a short-lived one-time URL to the Provider. Spike before the Upload epic; fallback is an ADR.
4. **Desktop sign-in return path.** Deep Link plus PKCE is recommended (FR-1 notes). Confirm the Linux AppImage and .deb Deep Link registration works in the spike; loopback redirect is the fallback.
5. **"Use advanced AI model" toggle.** Wireframe copy says "Higher accuracy on lace and sheer fabrics. Uses 2× credits." Confirm it maps to an optional second vision model (FR-38 assumption) or drop it.
6. **AI credits meter.** Sidebar shows 640 / 1,000. Whose quota, what unit, what reset? Deferred; confirm.
7. **Signing and notarization.** No certificates yet. Updater signature covers update integrity only; first installs show OS warnings. Revisit before external distribution (Apple Developer ID about 99 USD/yr; Windows code-signing certificate).
8. **KEK backup holder.** KEKs live in Dokploy env vars (recommended). Who holds the offline copy, and what is the rotation cadence? Losing every KEK copy makes all data unrecoverable.
9. **Retention and deletion.** Gown delete is a hard delete (FR-18). Any retention requirement for Audit Entries, deleted Staff data or backups?
10. **Public intake and 2FA.** Public intake is still deferred. 2FA moved into scope (FR-44) on 2026-11-10; revisit intake before release if Inquiries are to be real.
11. **Viewer scope.** Viewer sees Dashboard (without inquiry widget), Gallery (read-only), personal Settings. Confirm.
12. **Outbound SMTP in production.** Which provider/domain will send Invitation and Reply emails (SPF/DKIM, reply-to)?
13. **Update host.** Where do signed Update packages and the update manifest live (Dokploy-served static path, MinIO public bucket, GitHub Releases)? Needs a stable HTTPS URL baked into the bundle.
14. **Photo cap per Upload Batch.** ANSWERED 2026-11-10: 200 stays; the prototype's 100 does not apply (Story 11.5).
15. **Away Message auto-send.** ANSWERED 2026-11-10: yes, once per Client per closure window (FR-32, Story 11.12).
16. **Two-factor requirement setting.** ANSWERED 2026-11-10 (reply "yes" read as: accept the defaults). zxing QR library: yes. Admin-required 2FA: not built (FR-44). Reverse by writing a story if wanted.

## 12. Assumptions Index
- §4.1 FR-1 — Authorization code + PKCE for the Deep Link return; loopback redirect fallback; backend URL is a build-time constant.
- §4.1 FR-3 — Verification by code vs link decided in Auth ADR.
- §4.1 FR-6 — Role/permission changes apply at next sign-in (wireframe copy).
- §4.3 FR-8 — Upload limits: JPEG/PNG/WebP, 25 MB each, 200 Photos per batch (prototype says 100; the user kept 200 on 2026-11-10).
- §4.3 FR-11 — Rearrange actions reversible until Save.
- §4.4 FR-18 — Gown delete is a hard delete including MinIO objects.
- §4.5 FR-23 — Staff with Reply to inquiries may edit Client fields.
- §4.6 FR-25 — Assistant chat history persists per User until New chat.
- §4.8 FR-31 — Studio address is a Workspace-level field set by Admin.
- §4.8 FR-33 — English (US) only.
- §4.9 FR-38 — "Advanced AI model" selects an optional second vision model.
- §4.11 FR-43 — Update check at start and every 24 h; Linux auto-update for AppImage only.
- §5 NFR-2 — Performance numbers (design scale itself confirmed at Gate 2).
- §5 NFR-4 — Installer formats and architectures.
- §5 NFR-7 — WCAG 2.1 AA.
- §5 NFR-8 — RPO ≤ 24 h, RTO ≤ 4 h; Dokploy proxy routing; KEKs as Dokploy env vars with offline backup.
- §7.1 — No telemetry or analytics.
- §11 OPEN QUESTION 11 / Roles — Viewer sees Dashboard (no inquiry widget), Gallery read-only; Assistant requires Reply to inquiries.

## 13. Electron Migration (additive, 2026-11-13)

**Authority.** Sections 1–12 describe the **baseline product** and the protected Tauri app, frozen at commit `51949da2a0f8347c5f1f56fc5d87d8ada6e60643`, and stay authoritative for it (including NFR-4, §6 "Fixed stack: Tauri" and FR-43). This section adds requirements for a **separate Electron target** built in `electron/` on branch `electron-migration`. Where the two differ, this section governs the Electron target only. Detail: `docs/brownfield-architecture.md` (inventory and mapping), `docs/architecture.md` §13 and spine AD-22..AD-28 (design), `docs/prd/` (epics 14–20), `docs/stories/14.1`..`20.4` (32 stories).

### 13.1 Goal and non-goals
**Goal.** Ship the same desktop product on Electron with zero visual or functional regression, so the Tauri app can later be retired by a decision of the owner.
**Non-goals** `[NON-GOAL for MVP]`: redesign, new product features, backend or API changes, dependency cleanup in `desktop/`, automatic updates, OS code signing or notarization, migration of existing installations or tokens (none are deployed), removing or editing the Tauri app.

### 13.2 Migration requirements

#### MFR-1: Original is protected
**Consequences (testable):**
- `git diff --exit-code 51949da2a0f8347c5f1f56fc5d87d8ada6e60643 -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows` is empty at every story close, and no untracked file appears outside the approved paths (`electron/`, `docs/`, new `.github/workflows/electron*.yml`). Existing tracked workflows stay byte-identical. Once a new `electron*.yml` is committed, the plain diff form lists it as `A`, so the gate is `electron/scripts/protected-paths.mjs` (story 14.1), which accepts only `A` or `??` on `.github/workflows/electron*.yml`. While such files are uncommitted, also run `git status --porcelain --untracked-files=all -- desktop backend infra prototype docs/api .github/workflows` and accept only `?? .github/workflows/electron*.yml`.
- Electron build output, caches and node_modules live under `electron/` only; nothing is written to `desktop/dist` or `desktop/node_modules/.vite`.

#### MFR-2: Parity
**Consequences (testable):**
- Every screen and state in `desktop/scripts/shots/screens.mjs` renders identically (zero geometry findings; each pixel difference reviewed) in the original renderer and in Electron, at 1440×900, 1280×800 and 1100×700.
- Keyboard focus, toasts, Escape handling, reduced motion and accessibility checks (NFR-7) pass separately from screenshot normalisation.
- Every critical flow in the parity matrix (startup, sign-in, upload, review, gallery, inquiries, settings, assistant, update) passes in the packaged Electron app on each supported OS.

#### MFR-3: Narrow bridge
The renderer reaches native features only through the nine existing bridge calls, with identical arguments, results, progress events and `{kind, message}` errors.
**Consequences (testable):**
- `contextIsolation` on, `sandbox` on, `nodeIntegration` off; navigation, popups and webview denied; IPC accepted only from the trusted top frame.
- No generic invoke, filesystem, shell, URL-fetch or Node API reaches the renderer; a hostile-renderer test proves unknown commands, wrong payloads and foreign frames are rejected.
- CSP keeps `connect-src 'none'`; credentials and base URLs never enter the renderer.

#### MFR-4: Session and API behaviour (FR-1..FR-6, NFR-3, NFR-5)
**Consequences (testable):**
- `api_request` keeps method and path validation, the `/health/ready` exception, `If-Match`, `Idempotency-Key`, timeouts (10 s, 200 s for AI test and models), disabled redirects, single refresh and retry on 401, and `session_expired`.
- Sign-in uses the system browser, PKCE S256 and state, `klei://auth/callback` or validated loopback; 300 s timeout; a newer sign-in cancels the older one.
- Refresh token only in the OS credential store under a name that does not collide with the Tauri app; no credential store means fail closed, with "Continue without saving" keeping it in memory. No plaintext fallback.

#### MFR-5: Native operations (FR-8, FR-17, FR-21, FR-30)
**Consequences (testable):**
- All `upload_files` kinds (`photo`, `dropped`, `attachment`, `avatar`, `cancel`, `watch`, `unwatch`) and `export_gowns` (`start`, `cancel`) keep their limits, retry, idempotency, progress, rejection reasons and cleanup of partial files.
- The `klei-img` image scheme keeps its path set, headers (`no-store`, `nosniff`), thumbnail-only cache (300 s, 400 entries) and Windows host quirk.
- Drag and drop keeps the 10 s expiry and sends paths only while a watch is active.
- Business content is never written to disk by Chromium (cache, storage, logs, crash dumps) outside the user-chosen export; a sentinel audit proves it (NFR-1 reading: no plaintext persistent cache).

#### MFR-6: Manual update (approved Electron-only exception to FR-43 and AD-15)
No paid Apple Developer membership or other signing certificate exists, and nobody uses the app yet, so the Electron app does **not** download, verify, install or restart itself.
**Consequences (testable):**
- The app can check a version-only manifest (`latest.json`) served by the download site (story 18.5) and shows a non-blocking prompt; the prompt's button opens the download site's page in the system browser. Both URLs come from one fixed build-time base URL that contains the site's secret path; the renderer can neither supply nor read it.
- Opening the page and any restart are refused while `set_dirty(true)` (unsent Draft or Upload review), keeping NFR-3.
- Wording is truthful: "Download update", never "Install and restart". The check sends only version, OS and architecture (NFR-6).
- A failed check leaves the app running and is quiet unless the User asked.
- Package integrity and Gatekeeper/SmartScreen warnings are documented, not claimed solved. Tauri minisign verification and signed-version binding are not promised.

#### MFR-7: Packaging and CI (NFR-4, NFR-9)
**Consequences (testable):**
- Installers for macOS (arm64 and x64), Windows x64 and Linux x64 (AppImage and .deb) build and smoke-launch in CI from new `electron*` workflows; existing workflows are untouched.
- Releases use disjoint tags (`electron-v*`) and are published only to the download site: a separate Thymeleaf application under `electron/download-site/` with its own port and a secret URL path (story 18.5, AD-32). Artifacts are scanned for secrets before publication.
- No signing certificate is used (internal-use app). SHA-256 values are shown beside each file for optional comparison.
- A protection job runs without path filters so a forbidden change to original files cannot evade Electron-only filters.

#### MFR-8: Cutover and rollback
**Consequences (testable):**
- Cutover needs: all stories done, parity matrix green on every OS, NFR-2 start-up ≤ 3 s and idle memory ≤ 300 MB (whole process tree) measured, rollback rehearsed.
- The reviewer records PASS, CONCERNS or FAIL with evidence; the owner alone decides cutover and, separately, retirement. Retirement planning never deletes or edits the Tauri app.
- Rollback = keep distributing the Tauri installers; Electron preview uses a separate app id, profile and credential entry so both can coexist.

### 13.3 Risks
1. Chromium may persist business content (cache, storage, logs) contrary to NFR-1.
2. Credential storage may be weaker than the OS keychain (`safeStorage` plus a file is not equivalent).
3. Unsigned macOS installs trigger Gatekeeper; a manual Update button does not remove that or prove package authenticity.
4. Two apps may fight over `klei://` and the rotating refresh token.
5. Existing screenshot evidence uses a mocked Tauri in plain Chromium; it cannot prove native parity, size or performance.
6. Rewriting about 1,300 lines of Rust in Node can change retry, cancel and error behaviour; the Rust tests are the behaviour specification.
7. The download site is public. Its secret path is obscurity, not access control: a leaked URL, proxy log, browser history or referrer exposes every installer, and the URL is compiled into every installed app. Mitigations: a random token of at least 43 characters, no-referrer, noindex and no-store headers, an empty 404 for everything else, no directory listing, token rotation (installed apps then need a reinstall).

### 13.4 Decisions and open questions
**Decided** (owner, 2026-11-13): port Rust to Node, no sidecar; manual update instead of auto-update; fresh installs only; isolated preview identities; reviewer verifies and owner decides cutover and retirement.
**Open (non-blocking):**
- OQ-M1. **Resolved (owner, 2026-11-13).** Support matrix approved: macOS 15+ (arm64, x64), Windows 11 x64, Ubuntu 24.04 LTS x64. Still bounded by the Electron release chosen in 15.1: if its support window excludes one of these, 15.1 records it and the owner decides.
- OQ-M2. **Resolved (owner, 2026-11-13), subject to evidence.** `@napi-rs/keyring` approved as the keychain candidate; the ZIP library is chosen in story 14.3 after current-version verification. 14.3 must prove keychain parity; any other store (for example `safeStorage` plus a file) needs a new owner decision.
- OQ-M3. **Resolved by the owner (2026-11-13).** Host: a small Thymeleaf download site (story 18.5) on its own port, public, behind a long secret URL path. It lists each version with per-OS downloads (macOS arm64 and x64, Windows x64, Linux AppImage and .deb), and serves the version-only manifest; the Update button opens its page. Integrity: no certificates because the app is for internal use only; SHA-256 values are shown for optional comparison.
- OQ-M5. **Direction chosen by the owner (2026-11-14); values still pending, blocks any distribution.** The site runs as a separate application on the existing Dokploy server, on a new subdomain with the Dokploy HTTPS proxy, container port 8090. Owner actions, none confirmed done: create the subdomain and point it at the server; the secret-path token is generated by the owner and never committed or pasted; the GitHub environment `electron-release` (requires owner approval) holds `ELECTRON_DOWNLOAD_BASE_URL`, `ELECTRON_DEPLOY_HOST`, `ELECTRON_DEPLOY_USER`, `ELECTRON_DEPLOY_KEY`, `ELECTRON_DEPLOY_KNOWN_HOSTS` and variable `ELECTRON_DEPLOY_PATH`. The environment and secrets belong to a repository setting that does not exist yet and is not created by this documentation task.
- OQ-M4. **Resolved for the preview (owner, 2026-11-13).** Preview identity `co.klei.bridal.electron.preview` with loopback sign-in and no `klei://` claim does not conflict with the Tauri app. The production app id and the `klei://` handover are fixed in story 20.4 at cutover, and Electron claims `klei://` only after the owner has retired or uninstalled the Tauri app.
- AD-24 fallback. **Pre-approved (owner, 2026-11-13).** If story 14.4 proves Option B impossible, Option A is allowed, with preload accepting only the nine allowlisted command names and no other dispatch. 14.4 records the failure evidence.
- Owner action (repository settings, not a document edit, not done): after story 19.1 lands, make the protection job a required status check and require review for changes to `.github/workflows/electron*.yml`.
- Branches: `develop`, `main` and `electron-migration` all point at `51949da`; no other commits exist to merge (owner confirmed, 2026-11-13).

### 13.5 Assumptions Index (migration)
- §13 MFR-6 — Manifest is a small JSON with a version string served by the download site (18.5); the renderer's existing install flow tolerates `install_update` resolving after opening the page (unverified until the 18.3 renderer test passes).
- §13.4 OQ-M1 — Matrix approved by the owner; runtime qualification per OS is still unperformed.
- §13.4 OQ-M3 — The owner can run a Java 25 container behind HTTPS on a public port and give the release workflow write access to its data directory; unverified (OQ-M5).
