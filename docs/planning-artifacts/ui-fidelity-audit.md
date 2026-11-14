---
title: UI fidelity audit, desktop vs prototype
date: 2026-11-11
author: Ej, drafted with Claude (UX Designer lead)
status: superseded
superseded_by: docs/planning-artifacts/ui-parity/audit.md (rendered side-by-side audit; this one was a static read)
method: static read of CSS and TSX against the prototype. Nothing was rendered.
---

# UI fidelity audit

## Scope and sources

- App: `desktop/src` (shell, dashboard, upload, gallery, inquiries, assistant, settings, desktop sign-in) plus Auth Web templates.
- Prototype: Open Design project `98402068-55fa-4114-a99b-5b49051d7af2` (`css/base.css`, `shell.css`, `screens.css`, `js/*.js`). Its css and js are identical to `./prototype/v0.1.0`. `drawing-*.png` ignored as asked.
- Specs: `docs/ux-spec.md`, `docs/wireframe-inventory.md`, `docs/planning-artifacts/ux-designs/ux-klei-bridal-dashboard-2026-11-08/{DESIGN,EXPERIENCE}.md`.
- Rule used when sources disagree: **the prototype wins on layout, DESIGN.md wins on polish** (`desktop/src/styles.test.ts` locks the DESIGN.md values).

## Confidence

- **Every severity below is inferred from reading CSS.** No screen was rendered or screenshotted. The repo has no screenshot tooling; jsdom (`css:false`) cannot see layout, overflow, z-index or scroll containers.
- Story 12.1 builds the harness. Its first task re-checks every row marked "static" and corrects severities.
- Why Epic 11 missed these: each of 11.1, 11.2, 11.4, 11.7, 11.11 lists "Not verified: manual side-by-side with the prototype".
- Line numbers come from audits made on 2026-11-11. Confirm before editing.

## Corrected finding

"Fonts missing" was a false alarm. `tokens.css` declares four `@font-face` rules and Vite bundles `inter-latin-{400,500,600,700}.woff2` into `desktop/dist/assets`. Dropped.

## Not bugs (do not revert)

Focus ring `#0063bf`; meta text `--color-faint #716c66`; info pill ink `#0063bf`; h1 tracking -0.033em (prototype -0.024em); stat figure 32/600 (prototype 40/700); no uppercase eyebrow labels; no "N appointments today" in the dashboard date line (11.4 user decision); wireframe-state toggles not built (11.2); photo cap 200 vs prototype 100 (lifted 2026-11-14, Story 21.6) (11.5 U-1).

## Gap table, sorted by severity

