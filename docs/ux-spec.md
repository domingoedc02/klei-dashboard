---
title: Klei Bridal Dashboard UX Spec
status: final
created: 2026-11-08
updated: 2026-11-10
sources: docs/prd.md (final), docs/wireframe-inventory.md, wireframe (read-only)
spines: docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/DESIGN.md, docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/EXPERIENCE.md
---

# UX Spec: Klei Bridal Dashboard

## 0. How to read this

This is the Gate 3 deliverable. It maps every wireframe screen to components and states and summarises the design tokens. The two spines hold the full contract:

- `DESIGN.md` owns how it looks: tokens, components, rules.
- `EXPERIENCE.md` owns how it works: IA, copy, states, interactions, accessibility, desktop-only states, key flows.

If this file and a spine disagree, the spine wins. Layout and flow come from the wireframe; the two design skills (`taste-skill`, `frontend-design`) only govern polish. Wireframe state toggles (Default/Loading/Empty/Error switchers, "View as" role switch, mock timings, canned AI text) are prototype tooling, not product.

Gate 3 approved 2026-11-08. Both spines and this file are `status: final`.

Revised 2026-11-10 (course correction, `docs/planning-artifacts/sprint-change-proposal-2026-11-10.md`): the prototype at `prototype/v0.1.0` wins over this file unless the user says otherwise. Visual tokens, shell, Dashboard, Review save model, Customer wording, Settings IA, Two-factor, Away message and email notifications now follow the prototype. Where the user kept a desktop value for accessibility (focus ring `#0063bf`, meta text `#716c66`), it is named below. Stories: Epic 11.

## 1. Design direction in one page

