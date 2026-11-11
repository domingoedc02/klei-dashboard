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