| ID | Screen | Prototype says | App does | Sev | Root cause | Fix | Story |
|---|---|---|---|---|---|---|---|
| G-01 | Review | `.rv{grid-template-columns:320px minmax(0,1fr)}` (screens.css:57) | `320px 1fr`. Group name has no `flex:1;min-width:0`, `.pill` has no `flex:none`, so "Low · check" spills over the Silhouette, Fabric and Neckline labels | blocker | styles.css:228, 235, 120 | `minmax(0,1fr)`; `.split>*{min-width:0}`; `.grouplist .name{flex:1;min-width:0}`; `.pill{flex:none}` | 12.5 |
| G-02 | Review | Cards: 12px padding, 1px border, radius-md, gap 8; selected = accent border + 1px accent ring (screens.css:58-61) | List gap 4px, `.row` `border:0`, selected = flat `--color-active` fill that visually bleeds into the form column | blocker | styles.css:229, 230, 232; duplicate `.grouplist .row` at :598; dead `.grouplist .text` at :234 | Bordered cards, gap 8, accent ring when selected, merge the duplicate `.row` rules, delete the dead rule | 12.5 |
| G-03 | Review | `.savebar{position:sticky;bottom:0;padding:16px 32px;margin:24px calc(var(--space-8)*-1) calc(var(--space-12)*-1)}` full-bleed (screens.css:78) | `.footer` sticky inside the padded `.sheet`. No z-index, no bottom clearance, so "AI-written description" ends under it. Positioned `.photos li` and `.menuwrap` paint over it | blocker | styles.css:257 | Negative bleed margins to the page edge, `z-index:5`, `gap` + `flex-wrap`, `.sheet{scroll-padding-bottom:72px}`, `.split{padding-bottom:var(--space-4)}` | 12.5 |
| G-04 | Review | No Actions menu (inline panel, see G-05) | `.tools` has two global rules: topbar `margin-left:auto` (:45) and editor `justify-content:flex-end` (:255). Actions floats right, level with the left `<h2>`. `.form` adds `margin-top:16px` | major | styles.css:45, 255, 131; Review.tsx:294-298 | Scope the topbar rule to `.topbar .tools`; set `.editor.form{margin-top:0}`; interim header row until 12.6 removes the menu | 12.5, 12.6 |
| G-05 | Review | Inline Move/Merge/Split panel; confidence bar with "Confidence N%" and pill; "Photos in this group (N)"; tags in a 3-column grid; thumbs in a 6-column grid; ghost Rewrite; list heading "Gown groups"; list `max-height:600px;overflow-y:auto` | Actions `Menu` (closes on Tab without focus management), stacked chips + select, "N groups found", unbounded list | major (user decision: match prototype) | Review.tsx:294-298, 362-403 | Build the inline panel, stop using `Menu` on Review. Undo stays (assumption, not in prototype) | 12.6 |
| G-06 | Review | Banner "{total} photos → {n} gowns. {low} group(s) with low confidence, worth a look." | **Counts are correct**: `photosIn(groups)` and `groups.length` (Review.tsx:213-222). The reported "3 photos → 3 gowns that look like different groups" is 3 singleton groups: a group of one scores confidence 0 (Low) and is named "Group N". Cause is clustering and sensitivity, not UI | major (copy) | Clusterer.kt:14, 19; GroupingService.kt:227, 238; Epic 10.4 (calibration) still `ready` | UI only: when every group has one photo, add a hint "Each photo landed in its own group. Raise sensitivity in Settings > AI, then upload again." Fix the `uploaded` count (Review.tsx:89 vs the discard text at :191). Backend untouched | 12.5 |
| G-07 | Viewer | n/a | ArrowLeft/Right change the photo behind an open Edit dialog (keys ignored only for INPUT/SELECT/TEXTAREA) | major (bug) | Viewer.tsx:49-58 | Return early while `[role=dialog]` is open | 12.10 |
| G-08 | Viewer | Page head: h1 + "New" pill + 4 actions across the top | h1 and four buttons sit inside the 360px aside; long names and buttons wrap. No New pill | major | Viewer.tsx:150-157 | Hoist head above `.viewer-body`; add New pill | 12.10 |
| G-09 | Dashboard | `grid-4` stat row | `auto-fit minmax(200px,1fr)`. At 1100 the content area is about 810px; 4x200 plus gaps is about 848, so it wraps 3+1 (arithmetic, static) | major | styles.css:557 | `repeat(4,minmax(0,1fr))` | 12.8 |
| G-10 | Frame | `.page` padding `24px 32px 48px`, `max-width:1200` (shell.css:50); `.view` is the only scroller (shell.css:49) | `.sheet` padding 24 all round, no max-width; `.upload` capped at 880 | major | styles.css:57-60, 188 | Padding `24px 32px 48px`, `max-width:1200px`, uncap `.upload` | 12.2 |
| G-11 | Inquiries | Fixed-height 320px grid, each pane scrolls, composer pinned | `.inq-panes` has no height or `min-height:0`; the whole `.sheet` scrolls, so the composer drifts off-screen and the list scrolls with the thread | major | styles.css:328, 346 | Viewport-bound height, `min-height:0` on panes, `overflow-y:auto` on list and messages | 12.11 |
| G-12 | Thread | Mail cards with From/To (screens.css:179-207) | Flat `<ol className="messages">`, no From/To | major | Thread.tsx:136-162 | Render `.mail*` cards | 12.11 |
| G-13 | Settings > Staff | Empty state when the list is empty | `items.length <= 1` shows "No staff yet" even with one real row | major (bug) | StaffTab.tsx:208 | `=== 0` (user decision) | 12.12 |
| G-14 | Settings IA | Away message on Signature tab, Admin-only card (ux-spec S2; prototype settings.js:63-67) | Away is an Admin sub-tab; extra Usage and Keys subs | major (user decision: move) | Settings.tsx:23-31 | Move card to Signature below Studio; remove `away` from `SUBS`; keep old `#/settings/admin/away` hash working or redirect | 12.12 |
| G-15 | Toasts | n/a | `.toasts` fixed bottom-right, z-index 40, 320px: covers Confirm after the "Undone" and "Merged" toasts | major | styles.css:95 | Offset above the save bar on Review, or use a bottom token | 12.5 |
| G-16 | Frame | Fixed 1440 prototype | Every `@media (max-width:760/900/960px)` is dead: Tauri min width is 1100. Real narrow case is 1100, where the Review editor is about 468px | minor | styles.css:262, 315, 347, 482, 573; tauri.conf.json:18-21 | Delete dead rules; add one rule for 1100-1180 where needed | 12.2 |
| G-17 | Frame | Banners above the scroller | Banners inside `<main>` using negative top margin | minor | Shell.tsx:315-323 | Move above `.sheet`, drop negative margin | 12.2 |
| G-18 | Tokens | `--elev-ring`, scrim `.35`, motion tokens, card-hover transition | `var(--space-8, 48px)` fallback never fires because `--space-8` is 32px (:308); scrim `rgb(20 19 18/.4)` hardcoded; zero `transition` declarations; drawer 160ms hardcoded | minor | styles.css:87-91, 308 | Add scrim and motion tokens to DESIGN.md frontmatter, regenerate with `node infra/ci/gen-tokens.mjs`. Never hand-edit `tokens.css` | 12.2 |
| G-19 | Processing | n/a | `.proc-grid{repeat(3,1fr)}` same min-content blowout | minor | styles.css:468-474 | `repeat(3,minmax(0,1fr))` | 12.5 |
| G-20 | Review | n/a | A focused field can sit under the sticky footer; group list Tab-only; `.chip button:focus-visible` has no outline-offset; photo menu opens downward and is clipped by `.sheet` | minor | styles.css:186; Review.tsx | `scroll-padding-bottom`, outline offset; arrow-key list navigation optional | 12.5, 12.6 |
| G-21 | Dashboard stats | Border only, padding 24 | Border plus raised shadow (DESIGN.md says never both), padding 16 | minor | styles.css:558 | Drop shadow, padding 24 | 12.8 |
| G-22 | Dashboard | Date per recent row, time per unread row, AI card "Batch of N photos" + %, links always shown, 4-row skeleton, 144px art with primary CTA | Missing dates and times, links hidden when empty, 3x44px bars (layout shift), 96px art, secondary "Open inbox" | minor | Dashboard.tsx:42, 53, 83, 109, 189, 211, 220 | Align. Empty-state art conflicts with DESIGN.md "widgets never use images": decide in 12.8 | 12.8 |
| G-23 | Gallery | `.field` filters with label above, "All", ghost "Clear filters" after Sort, bordered cards with ellipsis, card-shaped skeleton, art 4 for empty and no-match, bulk bar always present, Upload icon | Label-wrapped selects, "All silhouettes", `link` clear, borderless cards (name and tags wrap at about 190px), 8 bare tiles, art 1, bar appears and jumps, no icon | minor | Gallery.tsx:38, 128-190; styles.css:279-283 | Align | 12.9 |
| G-24 | Top bar | AI button with spark icon, `btn-sm`; profile = initials + name + chevron; `.icon-btn` 36px with 2px dot border; per-item unread dot in bell | Plain `.btn`; full name, no chevron, no `aria-label`, no truncation (squeezes search at 1100); 32px; no dot border, no per-item dot | minor | Shell.tsx:277-298; Bell.tsx:72-108; styles.css:395-396 | Align | 12.4 |
| G-25 | Inquiries misc | Head inside list pane; Reopen in header; missing-state block; compact art; hover card hides on scroll/click; composer link input flexes; crumb in every state; styled status control | h1 above both panes; Reopen inside banner; bare `<p>`; 240px art in a 420px min; `.hc` and scrim both z-index 30; `min-width:16rem` overflow risk; no crumb while loading; native select | minor | Inquiries.tsx:118-170; Thread.tsx:113, 129, 163; CustomerCard.tsx:51-58; Composer.tsx; ClientProfile.tsx:51; styles.css:374, 503-505, 513 | Align; `.hc` z-index 35; `min-width:0;flex:1` | 12.11 |
| G-26 | Settings misc | 720px column, `.srow`, pill-track switch, wrapping tabs, 144px art, mono muted IP in audit | None of those; 160px-wide art on a ~279x640 asset renders ~366px tall; Staff has 6 columns with `.row-actions` nowrap, overflows at 1100 | minor | styles.css:104-112, 160-180; AuditTab.tsx:71; UsageTab.tsx:49; StaffTab.tsx:210 | Align | 12.12 |
| G-27 | Assistant, sign-in | Toggle with `aria-expanded`; New chat and Close in the header; focusable log; `.btn-block`; boot skeleton; Auth Web "Back to sign in" and verify toggle | None; `role="log"` has no `tabIndex`; keychain buttons unspaced; plain "Loading…"; forgot page reads "Back to Klei Bridal" | minor | Shell.tsx:108, 278-284; Assistant.tsx:79-91, 127; App.tsx:28, 87, 123-124; templates/forgot.html, verify.html | Align | 12.13 |
| G-28 | Shared | ErrorBlock Retry is a button | `.link`; `ErrorBlock.lastGood` unused | minor | ui.tsx | Button; delete dead prop | 12.2, 12.3 |
| G-29 | Assistant send | Enter sends | Only when the `enterToSend` pref is on | minor | Assistant.tsx:79-82 | Confirm intended; likely accepted deviation | 12.13 |