| Item | Decision |
|---|---|
| Style | Prototype shell: sidebar left, 64px top bar, white work area. Active nav = tinted fill with 600 weight and an icon; active tab = 2px underline. Line icons (SVG) on nav, buttons, bell and toasts. |
| Signature element | The gown mosaic: 2x2 photos, 2px gaps. Only place the UI gets rich. |
| Colour rule | Colour on data. Photos, status pills, one accent element per screen. Under about 3% other coloured pixels. |
| Palette | frame `#f6f5f4`, sheet `#ffffff`, ink `#141312`, muted `#615d59`, accent `#0075de` (fills), accent ink `#0063bf` (text), primary button `#0075de`, danger `#dc2626`. Full list in `DESIGN.md` frontmatter. |
| Type | Inter only, bundled, weights 400/500/600/700 (h1 26/700/-0.033em, section 20/700, body 16/1.5, sm 14, small 12). System monospace (`ui-monospace, "SF Mono", Menlo, monospace`, no font file) for IDs, URLs, key masks, IPs only. Sentence case. |
| Shape | radii 4 / 8 / 12 (controls 4, panels and cards 8, dialog and drawer 12), pills full. |
| Space | 4px base, one gutter (16), content padding 24, control 32, top bar 64. |
| Elevation | `--elev-raised` on menus, search popup, toast, dialog and drawer, as in the prototype. |
| Focus | 2px `#0063bf` ring, 2px offset, everywhere (desktop value kept over the prototype's `#097fe8`: contrast). Meta text `#716c66` kept over `#a39e98` for the same reason. |
| Dark mode | Out of MVP. |

Contrast, measured: all text tiers reach 4.5:1 on frame and sheet (muted 6.0 to 6.5, faint 4.8 to 5.2, accent ink 4.9 to 5.2); control borders reach 3:1 or better. The wireframe's blue pill ink (`#097fe8` on `#f2f9ff`, 3.8:1), focus ring (`#097fe8`, 3.7 to 4.0:1) and meta text (`#a39e98`, 2.7:1) fail and are replaced (deviations kept for accessibility: focus ring `#0063bf`, info pill ink `#0063bf`, meta text `#716c66`). Wireframe green, orange and red pills pass and are used as is. Skeletons shimmer (1.4s) and are static under `prefers-reduced-motion`.

## 2. Shell and global components

| Component | Where | Notes |
|---|---|---|
| App frame + sheet | all signed-in screens | `DESIGN.md` Layout. Content scrolls, sidebar and top bar do not. "Skip to main content" link first in tab order. |
| Sidebar | left, 240 | "K" mark and "Klei Bridal" at top, "Workspace" eyebrow, then icon + label: Dashboard, AI Upload, Gallery, Inquiries (count "N new" only when N > 0), Settings. Items hidden by Permission. No AI credits meter. |
| Top bar | top, 64, padding 24 | Search max 480 with a search icon ("Search gowns, inquiries…"; no hit: `No results for “{q}”`, "Check the spelling or try a gown name, fabric, or client.", **Clear search**); AI Assistant button; bell icon with an 8 px dot when unread (menu 360: "Notifications", **Clear all**, items, footer **Go to Inquiries**; empty "You’re all caught up"); profile pill with 32 px avatar (menu 280: name and role, **Profile settings**, **Sign out**). The brand sits in the sidebar, not here. |
| Banner slot | top of sheet | Connection, update. |
| Toast stack | bottom right, 24 px in | `role="status"` region. Max 3. Success has a check icon and clears after 3200 ms (8 s with Undo); errors keep the red style, use `role="alert"` and persist. |
| Dialog host | centre | 480 wide on `--elev-raised`, one at a time. A destructive dialog focuses Cancel, a safe one its confirm button; Esc closes; focus returns to the opener. |
| Drawer host | right, 400 | AI Assistant. |

## 3. Screen map

Format: route, PRD refs, layout, components, then states. "Loading" is always flat skeletons at final size. "Error" is always inside the failed block with what failed, last good time if known, and Retry. Roles: **A** Admin, **S** Staff, **V** Viewer; permissions follow the matrix.

### Auth Web (server-rendered, system browser, own port)

Shared by A1 to A5 and the return page: centred 440 column on the frame tint, the K mark and "Klei Bridal" above, one raised card (12 px radius, `--elev-raised`) holding title, one-line lede and form, helper links as text buttons. Tokens come from the generated `tokens.css`; Inter is self-hosted; the CSP forbids third-party requests. Plain HTML forms with CSRF tokens work without script. Script (`auth.js`) adds inline validation on focusout (cause plus remedy, `aria-invalid`, `aria-describedby`; the server stays the authority), the busy button ("Signing in…" with a spinner) and the six-box code; it also adds the password-strength meter, show/hide password and resend countdown. Public, no role variants. English only.

**A1 Sign in** (`auth/login`, FR-4)
- Title "Welcome back", lede "Sign in to manage gowns and inquiries." Components: "Work email" input (placeholder `you@kleibridal.com`), password input with show/hide, "Keep me signed in" checkbox, primary **Sign in**, text links "Forgot password?".
- Default: empty form, autofocus email.
- Loading: button disabled, reads "Signing in…" with a spinner (script only; without script the form posts normally).
- Error: alert above the form, "Email or password is incorrect. Check both and try again, or reset your password." Same text for both causes. Email keeps its value, password clears. Rate limit: "Too many attempts. Try again in {n} minutes." (new copy).
- Inline (focusout): empty or malformed email shows "Enter your work email, for example you@kleibridal.com." / "That doesn’t look like an email. Add an @ and a domain, like kleibridal.com.".
- Delta: wireframe's "Accept invite" link becomes helper text "Have an invite? Open the link in your email." because an invite needs its token.

**A2 Accept invite** (`auth/invite`, FR-2)
- Components: pill "Invitation", title "Join Klei Bridal", line "{Inviter} invited you as **{Role}**." ("You were invited as **{Role}**." when the inviter no longer exists), read-only email with hint "Set by your admin. Cannot be changed.", full name, password with 4-bar strength meter and word, confirm password, rule text "At least 8 characters with a number.", primary **Create account** (busy: "Creating account…"), footer "Already have an account? Sign in" (to the return page, since sign-in needs the app's PKCE request).
- Default, Loading as A1.
- Error: field errors under fields, mismatch "Passwords don't match." Expired or used link replaces the form: "This invite link has expired. Ask your admin to send a new one." no form, no link back to sign in beyond a text button.

**A3 Verify email** (`auth/verify`, FR-3)
- Two modes, per wireframe: code (six 48×56 boxes, each `aria-label="Digit n of 6"`, over one hidden input that keeps the form value and one-time-code autofill; paste fills all six; without script the single input shows) and link-sent ("We sent a link to {email}. It expires in 30 minutes.").
- Title "Check your email". Components: code boxes, primary **Verify email** (busy: "Verifying…"), "Didn’t get it?" with text button **Resend** (disabled for 30 s, countdown), expiry helper.
- States: default, loading, resent ("A new code is on its way."), error "That code is incorrect or has expired."

**A4 Forgot password** (`auth/forgot`, FR-5)
- Title "Forgot your password?", lede "Enter your work email and we’ll send a reset link." Components: "Work email", primary **Send reset link** (busy: "Sending…"), text link back.
- States: default, loading, sent (title "Reset link sent", same page and text for known and unknown emails: "If an account exists for {email}, you'll get an email in a minute."), error (send failed: "We couldn't send the email. Try again.").

**A5 Reset password** (`auth/reset`, FR-5)
- Title "Choose a new password", lede "Use at least 8 characters with a number." Components: new password + strength meter, confirm, primary **Update password** (busy: "Updating…").
- States: default, loading, success (text then redirect to A1 with "Password updated. Sign in."), error (expired: "This reset link has expired. Request a new one." with link to A4).

**A6 Return page (new, not in wireframe)** (FR-6)
- Shown after successful sign-in. "You're signed in. You can return to Klei Bridal." with **Open Klei Bridal**. The page itself triggers the Deep Link. Error variant: "Sign-in didn't finish. Close this tab and try again from the app."

### Desktop app

**D1 Dashboard** (`dashboard`, FR-7)
- Layout: header "Good morning, {first name}" (by local time), date line, primary **Upload photos** (A, S). Below: four stat cards (Total gowns, Unread inquiries, Photos this month, Avg. reply time), then widgets: Recent uploads (thumbnails), AI processing (pill, progress bar, **Review groups** when a batch awaits review), Unread inquiries (up to 3). The prototype's "· N appointments today" suffix is omitted (no data source).
- Components: stat card (figure + label), thumbnail row, status pill, progress bar, short list, text buttons to Gallery, Inquiries, Upload.
- Greeting follows the hour in the User's Preferences timezone (05:00 to 11:59 morning, 12:00 to 16:59 afternoon, else evening). Date line "Saturday, Nov 7".
- Stat sub-lines: "+{n} this week" / "Nothing saved yet"; "Oldest from {time or date}" / "Inbox is clear"; "Across {n} gowns" / "Upload to get started"; "Down from {x}" or "Up from {x}" (omitted when no previous mean or equal) / "No replies yet" with figure "—".
- Photos this month = Photos of Gowns saved in the current UTC calendar month. Avg. reply time = mean of first staff reply minus first customer message, answered inquiries whose first message is within 30 days, over the latest 100 inquiries; compared with the 31 to 60 day mean.
- Default, Loading (four stat skeletons and three widget skeletons), Error (per block, others still show).
- AI processing pill: Idle (gray), Checking… (blue, bar and "{step} · {done} of {total} photos"), Ready for review (green, "Grouped into {n} gowns · {k} need a quick look." and **Review groups**), Stopped (orange).
- Empty: Recent uploads "No uploads yet" with sub-copy and **Upload photos** (text only for V). Unread inquiries "No new inquiries" with **Open inbox**; stat "Inbox is clear". Total gowns "Nothing saved yet". AI pill Idle.
- Roles: V sees no Unread inquiries card or widget; the grid reflows to fill.

**U1 AI Upload** (`upload`, FR-8 to FR-12)
- Layout: title "AI Upload". One phase at a time inside the sheet: empty, processing, review, error.
- Empty: drop zone (dashed box, upload-cloud icon, "Drop gown photos here", **Choose photos**, rule text "JPG, PNG or WebP up to 25 MB each. Upload up to 200 at once and AI groups them."). After an upload with rejects: alert "{n} file(s) couldn’t be uploaded." over one line per file with reason (type, size, full, dimensions, unreadable), then **Retry upload** (reopens the picker; hidden when every file was refused as full) and **Dismiss**. The cap stays 200 (user decision 2026-11-10; the prototype's 100 does not apply).
- Processing: h2 "AI is grouping images" with the overall "{pct}%" beside it; four steps listed vertically, current one marked and the done ones checked ("Reading 30 photos", "Grouping images of the same gown", "Tagging silhouette, fabric, neckline", "Writing descriptions"); one overall progress bar; a hidden skeleton grid of six tiles; **Cancel** opens "Cancel grouping?" (**Keep grouping** focused, **Cancel and remove photos** discards the batch). Leaving the screen is safe; progress shows on D1. Grouping includes a check that every photo in a group shows the same gown (FR-9); no extra step is shown.
- Review: banner "{N} photos → {M} gowns. Nothing is saved until you confirm." Left list 320 of groups (thumbnail strip, name, photo count, inline confidence bar and pill), Low · check groups first; selected row takes the active fill. Right editor: name input, five tag comboboxes (Silhouette, Fabric, Neckline, Sleeve, Train), description textarea with **Rewrite**, photo grid. Each photo has **Move to…**, **Split into new gown**, **Discard photo**. Group menu: **Merge into…**. Edits are staged on the client and sent in one `POST /uploads/{id}/commit` (409 shows "This batch changed elsewhere. Reload to see the latest."); **Undo** in the footer steps back through a local stack. Leaving with staged edits asks "Leave without saving?". Sticky footer: "{n} gowns · {m} photos will be added to Gallery", text button **Discard batch**, primary **Confirm and save**.
- Error: block "Grouping stopped at step {n}. Last good {time}." with **Retry**; uploaded photos are kept.
- Dialogs: Discard batch ("Discard this batch?" with the photo count and "This deletes them and can't be undone."; **Keep reviewing** focused, **Discard batch**).
- Confidence: bar plus pill, High (positive), Medium (warning), "Low · check" (negative), shown inline in the group row and editor header; the percentage also sits in the tooltip. The value blends the mean and the weakest pairwise similarity, and a group whose vision check did not run is capped at Medium (FR-9).
- Roles: A, S. V gets Forbidden.

**G1 Gallery** (`gallery`, FR-13, FR-14, FR-17, FR-18)
- Layout: title "Gallery". Filter row: Silhouette, Fabric, Date added (All time, Last 7 days, Last 30 days, Last 90 days), **Clear filters** text button when active. Right side of the row: "{N} of {M} gowns, latest upload first". Select mode: checkbox on cards, **Select all**, "{N} selected", **Download .zip**, **Delete**; actions disabled while N is 0.
- Components: gown card (mosaic, name, "Silhouette, Fabric", photo count, date added; "New" pill on newest only), filter selects, **Show more gowns** text button (page size 48, no infinite scroll).
- Default, Loading (8 skeleton cards), Error (grid replaced by error block, filters stay).
- Empty: "Your gallery is empty" + **Upload photos** (V: sentence only). No-match: "No gowns match these filters" + **Clear filters**.
- Dialogs: Delete gowns (names up to 3 gowns then "and N more", total photo count, "This can't be undone.", Cancel focused, red **Delete N gowns**).
- Roles: A all; S no Delete; V no Select-to-delete, no Delete, keeps Download .zip.

**G2 Gown viewer** (`gallery`, viewer, FR-15, FR-16, FR-17, FR-18)
- Layout: breadcrumb "Gallery / {gown name}" restores filters. Photo stage fills the left (previous/next, "2 of 7", thumbnail strip). Details pane 360 at right.
- Details: name (`title`), attribute groups as neutral tags, photo count, date added, confidence pill, description, **Copy description**.
- Actions: **Edit** (secondary), **Download .zip** (secondary), **Delete** (secondary with danger-ink text).
- Edit dialog: name (required), five tag comboboxes, description; **Cancel**, **Save changes**.
- States: Loading (grey stage tile, skeleton details), Error (a photo that fails: "This photo couldn't be loaded." + Retry; gown fails: error block with Retry), no empty state.
- Roles: A all; S no Delete; V no Edit, no Delete (absent, since the whole control set is per-permission).

**I1 Inquiries** (`inquiries`, FR-19 to FR-22)
- Layout: three panes in the sheet: list 320 | thread | composer under the thread.
- List: chips All, New, Replied, Closed. Row: avatar initial, customer name, subject, preview, time, status pill. Unread rows use `body-strong` name and an 8px accent dot. Selected row takes the active fill.
- Thread header: subject, customer name (dotted underline link to I2; hover or focus opens a hover card with avatar, name, email, city and **View profile**), status select, **Close inquiry** button. Messages in order, each with avatar, name, time, body, attachment chips. Our replies show the sender and signature.
- Composer: To and Subject pre-filled and read-only-looking inputs, icon-only toolbar (bold, italic, underline, bulleted, link), placeholder "Write your reply…", link entry via an Apply bar with auto-prefix, body, attachment list with **Attach files** ("{name} is over 10 MB"), signature preview, hint "Enter to send · Shift+Enter for a new line · Signature added on send", "Saved as draft" status, text button **Discard**, primary **Send**. Empty body: "Write a message before sending."
- States:
  - Loading: skeleton rows and a skeleton thread.
  - Empty list: empty-state art, sub-copy, **Show all** and **View website form**. Empty by filter: "No {status} inquiries".
  - Nothing selected: empty-state art with "Select an inquiry to read it." and **Open first message**.
  - Sending: Send shows spinner, composer disabled.
  - Send failed: inline "Reply not sent. {cause}. Your draft is saved." with **Try again**.
  - Offline: see EXPERIENCE state 1.
- Dialogs: none for Send (the PRD does not require confirm). Discard draft confirms inline with an undo toast "Draft discarded. Undo." (assumption).
- Roles: A, S. S without Close inquiries sees status select and Close disabled with a tooltip. V gets Forbidden.

**I2 Customer profile** (`inquiries/profile`, FR-23). The UI word is "Customer"; API, DB and code keep `client`.
- Layout: breadcrumb "Inquiries › {customer name}" (chevron icon, `aria-current="page"` on the name). Header with 72 px avatar, name (h1), "{city} · Wedding {date}", **Email {first name}** (`mailto:`) and **Edit**. Two columns (`380px` / `1fr`): "Personal details" card (96 px label column: Full name, Email, Phone, City, Wedding date, Heard about us, Customer since, Notes; a missing value shows "—", read as "Not set") and "All inquiries ({n})" card whose rows show subject, preview, time and status pill and open I1. Unknown id: h1 "Customer not found" under the same breadcrumb.
- Components: details card, **Edit** (dialog "Edit customer": phone, city, wedding date, Heard about us select, notes), inquiry rows.
- States: Loading, Error, Not found, empty values show a dash.
- Roles: A, S (edit needs Reply to inquiries). V Forbidden.

**S1 Settings > Profile** (FR-30, FR-44)
- Settings frame: title "Settings", tabs row with roving tabindex and arrow keys: Profile, Signature, Preferences, Notifications, then Admin (A only). Admin opens a second tab row: Staff, Roles and permissions, AI settings, AI usage, Keys, Audit log.
- Components: cards Profile, Password, Two-factor authentication. Profile card: avatar with **Upload photo** and **Remove**, name input, read-only email with helper "Ask an admin to change your email" (assumption), **Save changes**, toast "Profile saved". Password card: current password, new password + strength, confirm, **Update password** (helper: "Other devices will be signed out."). Two-factor card: status, **Set up** (QR code and manual key, 6-digit confirm, then eight one-time recovery codes shown once), **Turn off** (asks for password and a code), **Make new codes** (password and a code). An admin can reset a person's second factor from Staff > Edit; the person sees a notice on the card.
- States: default, loading, error (field errors, wrong current password "Current password is incorrect.", wrong code "That code didn't work. Check the time on your device.").
- Roles: all.

**S2 Settings > Signature** (FR-31, FR-32)
- Layout: label column + panel. Left panel: "Add my signature to replies" toggle, sign-off, name, title, phone. Right: live preview that matches what Send appends, including the studio line set by an Admin.
- Admin-only block below, headed "Studio": studio name and address, which the signature footer uses (FR-31).
- Away message card (A only, as in the wireframe): toggle, schedule (Once, Weekly, Daily with dates and times in the studio timezone), message text. While a closure window is open, one automatic reply goes to each customer who sends a new inquiry, once per customer per window (FR-32; confirmed 2026-11-10).
- Save: one **Save changes** per view.
- Roles: all see the signature; only A sees the Studio block.

**S3 Settings > Preferences** (FR-33)
- Components: cards "Language and region" (Language, disabled select "English (US)" with helper; Timezone; Date format) and "Inquiries" (Start page, "Press Enter to send" toggle).
- Autosave on change, toast "Preference saved". Error: field reverts, toast "Couldn't save. Try again."
- Roles: all.

**S4 Settings > Notifications** (FR-34)
- Components: rows New inquiry, AI finished, Team activity, each with an "In app" toggle and an "Email" toggle. Below, "Email digest" select: Real-time, Hourly, Daily, Weekly, Never. Real-time sends one email per event; Hourly, Daily and Weekly bundle events; Never overrides the email toggles.
- Autosave, toast "Preference saved". V does not see the New inquiry row.
- Roles: all.

**S5 Admin > Staff** (FR-35)
- Components: table (Name with avatar, Email, Role pill, Status pill Active or Invited, Last active), **Invite staff** primary, row actions Edit, Resend invite (Invited only), Delete.
- Dialogs: Invite/Edit staff (name, email, role), Delete ("Delete {name}? They lose access right away. Their uploads and replies stay.").
- Guard: last Admin cannot be deleted or demoted; controls disabled with tooltip "A studio needs at least one admin."
- States: Loading, Error, Empty ("Only you so far. Invite your first staff member." + **Invite staff**).
- Roles: A only.

**S6 Admin > Roles and permissions** (FR-36)
- Table: 8 permissions rows x Admin, Staff, Viewer columns. Admin column locked (disabled, "Locked"). Autosave each toggle, toast "Permission updated". Helper: "Admin permissions are locked. Changes apply the next time a user signs in."
- States: Loading, Error. Roles: A only.

**S7 Admin > AI settings** (FR-37, FR-38)
- Layout: one view, label column + panel, sections in this order: Provider, Models, Grouping, Description tone, Tag taxonomy. One sticky save bar: **Save AI settings**, disabled until a change.
- Provider: preset select (default LiteLLM; OpenAI, OpenRouter, Groq, Ollama, Custom), base URL (mono), API key (write-only: shows `••••••••` with **Replace**, never the value), organization (optional). Models: chat model, vision model, **embedding model** (new, default `dinov2-base`), temperature, max tokens; model lists fill from a successful test. **Test connection** button.
- Test result: three rows, each Connected or Failed with cause: Provider reachable, Models loaded, Image embedding. Status pill above: Not tested, Testing, Connected, Failed. Changing URL, key or organization resets to Not tested.
- Grouping: sensitivity slider 1 to 5 with the label (Very loose, Loose, Balanced, Strict, Very strict); "Use advanced AI model" toggle (disabled with helper when no second vision model is set).
- Description tone: three radios Warm, Editorial, Factual, each with a one-line sample.
- Tag taxonomy: five groups; values as removable tags; **Add** input per group. Removing a value in use opens a dialog "Used by {n} gowns. Reassign them first." (no destructive path in MVP; assumption).
- Validation: URL must start with http:// or https://; key required except for Ollama.
- States: Loading, Error. Roles: A only (needs Change AI settings).

**S8 Admin > Audit log** (FR-40)
- Table: Timestamp, Actor, Action, IP (mono). Newest first. Paged: **Previous**, "Page {n} of {m}", **Next**; 50 rows per page (assumption). Read-only, no row actions.
- States: Loading, Error, Empty "No activity yet". Roles: A with View audit log.

### Global

**X1 AI Assistant drawer** (FR-25 to FR-27)
- Layout: 400 wide, right edge, below top bar. Header "AI Assistant" with **New chat** and **Close**. Body: greeting plus suggestion chips with the prototype's copy (for example "Draft a reply to {first name}", "Suggest gowns for a beach wedding"; story 11.11 confirms the exact strings). Messages: user messages in an active-fill block; assistant replies as plain text; drafted replies get a **Copy** text button. Typing indicator while busy. Input at the foot with **Send**. Disclosure line beneath (see EXPERIENCE copy).
- States: idle; busy (indicator, input still editable, Send disabled); not configured ("The AI provider isn't set up. Ask an admin to set it up in Settings." Admin variant adds **Open AI settings**); failed ("The assistant couldn't answer. Try again." + **Retry**); offline (input disabled).
- Roles: A, S with Reply to inquiries. Others: button absent.

**X2 Top bar**
- Search popover: input with `/` and `Cmd/Ctrl+K` focus; results grouped Gowns then Inquiries, at most 6 in total. Gown row: tiny mosaic, name, "Silhouette, Fabric". Inquiry row: avatar, customer name, subject. States: loading (three skeleton rows), results, none (`No results for “q”` + **Clear search**), error ("Search isn't available. Retry"). V sees Gowns only. Matching is whole-word, case-insensitive (accepted limit); the empty state hint says "Search matches whole words."
- Notifications popover: list with unread dot, title, time; **Clear all**; empty "You're all caught up". Errors: "Couldn't load notifications. Retry".
- Profile menu: name, role, **Profile settings**, **Sign out**. The wireframe's role toggle is removed.

**X3 Dialogs, toasts and empty states**
- Dialogs: Edit gown, Delete gowns, Discard batch, Invite or edit staff, Delete staff, Edit customer, Taxonomy value in use, Discard changes?, Session expired. Behaviour in EXPERIENCE `Component Patterns`.
- Toasts (wording is verb-consistent with the button): "Reply sent to {first name}", "{N} gowns saved to Gallery", "Profile saved", "Changes saved", "Description copied", "Preference saved", "Permission updated", "Invite re-sent to {email}", "Back online", "Updated to version {x}".
- Empty-state art: the six line-art PNGs (`assets/empty/empty-gown-1..6.png`) are reused for whole-view empties only (Gallery, Upload, Inquiries, Staff, Notifications, Search). Never in widgets. They are copied into the repo; the wireframe folder is not touched.

## 4. Desktop-only states

Specified in full in `EXPERIENCE.md` section "Responsive & Platform": (1) connection-loss banner, (2) session expired, (3) update prompt FR-43, (4) Deep Link return, (5) keychain unavailable, (6) signed-out screen, (7) forbidden view. Summary of look:

| State | Surface | Copy |
|---|---|---|
| Connection loss | Warning banner at top of sheet | Offline. Reconnecting… / Offline, reply not sent |
| Update | Info banner with **Restart and install** and **Later** | Version {x} is ready. Restart to install. |
| Deep Link wait | Full-sheet quiet state | Finish signing in in your browser |
| Deep Link failure | Same, with **Retry** | Sign-in didn't finish. Try again. |
| Keychain | Full-sheet error | Can't reach your system keychain. Klei Bridal needs it to keep you signed in. |

## 5. Removed or changed from the wireframe

| Wireframe | Now | Why |
|---|---|---|
| In-thread AI panel and tone chips (screenshots) | Absent | Dropped for good. |
| Reply templates, Share-in-a-reply | Absent | Dropped for good. |
| 2FA card (S1), "2FA requirement" audit copy | Present (reinstated 2026-11-10) | New FR-44, TOTP; prototype wins. |
| "AI credits 640 / 1,000" in sidebar | Absent | Not in MVP (OPEN QUESTION 6 of the PRD). |
| Profile menu role toggle, "View as" | Absent | Prototype tooling; real roles. |
| "Accept invite" link on sign-in | Helper text | An invite needs its token. |
| Away message, closure schedule | Present (reinstated 2026-11-10), Admin only | FR-32; the Gate 3 deferral is lifted by the user. |
| Notification email toggles, digest frequency | Present, sent for real (reinstated 2026-11-10) | FR-34; the Gate 3 deferral is lifted by the user. |
| Embedding model field | Added to S7 | User-confirmed scope change. |
| Pill-blue and focus colour `#097fe8`, meta text `#a39e98` | `#0063bf` ring, `#716c66` meta (all other tokens follow the prototype) | Contrast; the only token deviations. |
| Client-side model fetch in Test connection | Server-side, three-row result | NFR, FR-37. |
| Client profile read-only | "Customer" profile with Edit customer dialog for those who can reply | FR-23; word "Customer" in the UI only. |
| Dashboard unframed blocks, "never a greeting" | Prototype greeting, four stat cards, widgets (no appointments suffix) | Prototype wins (user, 2026-11-10). |
| Review saves each edit at once | Edits staged; one **Confirm and save** | Prototype wins (user, 2026-11-10). |
| Settings: Profile, Signature, Preferences, Notifications, Staff, Roles, AI settings, Audit log as one row | Four personal tabs + Admin with sub-tabs | Prototype IA (user, 2026-11-10); AI usage and Keys kept as Admin sub-tabs. |
| Framed sheet, 48px bar, flat, radii 16/12/8/6 | Prototype shell, 64px bar, radii 4/8/12, `--elev-raised` | Prototype wins (user, 2026-11-10). |

## 6. Assumptions

- A-UX1. The wireframe JS is authoritative over screenshots (inherited from the brief).
- A-UX2. English (US) only; no dark mode; no small-window or touch layout. Minimum window 1100x700.
- A-UX3. Inter and IBM Plex Mono are bundled and self-hosted in both surfaces. Both are open-licensed.
- A-UX4. The Auth Web uses the same generated `tokens.css`, so one change updates both surfaces.
- A-UX5. Confidence shows as an inline bar plus a word pill (prototype); the percentage sits in a tooltip. Superseded 2026-11-10: was a word pill alone.
- A-UX6. Gallery pages 48 gowns at a time with **Show more gowns**; Audit log pages 50 rows.
- A-UX7. Absent versus disabled: whole surfaces are absent; single controls inside an open surface are disabled with a tooltip.
- A-UX8. Admin edits the studio name and address in a "Studio" block of the Signature tab (PRD says Admin sets it; location is not in the wireframe).
- A-UX15. Superseded 2026-11-10. The Gate 3 deferral of Away message, closure schedule, email notification toggles and digest is lifted by the user ("build all, full stack"): FR-32 and FR-34 are reinstated, with email actually sent.
- A-UX16. Gate 3 "Q2: No" is read as: Viewer gets no Inquiries and no Assistant (PRD OQ 11 as written). `[ASSUMPTION]`
- A-UX9. Email is not self-editable (PRD FR-30 lists name, avatar, password only).
- A-UX10. Connection state is detected by a health ping every 5 s while offline and on request failure.
- A-UX11. Draft discard has an undo toast instead of a confirm dialog.
- A-UX12. Deep Link wait times out after 5 minutes.
- A-UX13. The six empty-state PNGs may be reused in the product (ownership confirmed by user at Gate 3).
- A-UX14. The studio mark is a text wordmark "Klei Bridal" (user, Gate 3: text format for now).

## 7. Decisions at Gate 3 and remaining OPEN QUESTIONs

Decided by the user at Gate 3:
- Away message, closure schedule, email notification toggles and digest: deferred at Gate 3, reinstated 2026-11-10 (A-UX15 superseded).
- Viewer: no Inquiries, no Assistant (A-UX16).
- Studio logo: none for now. Text wordmark "Klei Bridal" (A-UX14).
- Empty-state art (six PNGs, three JPEGs): yours to ship, reuse approved (A-UX13).

Still open, non-blocking, defaults stand:
1. **Update host.** "dokploy github" read as Dokploy deploys from the GitHub repo and GitHub Releases hosts the updater manifest and packages (PRD OQ 13). Architect confirms in an ADR.
2. **"The developer will do!"** Read as toolchain installs (JDK LTS, Maven, Rust) and release setup being done by the developer. Architect lists them as prerequisites.
3. **Confidence percentage.** Bar plus word pill, percentage in tooltip only (A-UX5).
5. **Photo cap, 2FA, away auto-send** (2026-11-10, answered). Cap stays 200 (OQ 14); automatic away reply to customers confirmed (OQ 15); zxing QR library approved, Admin-required 2FA not built (OQ 16).
4. **Studio name and address** live in a Studio block on the Signature tab, Admin only (A-UX8).

Spikes the Architect owns that touch UX: Deep Link on Linux (loopback fallback shown as the same states), Tauri updater on unsigned builds (first-install OS warnings), and how photos reach the embedding model (affects Upload progress timing, not screens).

## 8. Handoff

- Architect: record Spring Boot (decided) with Thymeleaf Auth Web on a separate port; serve one generated `tokens.css`; provide the four connection-state signals the app needs (health ping, 401 refresh failure, request error classes, update manifest); define the Test connection response shape as three checks.
- Scrum Master: stories for the shell and tokens, then each screen group; the Auth Web stories (A1 to A6) sit after auth backend.
- QA: accessibility checks per EXPERIENCE `Accessibility Floor`; the keyboard map; the role-variant table in EXPERIENCE `State Patterns` is the acceptance matrix for Viewer behaviour.
