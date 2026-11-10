---
name: Klei Bridal Dashboard
status: final
sources: docs/prd.md, docs/wireframe-inventory.md, DESIGN.md
updated: 2026-11-08
---

# Klei Bridal Dashboard: Experience Spine

Behaviour, structure, copy and states. Visual identity is `DESIGN.md`; tokens are referenced as `{path.to.token}`. The per-screen component and state matrix is in `docs/ux-spec.md` section 3 and is derived from this file. On conflict, this file and `DESIGN.md` win over the matrix, the wireframe and any mock.

## Foundation

- **Form factor:** desktop app (Tauri webview) for macOS, Windows, Linux, plus **one server-rendered surface**: the Auth Web (Spring MVC + Thymeleaf) opened in the system browser for invite, verify, sign-in and reset. No mobile, no responsive web.
- **Window:** minimum 1100x700. Designed for 1280 to 1920 wide.
- **UI system:** none inherited. The app webview uses a small set of hand-built components that match `DESIGN.md` `components`. The Auth Web consumes the same tokens through one generated `tokens.css`, so both surfaces cannot drift.
- **Users:** about five staff in one studio (Admin, Staff, Viewer). Used all day, mostly mouse and keyboard, on a desk in the studio.
- **Tenancy:** one workspace. No workspace switcher.
- **Language:** English (US) only. Copy is in `Voice and Tone`.
- **Layout fidelity:** layout and flow follow the wireframe. Dropped for good and absent everywhere: per-thread AI panel, reply templates, Share-in-a-reply, 2FA, AI credits meter. Deferred and absent (user, Gate 3): public inquiry intake form, Away Message and closure schedule, email notification toggles and digest.

## Information Architecture

Sidebar (always visible, labels from the wireframe):

| Item | Route | Who sees it | Notes |
|---|---|---|---|
| Dashboard | `dashboard` | all | Widgets scoped to Permissions. |
| AI Upload | `upload` | Upload images | Hidden for Viewer. |
| Gallery | `gallery` | all | Viewer is read-only. |
| Inquiries | `inquiries` | Reply to inquiries or any inbox access | Hidden for Viewer. Count pill "N new" only when N > 0. |
| Settings | `settings` | all | Tabs below. |

Top bar (always visible): product mark and "Klei Bridal" at left, search (548 wide, centred), AI Assistant button, notifications bell (dot when unread), profile menu (Profile settings, Sign out). The AI Assistant button is hidden when the User lacks Reply to inquiries.

Settings tabs: Profile, Signature, Preferences, Notifications for everyone; Admin tabs Staff, Roles & permissions, AI settings, Audit log visible only to roles holding the matching Permission, with a quiet "Admin only" note on the group. A tab the User cannot use is not rendered.

Auth Web routes (system browser): sign in, accept invite, verify email, forgot password, reset password, plus a return page that hands off to the app (Deep Link).

Closure: every stated need has a surface. Upload, review and save (U1), Gallery (G1, G2), inquiry handling (I1, I2), AI help (X1), admin (S5 to S8), key rotation and leak suite are operator tooling with no UI (FR-41, FR-42) and have no screen on purpose.

Entry rules:
- After Deep Link return the app opens the User's start page preference, default Dashboard.
- Search hit opens the Gallery viewer (G2) or the Inquiry thread (I1). Notification opens its target route.
- A route the role cannot use renders the **Forbidden** view, not a blank or a redirect loop.

## Voice and Tone

Plain, direct, trade words. Sentence case. Active voice. Errors say what happened and what to do, never apologise. An action keeps one name from button to toast ("Save 10 gowns" then "10 gowns saved to Gallery"). No exclamation marks, no emoji, no jokes.

Words of the trade: gown, folder (only inside Gallery language, as the wireframe does), silhouette, fabric, neckline, sleeve, train, inquiry, fitting, reply, studio, staff.

Copy fixed by the PRD, use verbatim:

| Where | Copy |
|---|---|
| Invite expired | This invite link has expired. Ask your admin to send a new one. |
| Verify wrong code | That code is incorrect or has expired. |
| Sign-in failure | Email or password is incorrect. |
| Forgot sent | If an account exists for {email}, you'll get an email in a minute. |
| Reset expired | This reset link has expired. Request a new one. |
| Gallery empty | Your gallery is empty. Action: Upload photos |
| Gallery no match | No gowns match these filters. Action: Clear filters |
| Gallery header | {N} of {M} gowns, latest upload first |
| Dashboard empty | No uploads yet. Action: Upload photos |
| Search none | No results for “{q}”. Action: Clear search |
| Notifications empty | You're all caught up |
| Closed inquiry | This inquiry is closed. Reopen it to reply. |
| Reply sent | Reply sent to {first name} |
| Draft | Saved as draft |
| Save batch | {N} gowns saved to Gallery |
| Confidence | High, Medium, Low · check (the middle dot is part of the PRD label) |
| Forbidden | You don't have access |
| Offline | Offline. Reconnecting… |
| Offline with reply | Offline, reply not sent |

Copy written here (new, for confirmation in the OPEN QUESTIONs): connection banner restored "Back online"; update prompt "Version {x} is ready. Restart to install."; Deep Link waiting "Finish signing in in your browser"; keychain failure "Can't reach your system keychain. Klei Bridal needs it to keep you signed in."

Assistant disclosure (FR-27), shown at the foot of the drawer: "Your messages, and any inquiry or gown text needed to answer, are sent to {provider host}. The assistant can't send email or change anything."

## Component Patterns

Behaviour only. Looks are in `DESIGN.md` `components`.

- **Gown card (G1, D1, U1):** click opens the viewer. The checkbox selects without opening. `Space` toggles selection when focused. Mosaic shows the first four Photos in order; fewer than four leaves grey tiles at final size.
- **Combobox (tags, U1/G2 edit, S7 taxonomy):** type to filter Taxonomy values, `Enter` adds, `Backspace` removes the last tag. Free text that is not in the Taxonomy is rejected with "Pick a value from the list." Multiple values per type.
- **Filter chips (I1) and Select filters (G1):** one active value per group. Active state is selected fill plus check, announced as "selected". "Clear filters" is always visible once any filter is active.
- **Table (S5, S8):** header is a `th scope=col`. Sorting is not offered unless stated. Row actions are icon buttons with names ("Edit Jonah Reyes").
- **Permission matrix (S6):** `role=grid`-free simple table of checkboxes. The Admin column is disabled and exposed as "locked". Each toggle saves on change with a toast "Permission updated" and the note "Changes apply the next time a user signs in" stays visible.
- **Rich-text composer (I1):** B, I, U, bullet list, numbered list, link. Paste is sanitised to the allow-list (B, I, U, STRONG, EM, UL, OL, LI, A, BR, DIV). Links get `rel=noopener`. Attachments list with remove buttons. Signature preview is read-only below the body.
- **Dialog:** focus moves into the dialog, returns to the trigger on close, `Esc` closes. Destructive dialogs focus Cancel. A dialog never stacks on another dialog.
- **Drawer (X1):** pushes no layout. Focus moves to the input on open. `Esc` closes it only when no menu or dialog is open. Closing returns focus to the topbar button. History persists until New chat.
- **Popover (search, notifications, profile):** opens on click or `Enter`, closes on `Esc` or outside click, arrow keys move through items.
- **Banner:** sits above the page content, pushes it down 40px, no layout jump when it appears or goes. Two banners at once stack, connection first.
- **Toast:** polite live region. At most 3 visible. Errors persist until dismissed.
- **Avatar:** initial plus tint from user id hash, 28px. Photo replaces it when set.

## State Patterns

Every data view has four states. Loading, empty and error appear inside the frame of the block they replace, never as a page takeover.