## Root-cause groups (fix shared first)

| Group | Cause | Rows | Foundation story |
|---|---|---|---|
| A | Bare `1fr` / `repeat(n,1fr)` grid tracks use `minmax(auto,1fr)`, so min-content blows the column wider | G-01, G-09, G-19 | 12.2 rule, applied in 12.5, 12.8 |
| B | `.sheet` is the padded, only scroller; sticky/fixed children, toasts and pane heights are anchored to the wrong box | G-03, G-10, G-11, G-15, G-17 | 12.2 |
| C | Global selector collisions and duplicates (`.tools`, `.grouplist .row`, dead `.text`) | G-04 | 12.2 |
| D | Dead responsive rules; no 1100px target | G-16 | 12.2 |
| E | No visual verification in any Epic 11 story | all | 12.1 |
| F | Component drift (empty-state art size, card variant, skeletons, switch, tabs) | G-22, G-23, G-26, G-28 | 12.3 |

## Per-screen state coverage

- Loading, empty and error states exist on Inquiries (list and thread) and Settings tabs. Gaps: Thread "missing" is a bare `<p>` (G-25), Staff empty bug (G-13), skeleton shapes differ from the prototype on Dashboard and Gallery (G-22, G-23).
- Dashboard, Gallery, Upload and Review states were audited by reading only.
- Not read in depth: `PreferencesTab`, `NotificationsTab`, `TwoFactorCard`, `KeysTab` internals; `styles.css` lines 1-56 (`.app`/`.sidebar` grid); `.btn` base and `:disabled` rules. Treat Settings internals and the app grid as unaudited until 12.1 renders them.

## Open items

- Undo on Review is kept although the prototype has none (assumption, confirm at review).
- Edit gown tag UI: ux-spec says five comboboxes; app uses select + chips. Left as is, accepted deviation.
- G-22 empty-state art vs DESIGN.md decided in 12.8.
- G-06 root cause (singleton groups) needs Epic 10.4 calibration; out of scope here.

## Sign-off (filled by 12.14)

| Screen | 1100x700 | 1280x800 | axe | Date |
|---|---|---|---|---|
| (pending) | | | | |
