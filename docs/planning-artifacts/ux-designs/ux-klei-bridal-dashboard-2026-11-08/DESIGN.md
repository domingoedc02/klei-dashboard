---
name: Klei Bridal Dashboard
description: Quiet staff workspace for a bridal studio. A tinted sidebar holds the navigation, a white page holds the work, and the gown photos are the only colour that matters.
status: final
sources: docs/prd.md, docs/wireframe-inventory.md, wireframe tokens (css/base.css, index.html :root)
updated: 2026-11-10
colors:
  frame: '#f6f5f4'
  sheet: '#ffffff'
  sheet-edge: '#e7e5e2'
  rule: '#efedeb'
  active: '#ebe9e7'
  hover: '#f3f1ef'
  skeleton: '#ecebea'
  ink: '#141312'
  ink-2: '#31302e'
  muted: '#615d59'
  faint: '#716c66'
  control-edge: '#8a8580'
  accent: '#0075de'
  accent-ink: '#0063bf'
  accent-hover: '#005bab'
  accent-tint: '#e6f1fc'
  focus-ring: '#0063bf'
  primary: '#0075de'
  primary-text: '#ffffff'
  primary-hover: '#005bab'
  danger: '#dc2626'
  danger-hover: '#b91c1c'
  danger-ink: '#c4242a'
  positive-ink: '#247b50'
  pill-pos-ink: '#14802a'
  pill-pos-bg: '#e8faf0'
  pill-warn-ink: '#b34700'
  pill-warn-bg: '#fff3e8'
  pill-warn-edge: '#fde68a'
  pill-neg-ink: '#b91c1c'
  pill-neg-bg: '#fdecec'
  pill-info-ink: '#0063bf'
  pill-info-bg: '#f2f9ff'
  pill-neutral-ink: '#615d59'
  pill-neutral-bg: 'rgba(0, 0, 0, 0.05)'
  banner-info-ink: '#0a3d75'
  avatar-blue-ink: '#0a4d8c'
  avatar-blue-bg: '#e3eefb'
  avatar-green-ink: '#14532d'
  avatar-green-bg: '#def3e6'
  avatar-amber-ink: '#7a4a00'
  avatar-amber-bg: '#fbeccb'
  avatar-rose-ink: '#8a1f5a'
  avatar-rose-bg: '#fbe3f0'
  avatar-stone-ink: '#3d3a36'
  avatar-stone-bg: '#e9e6e1'
typography:
  title:
    fontFamily: 'Inter'
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.033em
  section:
    fontFamily: 'Inter'
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 25px
    letterSpacing: -0.012em
  body:
    fontFamily: 'Inter'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  sm:
    fontFamily: 'Inter'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-strong:
    fontFamily: 'Inter'
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  small:
    fontFamily: 'Inter'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  table-head:
    fontFamily: 'Inter'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  figure:
    fontFamily: 'Inter'
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  pill:
    fontFamily: 'Inter'
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  mono:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '12': 48px
  gutter: 16px
  content-pad: 24px
  sidebar: 240px
  topbar: 64px
  control: 32px
  row: 48px
  drawer: 400px
  list-pane: 320px
  detail-pane: 360px
  dialog: 480px
  auth-col: 440px
  search: 480px
elevation:
  raised: 'rgba(0, 0, 0, 0.04) 0px 4px 18px, rgba(0, 0, 0, 0.027) 0px 2px 7.85px, rgba(0, 0, 0, 0.02) 0px 0.8px 2.93px, rgba(0, 0, 0, 0.01) 0px 0.175px 1.04px'