| State | Pattern |
|---|---|
| **Default** | Data as designed. Zeros are printed ("0 unread"). Missing values are a grey dash. |
| **Loading** | Flat skeleton bars at the real size of the content. No shimmer, no spinner for lists. A button that waits shows its label plus a small spinner and is disabled. Inputs keep their value. Show the skeleton after 150 ms to avoid flashing. |
| **Empty** | Block keeps its title and frame. One sentence in a dashed box, one next action, trade words. A whole-view empty may add one of the six line-art images. |
| **Error** | Inside the failed block: what failed, when data was last good (if any), Retry text button. Form errors sit under the field, plus a summary line at the form top when more than one. Focus moves to the first invalid field on submit. |

Role variants. Permissions come from the Permission matrix, not the role name; the table names the default roles.

| Surface | Admin | Staff | Viewer |
|---|---|---|---|
| Dashboard | 4 widgets | 4 widgets | 3 widgets, no Unread inquiries |
| AI Upload | yes | yes | not shown, direct route gives Forbidden |
| Gallery | all actions | upload, edit, download; no delete | read and download only |
| Gown viewer | Edit, Download .zip, Copy description, Delete | Edit, Download .zip, Copy description | Download .zip, Copy description |
| Inquiries | all | all, no Close if Close inquiries is off | not shown |
| AI Assistant | yes | yes | not shown (needs Reply to inquiries) |
| Settings | 4 personal tabs + 4 admin tabs | 4 personal tabs | 4 personal tabs |
| Signature tab | plus Studio name and address | personal only | personal only |

An action the User lacks is **absent** when it belongs to a whole surface, and **disabled with a tooltip "You don't have permission"** when it is one control inside a surface they can open (for example Delete on a viewer a Staff opens). Viewer's download action stays available.

Desktop-only states are specified in `Responsive & Platform` below.

## Interaction Primitives

**Keyboard**
- `Tab` and `Shift+Tab` follow visual order. Every control is reachable. Focus ring is `{colors.focus-ring}` 2px with 2px offset.
- `/` or `Cmd/Ctrl+K` focuses search. `Esc` closes the top-most popover, then dialog, then drawer.
- Assistant input: `Enter` sends, `Shift+Enter` newline. Composer follows "Press Enter to send" from Preferences; default off, so `Cmd/Ctrl+Enter` sends.
- Arrow keys move in menus, search results, tab lists, and the photo viewer (left and right for previous and next).

**Mouse**
- Click to act. Drag and drop only for adding Photos (U1) and not for reordering. Photo moves are done with a menu, which keeps them keyboard-accessible.

**Feedback**
- Every saved change gets a toast or inline "Saved" within 300 ms of the server answering.
- Explicit-save views (Profile, Signature, AI provider): one Save button per view, disabled until a change. Unsaved changes prompt "Discard changes?" when leaving the tab.
- Autosave controls (Preferences, Notifications, Roles): each toggle saves on change with a toast, as the wireframe does. One model per view, never mixed.
- Long work (Upload processing) shows determinate progress by the four named steps and survives leaving the screen. A badge on the sidebar item "AI Upload" is **not** added; progress shows on the Dashboard widget and in the notification on completion.

**Banned:** infinite scroll (Gallery and Audit log are paged), hover-only affordances, modal stacks, auto-playing motion, sound.

## Accessibility Floor

Target WCAG 2.1 AA (NFR-7). Behavioural rules here; colour contrast is in `DESIGN.md` (every text pair 4.5:1 or better, control borders 3:1, verified).

- Landmarks: sidebar `nav`, top bar `header`, sheet `main`, drawer `complementary` with a label. One `h1` per screen, the noun title.
- Screen-reader names for icon buttons, avatars, and the New pill ("New gown").
- Status is never colour alone: Confidence pills carry words, selected chips carry a check, errors carry text.
- Live regions: toasts and the connection banner are `role=status` (polite); form error summary is `role=alert`.
- Dialogs trap focus and restore it. The drawer does not trap focus but returns it on close.
- Photos have alt text from the gown name and position ("{gown name}, photo 2 of 7"), never a client name. Mosaic tiles are decorative inside a labelled link.
- Motion: only dialog, drawer and popover transitions (120 ms, opacity and 8px translate). Under `prefers-reduced-motion` they are instant.
- Target size at least 24x24 CSS px. Controls are 32px.
- The Auth Web works without script for sign-in, forgot and reset (server-rendered forms with CSRF); the strength meter and resend timer are progressive enhancement.
- Text can be resized to 200% in the app without loss: the sheet scrolls, the sidebar keeps its width.

