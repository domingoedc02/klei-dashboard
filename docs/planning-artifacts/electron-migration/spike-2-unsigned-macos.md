# Spike 2: unsigned macOS install

Date 2026-11-14. Status: **partial**. The user-facing dialogs were not observed.

## Question
Can a user launch an unsigned, un-notarized Electron app downloaded in a browser, and what do they have to do?

## Method
Stock Electron 45.3.2 `Electron.app` (ad-hoc signed, no team ID) copied to a temp path, re-signed ad hoc so the signature verifies, given the `com.apple.quarantine` attribute a browser download would add, then assessed with `spctl -a -vv -t exec`. No `.dmg` was built, no browser download was made, and no dialog was seen. Machine: macOS 26.6 arm64.

## Result
- The stock bundle fails `codesign --verify --deep --strict` even in place under `node_modules`, and so does a copy ("code has no resources but signature indicates they must be present"). An ad-hoc re-sign (`codesign --force --deep -s -`) makes it verify. Packaging must sign every build.
- Ad-hoc signed and quarantined: `spctl` says **rejected**.
- Ad-hoc signed and not quarantined: `spctl` still says **rejected**. So Gatekeeper assessment fails for an un-notarized app whether or not it was downloaded; quarantine decides whether the user is prompted at launch.
- Not observed: the exact dialog text, the System Settings path that allows launch, whether the steps differ on x64, whether launch needs an admin password, and whether replacing the app with a newer unsigned build keeps the credential entry.
- Apple's support page for this was fetched but the extract was unusable; no step wording is recorded here from it.

## Decision
None yet. Do not claim in `docs/install-guide`-style text, or in 18.2, any step that was not seen on a real machine. 18.2 stays blocked until the owner (or a macOS machine with a browser) runs: download the `.dmg` over HTTP(S), open, drag to Applications, launch; record each dialog; repeat on x64; then replace with a newer unsigned build and check keychain retention (see spike 1 residual risk).

## Residual risk
- This is OQ-M1's main exposure. If launch is impossible without a paid Apple account, escalate to the owner; the AD-24 Option A fallback is already approved for that case.
- The `spctl` rejection above is the expected "unidentified developer" state, not proof of what the dialog says on macOS 26.