components:
  app-frame:
    background: '{colors.frame}'
  sheet:
    background: '{colors.sheet}'
    padding: '{spacing.content-pad} {spacing.8} {spacing.12}'
  nav-item:
    foreground: '{colors.ink-2}'
    typography: '{typography.sm}'
    height: '{spacing.control}'
    radius: '{rounded.md}'
  nav-item-active:
    background: '{colors.active}'
    foreground: '{colors.ink}'
    typography: '{typography.body-strong}'
  nav-count:
    background: '{colors.pill-info-bg}'
    foreground: '{colors.pill-info-ink}'
    typography: '{typography.pill}'
    radius: '{rounded.full}'
  tab:
    foreground: '{colors.muted}'
    typography: '{typography.body}'
    height: '{spacing.control}'
  tab-active:
    foreground: '{colors.ink}'
    border-bottom: '2px solid {colors.ink}'
  search:
    background: '{colors.sheet}'
    border: '1px solid {colors.control-edge}'
    width: '{spacing.search}'
    height: '{spacing.control}'
    radius: '{rounded.md}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-text}'
    hover: '{colors.primary-hover}'
    typography: '{typography.body-strong}'
    height: '{spacing.control}'
    radius: '{rounded.sm}'
  button-accent:
    background: '{colors.accent}'
    foreground: '{colors.primary-text}'
    hover: '{colors.accent-hover}'
    radius: '{rounded.sm}'
  button-secondary:
    background: 'rgba(0, 0, 0, 0.05)'
    foreground: '{colors.ink}'
    radius: '{rounded.sm}'
  button-text:
    foreground: '{colors.accent-ink}'
    typography: '{typography.body-strong}'
  button-danger:
    background: '{colors.danger}'
    foreground: '{colors.primary-text}'
    hover: '{colors.danger-hover}'
    radius: '{rounded.sm}'
  input:
    background: '{colors.sheet}'
    border: '1px solid {colors.control-edge}'
    foreground: '{colors.ink}'
    typography: '{typography.body}'
    height: '{spacing.control}'
    radius: '{rounded.md}'
  input-error:
    border: '1px solid {colors.danger-ink}'
  chip-filter:
    foreground: '{colors.ink-2}'
    border: '1px solid {colors.control-edge}'
    radius: '{rounded.full}'
    height: '{spacing.control}'
  chip-filter-selected:
    background: '{colors.active}'
    foreground: '{colors.ink}'
  tag:
    background: '{colors.pill-neutral-bg}'
    foreground: '{colors.pill-neutral-ink}'
    typography: '{typography.small}'
    radius: '{rounded.sm}'
  pill:
    typography: '{typography.pill}'
    radius: '{rounded.full}'
    height: 20px
    padding: '0 8px'
  table-row:
    height: '{spacing.row}'
    border-bottom: '1px solid {colors.rule}'
    hover: '{colors.hover}'
  table-row-selected:
    background: '{colors.active}'
  gown-card:
    background: '{colors.sheet}'
    border: '1px solid {colors.sheet-edge}'
    radius: '{rounded.lg}'
    mosaic-gap: 2px
  banner:
    radius: '{rounded.md}'
    height: 40px
    typography: '{typography.body}'
  toast:
    background: '{colors.ink-2}'
    foreground: '{colors.primary-text}'
    radius: '{rounded.md}'
    shadow: 'raised'
  dialog:
    background: '{colors.sheet}'
    width: '{spacing.dialog}'
    radius: '{rounded.lg}'
    shadow: 'raised'
    padding: '{spacing.content-pad}'
  drawer:
    background: '{colors.sheet}'
    width: '{spacing.drawer}'
    border-left: '1px solid {colors.sheet-edge}'
    shadow: 'raised'
  empty-block:
    border: '1px dashed {colors.control-edge}'
    radius: '{rounded.lg}'
    foreground: '{colors.muted}'
  skeleton:
    background: 'rgba(0, 0, 0, 0.05)'
    shimmer: 'rgba(0, 0, 0, 0.09), 1.4s'
    radius: '{rounded.sm}'
  avatar:
    background: '{colors.ink-2}'
    foreground: '{colors.primary-text}'
    size: 32px
    radius: '{rounded.full}'
    typography: '{typography.pill}'
  auth-column:
    width: '{spacing.auth-col}'
    background: '{colors.frame}'
---

# Klei Bridal Dashboard: Design

Visual identity only. Behaviour, states and copy live in `EXPERIENCE.md`. Where this file and the wireframe disagree on polish (colour, radius, elevation, type), this file wins. Where they disagree on layout or flow, the wireframe wins and this file adapts.

