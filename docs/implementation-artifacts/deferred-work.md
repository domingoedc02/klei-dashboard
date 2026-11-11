## Deferred from: code review of 13.2-tokens-and-frame (2026-11-11)

- Nav link `--color-ink` and `.eyebrow` `--color-muted` follow the prototype; DESIGN.md `nav-item.foreground` is `ink-2`. The lead decides; revert is one token.
- Review banner and TwoFactor reset notice lost the warn wash with the neutral base `.banner`. 13.3 owns banner variants, 13.7 the Review banner.
- Non-dashboard screens now sit in the full-bleed sheet; each screen story reads its own pairs.
- The three banner captures have no prototype twin; judged against DESIGN.md only.
