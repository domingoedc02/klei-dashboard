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