## Brand & Style

Style name: `prototype-aligned` (revised 2026-11-10, sprint change proposal 2026-11-10; replaces `framed-sheet`). A tinted 240px sidebar runs the full height with a 1px right edge. Beside it a 64px white top bar with a 1px bottom edge sits over the white page. The work is not inset and not rounded; pages scroll under the top bar.

The product is a studio tool used all day by five or so people, with gown photos as its subject. The chrome stays neutral so the photos are the colour. Under about 3% of any screen is a coloured pixel that is not a photo, a status pill or the accent on one main data element.

**The one signature element: the gown mosaic.** Each gown is a 2x2 photo mosaic (4 photos, 2px gaps, 8px radius, no overlay). It is the only place the interface gets rich. It appears on the Gallery grid, the Dashboard "Recent uploads" row and the Upload review group list. Everything else stays flat.

Voice of the surface is plain and trade-specific: gown, silhouette, fabric, neckline, sleeve, train, inquiry, fitting-room calm. No hero headers, no marketing tone, no decorative emoji.

Wireframe layout and flow are kept: same sidebar items, same top bar items, same screens, same drawer. Only the finish changes.

## Colors

Four jobs, nothing else.

- **Ground:** `{colors.frame}` for the frame and the auth pages, `{colors.sheet}` for every working surface. `{colors.active}` is the selected row, active nav pill and selected chip. `{colors.hover}` is row and menu hover.
- **Ink:** `{colors.ink}` for titles and values, `{colors.ink-2}` for body, `{colors.muted}` for secondary text (6.0 to 6.5:1 on frame and sheet), `{colors.faint}` for the quietest allowed text, such as timestamps (4.8 to 5.2:1). Nothing below 4.5:1 carries text.
- **Accent:** `{colors.accent}` is for fills and for the one main data element on a screen, such as the unread count or the processing bar. Accent text and links use `{colors.accent-ink}` (4.9 to 5.2:1 on white, active and tint). Hover is `{colors.accent-hover}`.
- **Status:** pills are a pale tint with dark same-hue ink. Green means done or high confidence, amber means check or invited, red means failed or low confidence, blue means new. Status always has a word, never colour alone.

Controls: borders use `{colors.control-edge}` (3:1 or better) so inputs are findable. Structural edges (`{colors.sheet-edge}`, `{colors.rule}`) are decorative and carry no meaning.

Primary action is the accent blue `{colors.primary}` (white text, 4.8:1), as in the prototype. Keep one primary button per view. Accent text and links still use `{colors.accent-ink}`.

Danger fill `{colors.danger}` is used only on a confirm button inside a destructive dialog. Inline error text uses `{colors.danger-ink}`.

**Avatars.** A dark `{colors.ink-2}` circle with a white initial, as in the prototype: 32px (72 large, 24 small). The photo replaces it when the person has one. The `avatar-*` tint pairs are unused.

Not used: gradients, glows, glass, violet or indigo, cream with terracotta, tinted-square icon cards, rainbow charts, emoji.

Dark mode is out of scope for MVP (see Assumptions in `docs/ux-spec.md`).

## Typography

One family, Inter, bundled with the app and with the Auth Web (no CDN, no third-party request; NFR-6). One second face with one job: the system monospace stack (`ui-monospace, "SF Mono", Menlo, monospace`, no font file bundled) for IDs, base URLs, API-key masks and IP addresses only.

| Role | Spec | Use |
|---|---|---|
| `title` | 26 / 700 / 32, tracking -0.033em | One per screen, a noun ("Gallery", "Staff"). |
| `section` | 20 / 700 / 25 | Panel and group titles. |
| `body` | 16 / 400 / 1.5 | Default text. |
| `sm` | 14 / 400 / 20 | Secondary text, controls, table cells. |
| `body-strong` | 14 / 600 | Active nav item, button labels, names in lists. |
| `small` | 12 / 400 / 16 | Helper text, timestamps, tags. |
| `table-head` | 12 / 500 / `{colors.muted}` | Sentence case. No caps, no tracking. |
| `figure` | 32 / 600 / 36 | A counted number such as total gowns. |
| `pill` | 12 / 600 | Pills, nav count. Nothing under 12px; the floor is 11px. |
| `mono` | 12 / 400 | IDs and keys. |