## Responsive & Platform

**Window.** Fixed layout from 1100 wide. Under 1100 the sheet scrolls horizontally rather than reflowing (assumption: nobody runs the app narrower than the minimum, which Tauri enforces).

**OS differences.** Window chrome is the native one. Shortcuts show `Cmd` on macOS and `Ctrl` elsewhere. Fonts are bundled so rendering matches across systems. The keychain label is "Keychain" on macOS, "Credential Manager" on Windows, "Secret Service" on Linux, used only in the keychain error copy.

**Desktop-only states** (NFR-3, FR-6, FR-43). Each has trigger, look, behaviour and exit.

1. **Connection-loss banner**
   - Trigger: API unreachable (two failed health pings 5 s apart, or a network error on a request).
   - Look: warning banner at top of the sheet, text "Offline. Reconnecting…" with a small spinner. After 30 s adds a "Retry now" text button.
   - Behaviour: reads already on screen stay visible and are marked stale by a "Last updated {time}" `small` line at the page's top right. All writes are disabled with the tooltip "You're offline". Exceptions kept in memory only: an unsent Reply Draft (banner reads "Offline, reply not sent" while a composer has text) and Upload review edits. Nothing decrypted is written to disk.
   - Exit: success ping hides the banner, shows a toast "Back online", re-enables writes, and refetches the visible block. Composer Send re-enables; nothing is sent automatically.
2. **Session expired**
   - Trigger: 401 that a refresh cannot recover, or sign-out from another device.
   - Look: dialog "You've been signed out. Sign in to continue." with one action "Sign in".
   - Behaviour: unsent Draft and Upload review edits stay in memory while the dialog is open. "Sign in" opens the Auth Web. After Deep Link return the app restores the route and offers the Draft back.
   - Exit: signed in again, or the user quits (edits are lost, and the dialog says so in one line).
3. **Update prompt (FR-43)**
   - Trigger: check at start and every 24 h finds a newer signed version.
   - Look: info banner "Version {x} is ready. Restart to install." with **Restart and install** (primary) and **Later** (text). Non-blocking.
   - Behaviour: if an unsent Draft or an Upload review is in progress, the button is replaced by "Finish your work, then restart" and **Restart and install** is disabled until both are clear. Download is background. On failed check or install: a toast "Couldn't update. You're still on version {y}." and the app keeps working. "Later" hides until the next 24 h check.
   - Exit: user confirms and the app restarts; or it is dismissed. On first run after an update, a toast "Updated to version {x}".
   - First install on an unsigned build shows OS warnings; that is documented in the install guide, not in the app.
4. **Deep Link return (sign-in handoff)**
   - Trigger: user chooses Sign in in the app.
   - Look: app shows a quiet full-sheet state "Finish signing in in your browser" with **Open browser again** and **Cancel**. No form, no credential field.
   - Behaviour: the app opens the Auth Web in the system browser and waits for the Deep Link carrying a one-time code, which it exchanges with PKCE. The browser's last page says "You're signed in. You can return to Klei Bridal." with an "Open Klei Bridal" button as fallback.
   - Failure: no return in 5 minutes, or code rejected, shows "Sign-in didn't finish. Try again." with Retry. Linux fallback uses a loopback redirect; the user sees the same states.
   - Exit: success opens the start page; Cancel returns to the signed-out screen.
5. **Keychain unavailable (fail-closed)**
   - Trigger: OS keychain read or write fails.
   - Look: full-sheet error with the keychain-copy above and **Try again**. No fallback to disk or localStorage.
6. **Signed-out screen**
   - The only in-app screen before sign-in: product mark, one sentence ("Sign in to open the studio dashboard"), **Sign in** button. It starts state 4.
7. **Forbidden view**
   - Look: sheet title "You don't have access", one sentence "Your role doesn't include this page. Ask an admin if you need it." and a button back to Dashboard.

