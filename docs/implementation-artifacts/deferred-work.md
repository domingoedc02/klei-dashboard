## Deferred from: code review of 13.2-tokens-and-frame (2026-11-11)

- Nav link `--color-ink` and `.eyebrow` `--color-muted` follow the prototype; DESIGN.md `nav-item.foreground` is `ink-2`. The lead decides; revert is one token.
- Review banner and TwoFactor reset notice lost the warn wash with the neutral base `.banner`. 13.3 owns banner variants, 13.7 the Review banner.
- Non-dashboard screens now sit in the full-bleed sheet; each screen story reads its own pairs.
- The three banner captures have no prototype twin; judged against DESIGN.md only.

## Deferred from: code review of 13.3-shared-components (2026-11-11)

- TwoFactor admin-reset notice emphasis after the neutral `.banner`: 13.13 (Settings Profile). Review banner: 13.7.
- `formatRelative` and `formatMonthYear` adopted only by the bell; each screen story adopts them for its dates (D1).
- `.confbar.medium` keeps the warn ink: 13.7 rebuilds the confidence meter.
- Notification "Clear all" hidden when empty (prototype shows it): accepted deviation SH-15.

## Deferred from: code review of 13.4-shell (2026-11-11)

- Assistant pending bubble and Retry are lost when the drawer closes mid-send; the stored turn reloads on reopen.
- Assistant Retry may store a duplicate user turn if the first POST succeeded but the response was lost. Needs an idempotency key (API change, out of this epic).
- Bell "Clear all" sits outside `role=menu`: axe-clean now; revisit in 13.16.
- `DrawerHost` focus effect reruns on content swap: no second drawer kind today.
- Bell Escape swallows the key if a dialog is open at the same time: the scrim blocks the trigger, so not reachable.
- `aria-controls="ai-panel"` target is absent while the drawer is closed (prototype export parity): 13.16 axe pass.

## Deferred from: code review of 13.5-dashboard (2026-11-11)

- Skeleton shapes are asserted by presence, not row count.
- Processing with `total` 0 shows 0% instead of an indeterminate meter; the backend sends `total` with `processing`.
- Loading cards carry no `aria-busy`: 13.16 axe pass.
- Skeleton row height (53px) is the prototype `skelRows` value, not the real `Mosaic` row height.

## Deferred from: code review of 13.6-upload-states (2026-11-11)

- Rejections are hidden outside the adding phases (`empty`, `error`); no test covers it.
- Tile fill is asserted at one percentage only; tiles are decorative and `aria-hidden`.
- Long rejection lists are not capped or collapsed: revisit in 13.16.
- Hard-coded `#fff` and `rgba()` in the upload block match the prototype; no dark theme in this epic.

## Deferred from: code review of 13.7-review-layout (2026-11-11)

- Confidence number has no keyboard or touch path until the editor header (13.8) shows `Confidence N%`.
- `.rv` and `.tags-grid` have no narrow-window fallback; minimum window is 1100px, recheck in 13.16.
- `.savebar` bleed margins hard-code the sheet padding; add a token if a second container needs it.
- The "Gown groups" heading no longer announces the group count; the banner states the totals.
- Row meta uses the literal tag types `silhouette` and `fabric`.
- Prototype inline tagbox combobox (chips and input in one box) not built; native select kept.

## Deferred from: code review of 13.8-review-behaviour (2026-11-12)

- Rewrite output over 2,000 characters is not truncated; the save error then reads "Every gown needs a name". Needs a backend length contract.
- Lightbox Next/Prev disable at the ends and drop focus; close returns focus to the first opener, not the last photo viewed.
- Each photo tile has two tab stops (toggle and open); add a roving tabindex if a group can hold more than 12 photos.
- Confidence is unclamped and the meter's gray cutoff (80) is separate from `band`; the server owns both.
- Empty-batch copy ("All groups look confident.", "0 gowns · 0 photos") is not reachable from the API.
- Meter track and `.th-open` colours are hard-coded; revisit if a dark theme is added.
- Split of a split yields two groups with the same name.
- Missing boundary tests: stale Move target, Merge with nothing selected, split at n = len-1, multi-photo Move toast, meter at 79/80; styles.test.ts is string-grep.
- Duplicate photo ids across groups resolve to the first owner.