Rules: sentence case everywhere. Numbers use tabular figures and right-align in tables. Line length stays under 80 characters (the thread body is capped at 72ch). Only the title and section sizes carry the prototype's negative tracking; nothing else is letter-spaced. No all-caps labels, no `WORD · fragment` meta strings, no `→` suffixes.

## Layout & Spacing

Base 4px, scale 4/8/12/16/20/24/32. One gutter value, `{spacing.gutter}` (16px), is used between every card, column and grid cell.

```
┌ sidebar 240 (#f6f5f4) ┬ topbar 64, white, 1px bottom edge ───────┐
│ ▣ Klei Bridal         │ [   search 480x36   ]       AI  🔔  ◉    │
│ Workspace             ├──────────────────────────────────────────┤
│  ▤ Dashboard          │ Title (24/600)            [primary action]│
│  ⬆ AI Upload          │ ──────────────────────────────────────── │
│  ▦ Gallery            │ content, padding 24 32 48, max 1200      │
│  ✉ Inquiries  3 new   │                                          │
│  ⚙ Settings           │                                          │
└───────────────────────┴──────────────────────────────────────────┘
```

(The bell and avatar in the sketch are the wireframe's top bar items. The shipped UI uses the wireframe's icon set, not emoji.)

- **Product mark and name** sit at the top of the sidebar (32px mark), with the studio name as scope ("Klei Bridal"). One workspace, so no switcher.
- **Shell:** sidebar 240, top bar 64 inside the main column, page fills the rest. Window minimum 1100x700. Layouts are designed for 1280 to 1920 wide. The sidebar does not collapse (YAGNI).
- **Page content** padding 24 32 48, max width 1200. Pages scroll inside the main column, not the window.
- **Fixed pane widths** (from the wireframe): inbox list 320, gown details 360, AI drawer 400, dialog 480, search 480 (max). Auth column 440.
- **Gallery grid** 4 columns, `{spacing.gutter}` gaps. **Gown viewer** stage fills the remainder, details pane 360, stage height 560.
- **Tables** row height 48, rules between rows, no zebra, header 12px muted.
- **Settings** use a label column (about 240) plus a panel, one view per area, with the area name as the title.
- The auth pages sit in a centred 440 column directly on `{colors.frame}`, no sheet.

## Elevation & Depth