## Key Flows

Mirror PRD journeys UJ-1 to UJ-4.

### UJ-1. Eleanor sets up the studio and brings Jonah on
1. Eleanor, Admin, opens the app for the first time. Signed-out screen. **Sign in** opens the Auth Web.
2. Signs in on the Auth Web. Return page, Deep Link, Dashboard.
3. Settings > AI settings. Picks LiteLLM preset. Base URL and embedding model `dinov2-base` are pre-filled. Pastes the API key, which then shows as masked and write-only.
4. **Test connection.** Three result rows appear (Provider reachable, Models loaded, Image embedding). **Climax:** all three read Connected, the model list fills the chat and vision selects, and the status pill turns green "Connected".
5. Staff > Invite. Jonah is added with role Staff, row shows "Invited". Jonah gets an email, opens it on the Auth Web, sets name and password, verifies email, and lands on the Dashboard.
6. **Resolution:** Staff shows Jonah as Active. Audit log shows both actions.
- Edge: expired invite shows the fixed copy on the Auth Web page; Eleanor uses **Resend invite** in the row menu.

### UJ-2. Marcus turns 30 photos into 10 gowns
1. Marcus, Staff, opens AI Upload. Empty state shows the drop zone.
2. Drops 30 photos. A rejected-files list appears under the zone (type or size) while accepted ones begin.
3. Progress runs through four named steps with a count. Marcus switches to Gallery to check something; the Dashboard widget keeps showing the step.
4. Notification "AI finished grouping 30 images into 10 gowns". Review shows 10 groups, Low-confidence first.
5. On one Low · check group he opens the photo menu, **Move to…**, picks another group. The old group updates its mosaic.
6. **Save 10 gowns.** **Climax:** Gallery opens with 10 new gowns, the newest marked New, toast "10 gowns saved to Gallery".
7. **Resolution:** Upload returns to its empty state.
- Edge: Provider unreachable mid-batch. The progress block becomes an error ("Grouping stopped at step 2. Last good: 14:02") with **Retry**; uploaded photos are kept.

### UJ-3. Tessa answers Hannah's fitting request
1. Tessa, Staff, sees "3 new" on Inquiries. Opens Hannah Whitfield's row; the row turns read and the thread opens.
2. Opens the AI Assistant drawer. Asks "Suggest gowns for Hannah", then "Draft a reply".
3. Copies the draft text from the chat into the composer. Edits it. Signature is appended below.
4. **Send.** **Climax:** toast "Reply sent to Hannah", status pill switches to Replied, the sidebar count drops.
5. **Resolution:** thread shows her reply; composer collapses to "Write a reply".
- Edge: connection drops while composing. Banner reads "Offline, reply not sent", Send is disabled, the Draft stays. On reconnect the toast says "Back online" and Send enables.

### UJ-4. Ines, a Viewer, browses the catalogue
1. Ines signs in. Dashboard shows three widgets; no inquiry widget.
2. Gallery. Sets Silhouette = Mermaid and Fabric = Lace. Header reads "4 of 128 gowns, latest upload first".
3. Opens a gown. **Climax:** photos, attributes and description show; Edit and Delete are absent; Download .zip and Copy description work.
4. **Resolution:** Inquiries and Admin are not in the sidebar.
- Edge: she pastes an admin route in a deep link. Forbidden view: "You don't have access".

### Support flows (no named journey)
- **Forgot password:** A1 > A4 > email > A5 > A1. A4 always shows the neutral confirmation.
- **Delete gowns:** select, Delete, dialog names the gowns and photo count, states it can't be undone, Cancel focused, red confirm, toast.
- **Update:** banner, user finishes draft, Restart and install, relaunch, "Updated to version {x}".

## Inspiration & Anti-patterns

Inspired by calm back-office tools that let the work be the colour (Notion's flat surfaces, Linear's list-and-detail). Anti-patterns avoided: dashboards of coloured KPI tiles, AI sparkle branding, chat bubbles as the main surface, toast-for-everything.
