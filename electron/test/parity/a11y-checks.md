# Accessibility and interaction checks (NFR-7)

These are assertions, not screenshots. They run on both sides and are judged separately from pixel comparison, so screenshot normalisation (frozen animation, parked pointer, blurred focus) can never hide a focus or live-region defect. Source for each is the renderer under `desktop/src` (read only).

| # | Check | How to assert | Source in the original |
|---|---|---|---|
| A1 | Skip link moves focus to the view | Tab once from load: `a.skip` is focused and visible; Enter moves focus to `#view` | `shell/Shell.tsx` (`a.skip`, `href="#view"`) |
| A2 | Tab order follows reading order | Tab through the shell: top bar, nav, view; record the focused element sequence and compare both sides | whole shell |
| A3 | Visible focus | Every focused control has a non-`none` outline or box-shadow (`:focus-visible` rules exist in `styles.css`) | `styles.css` |
| A4 | Escape closes overlays, innermost first | With the bell menu, search results, customer card, edit-gown dialog and assistant open in turn: Escape closes only the top one and leaves the page behind it | `shell/Shell.tsx`, `Bell.tsx`, `SearchBox.tsx`, `inquiries/CustomerCard.tsx`, `gallery/EditGown.tsx` |
| A5 | Modal focus is contained and restored | In a `role=dialog` / `alertdialog` with `aria-modal`, Tab and Shift+Tab stay inside; closing returns focus to the opener | `shell/Shell.tsx` (dialog), `App.tsx` (alertdialog), `upload/Review.tsx` (lightbox) |
| A6 | Toast live region | `.toasts` is `role=status` with `aria-live=polite` while a toast exists; the text is announced once and the region is not focusable | `shell/Shell.tsx` |
| A7 | Banners and errors | Offline and update banners use `role=status`; sign-in failures use `role=alert` | `shell/Shell.tsx`, `App.tsx` |
| A8 | Assistant log | `role=log`, `aria-live=polite`, `aria-label="Conversation"`; busy line is `role=status` | `assistant/Assistant.tsx` |
| A9 | Reduced motion | With `reducedMotion: 'reduce'` no animation runs on `.skeleton`, `.drawer`, `.steps .mark i` | `styles.css` |
| A10 | Landmarks | One `main`; page navs carry an `aria-label` (audit pager, usage pager) | `App.tsx`, `settings/AuditTab.tsx`, `settings/UsageTab.tsx` |
| A11 | Text is selectable and copyable | `getSelection().toString()` after a triple-click returns the line text; Cmd/Ctrl+C reaches the clipboard (17.6) | webview behaviour |
| A12 | Window sizes | At native 1280x800 and the minimum 1100x700, `page-h-scroll` and `dialog-overflow` probe findings stay at zero | `probe.mjs` |

Probe findings (`overlap`, `offscreen-x`, `covered`, `glued-text`, `text-clipped`) are compared by `compare.mjs` from `probe.json`; a finding on one side only fails the pair.

Native behaviour (keychain, dialogs, deep links, single instance, packaged lifecycle) is not covered here. A mocked Chromium run cannot certify it; see 17.x, 18.4 and 20.1.