Flat by default. A surface has a border or a shadow, never both. Shadows are only for things that float: toasts, dialogs, popovers (search, notifications, profile menu, select lists) and the AI drawer. One shadow token, `--elev-raised` (frontmatter `elevation.raised`, the prototype's four-layer value): `rgba(0,0,0,.04) 0 4px 18px, rgba(0,0,0,.027) 0 2px 7.85px, rgba(0,0,0,.02) 0 .8px 2.93px, rgba(0,0,0,.01) 0 .175px 1.04px`. A dialog opens over a `rgba(0,0,0,0.35)` scrim. The AI drawer has no scrim and does not block the page.

## Shapes

Radius follows importance, not uniformity: dialog and drawer 12, panels and cards 8, controls 6, tags 4, pills and chips full. Photos inside a mosaic use 8 on the outer corners only. Avatars are circles.

## Components

Token values are in the frontmatter. Appearance rules:

- **Nav item:** 32px high, icon plus label under a "Workspace" label, 6px radius. Active is a `{colors.active}` pill with `body-strong` and an accent icon. No left accent bar. Only Inquiries shows a count (accent pill, "N new"); counts appear only on queues that need action.
- **Tab:** text, 600 weight, with a 2px accent underline when active. Used for Settings and Admin sub-areas.
- **Buttons:** one `button-primary` per view. `button-secondary` has the control border. `button-text` is accent-ink text, no box, used for Retry, Clear filters, Clear search and Reopen. `button-danger` only inside a destructive dialog. All 32px high; icon-only buttons are 32x32 with an accessible name.
- **Input and select:** 32px, control border, 6px radius. Error state swaps the border to `{colors.danger-ink}` and adds the message below in `small`. Helper text is `small` muted.
- **Filter chip:** 32px, full radius. Selected uses `{colors.active}` fill with ink text and a check glyph, so it is not colour alone.
- **Pill:** 24px high, 8px side padding, `pill` type, never squeezed or truncated. Variants: positive, warning, negative, info, neutral.
- **Tag:** 4px radius, neutral. Tags are data (silhouette, fabric and so on), so they stay grey. Colour on a tag would be chrome.
- **Gown card:** the signature mosaic on top, then name (`body-strong`), "Silhouette, Fabric" (`small` muted), photo count and date added (`small` faint, tabular). "New" is an info pill on the newest only. A checkbox appears top left on hover, and stays visible once any card is selected. Selected card takes a 2px `{colors.accent-ink}` outline.
- **Table row:** 48px, hover `{colors.hover}`, selected `{colors.active}`. Row actions appear at the right as icon buttons and stay visible on keyboard focus.
- **KPI strip:** one band divided by vertical rules. Each cell: `small` label above, `figure` number below. No tiles, no icons, no sparklines.
- **Banner (connection, update):** 40px full-width inside the top of the sheet, 6px radius, pale tint, text plus one text button. Not dismissible while the condition holds.
- **Toast:** bottom right, 24px from edges, `{colors.ink-2}` background, white text, check icon on success, `raised`, 3.2s. Error toasts stay until dismissed.
- **Dialog:** 480 wide, title `section`, body `body`, actions right-aligned with the safe action left of the confirm. Destructive dialogs focus Cancel first.
- **Drawer:** 400 wide, from the right edge, below the top bar, over the page with `raised`.
- **Empty block:** keeps the frame and the section title, then one sentence in a dashed `{colors.control-edge}` box with the one next action. Whole-view empties may add one of the six line-art images from the wireframe (`assets/empty/empty-gown-1..6.png`), centred, 160px tall. Widgets never use an image.
- **Skeleton:** 4px-radius bars at the real size of the content, shimmering `rgba(0,0,0,.05)` to `.09` over 1.4s; static under `prefers-reduced-motion`. Photos load into grey tiles of their final size.
- **Error block:** inside the block that failed. Says what failed, when the data was last good (if known), and a Retry text button. Never a page-level takeover unless the whole shell cannot load.
- **Auth column (Auth Web):** wordmark above, title, form, helper links in `button-text`. Same tokens as the app, loaded from one generated `tokens.css`.

## Do's and Don'ts

Do
- Use photos as the colour. Keep all other colour on data.
- One title per screen, a noun.
- Print zeros. Show a missing value as a grey dash.
- Put an error where it happened.
- Keep the focus ring: 2px `{colors.focus-ring}` with a 2px offset on every focusable element.
- Use sentence case and the trade's own words.

Don't
- No decorative gradients, glows, glass, emoji, violet or indigo. The one gradient is the skeleton shimmer.
- No icon-in-tinted-square cards, no rainbow charts, no vanity numbers.
- No border plus shadow on the same surface.
- No accent bar on the active nav item.
- No tracked caps, middle-dot meta strings, `WORD: fragment` labels or `→` on buttons.
- No mono for anything except IDs, URLs, key masks and IPs.
- No pill under 11px, no text under 4.5:1.

## Deviations kept for accessibility

The prototype is authoritative except for two values that fail WCAG AA. Both stay at the desktop value (Story 11.1):

- Focus ring: 2px `#0063bf`, 2px offset (prototype `#097fe8` plus a 3px glow, 3.7 to 4.0:1).
- Meta text: `{colors.faint}` `#716c66`, 4.8 to 5.2:1 (prototype `#a39e98`, 2.7:1).

The prototype's blue pill ink `#097fe8` on `#f2f9ff` (3.8:1) is also not used: the info pill keeps `{colors.pill-info-ink}` `#0063bf` on the prototype tint.
