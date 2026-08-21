# Maestro suite (iOS simulator)

Three flows, all passing, ~38s for the set. They cover the signed-in shell and
tab navigation. Merchant mode, the PIN, device setup and the W-9 tier modal are
NOT covered yet — see "What is missing".

## Running

Maestro needs a JVM and this machine has no system Java, so put the Homebrew one
on PATH:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk
export PATH="$JAVA_HOME/bin:$PATH:$HOME/.maestro/bin"
maestro test .maestro/
```

## Building the app under test

**Build Release, not Debug.** A Release build carries its JS bundle inside the
app (`main.jsbundle`, ~8MB), so there is no Metro process to keep alive and no
second network dependency during a run. Maestro does background and relaunch the
app between flows, and a Release build has nothing to reconnect to. It is also
what ships, which is what the suite should be asserting against.

Expo Go is not an alternative at any point: `@privy-io/expo-native-extensions`
and `react-native-passkeys` are custom native modules, and Expo Go only contains
the prebuilt Expo SDK set. The app cannot launch there at all.

A note on a claim that used to be here: an earlier version of this file said a
development build "cannot reattach to Metro" under Maestro and comes up on
"Unable to Start SFLUV / Aborted". That was never verified. Every one of those
failures happened while EXPO_PUBLIC_APP_BACKEND_URL pointed at a stale LAN IP,
and the Release build failed identically until the address was fixed — the
address was the cause. The dev client was never retried against a working
backend, so it may well be fine. Do not let that line talk you out of trying it.

```bash
cd ios
xcodebuild -workspace SFLuv.xcworkspace -scheme SFLuv \
  -configuration Release -sdk iphonesimulator \
  -destination 'id=<SIMULATOR_UDID>' -derivedDataPath /tmp/ddr \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO \
  PRODUCT_BUNDLE_IDENTIFIER=org.sanchezoleary.sfluvwallet.dev
xcrun simctl install booted /tmp/ddr/Build/Products/Release-iphonesimulator/SFLuv.app
```

Four things about that command are load-bearing:

- **`CODE_SIGNING_ALLOWED=NO` must not be used.** It produces an app with no
  entitlements, iOS then refuses every keychain call, and expo-secure-store fails
  with `Calling the 'getValueWithKeyAsync' function has failed`. Privy stores its
  client ID there, so the app hangs forever on "Initializing Privy…" with nothing
  on screen to say why. `CODE_SIGN_IDENTITY="-"` ad-hoc signs it and the keychain
  works.
- **The bundle identifier must be the dev one.** Privy allowlists app identifiers
  per client, and `org.sanchezoleary.sfluvwallet.dev` is registered where the
  production identifier may not be.
- **`EXPO_PUBLIC_*` values are baked in at build time.** Changing `.env` — the
  backend URL, the Privy app — means rebuilding, not just relaunching.
- **Do not use `expo run:ios`.** Its device detection fails here ("Unexpected
  devicectl JSON version output from devicectl"), so it takes the physical-device
  path and dies on "No code signing certificates are available", even when handed
  a simulator UDID.

## Point the app at localhost, not the LAN IP

`EXPO_PUBLIC_APP_BACKEND_URL=http://localhost:8080`.

The simulator shares the host's network stack, so localhost reaches the dev
backend and never goes stale. A LAN IP does: it is DHCP-assigned and moved twice
in a single session (`.45` → `.25` → `.26`). When it goes stale the symptom is
not a network error — the app's own startup gate cannot reach `/config`, and it
sits on "Starting SFLUV / Checking app compatibility…" and then fails with
**"Unable to Start SFLUV / Aborted"**, which looks like a bundler or dev-client
problem and is not. That cost most of a session. Use the LAN IP only when testing
from a physical phone.

## Flows, and the account state each needs

**`maestro test .maestro/` will not pass as a set.** The suite covers two
mutually exclusive kinds of account, so it is run by tag, not all at once.

| Flow | Tag | Needs |
|---|---|---|
| `00-boot.yaml` | `volunteer` | a plain account |
| `01-wallet-shell.yaml` | `volunteer` | a plain account |
| `02-tab-navigation.yaml` | `volunteer` | a plain account |
| `03-merchant-pin-setup.yaml` | `merchant-setup` | a merchant account on a device that has NOT been set up yet |
| `04-merchant-mode.yaml` | `merchant` | a merchant account on a device that HAS been set up |

```bash
maestro test .maestro/ --include-tags volunteer
maestro test .maestro/ --include-tags merchant
```

Switch the signed-in account between the two with the backend repo's seed
script, passing the address from Wallet -> Receive:

```bash
./testing/scripts/seed-merchant.sh 0x<address>            # make it a merchant
./testing/scripts/seed-merchant.sh --revert 0x<address>   # put it back
```

`03` is the odd one out: it only passes on a device that has never been set up,
because once a PIN is saved and a shop chosen the app goes straight to the till
and never shows Merchant Setup again. That is correct behaviour, so `03` is a
first-run test rather than a repeatable one. `04` is the repeatable merchant
check and is green on consecutive runs.

`01` deliberately asserts on **Recent activity**, which is drawn from indexed
on-chain transfers. It cannot render if the backend is unreachable, so it is the
step that distinguishes "the app is running" from "the app is working". A flow
that only checked for chrome would have passed through the entire outage above.

## What is missing

**The W-9 tier modal has no coverage.** It needs an account pushed past the
notice threshold, which means real payouts on the local chain rather than a row
edit.

Merchant mode is covered now, but only the till's resting state. Taking an
actual payment — the thing the till exists for — is not tested.

## Notes for whoever writes the next flow

- **There are no testIDs anywhere in the app** (zero across every `.tsx`). Every
  selector is user-visible copy, so a wording change breaks a flow and reports as
  "element not found". Worth adding testIDs to the merchant surfaces before
  writing flows against them.

- **Composite views arrive as ONE accessibility element, so most selectors have
  to be regexes.** iOS concatenates a container's children into a single label,
  and this app leans on containers heavily. It shows up at three scales:
  a button (`", Send"`, `", Continue with Email"` — note the leading comma from
  an unlabelled icon), a form row (`"Confirm PIN, Enter it again, "`), and an
  entire modal (the merchant lock sheet is one string containing its title, body
  and Sign out link). A plain `"Confirm PIN"` matches nothing.

  This is worth fixing at the source rather than working around forever: it also
  means VoiceOver reads a whole card as one utterance, and that nothing inside is
  individually focusable. The merchant-mode header lock is worse — a bare icon
  with no label at all, and the only control on that screen.

- **Do not assert on `"SFLUV"` to mean "the app loaded"** unless you also know the
  app is in the foreground. Expo's developer menu is itself titled "SFLuv" and
  Maestro matches case-insensitively as a substring, so on a dev build that
  assertion passes while the app is hidden behind the menu. `00-boot` gets away
  with it only because a Release build has no such menu; it then waits for
  "SFLUV available", which is app content.

- **Assert that typed text came back.** `inputText` after a missed tap types into
  nothing and the step still reports COMPLETED; the only symptom is a validation
  error further down.

- **Maestro does not reset between flows.** Screens and form state persist. A
  relaunch clears React state, which is enough; `clearState` is not needed and on
  a dev build actively breaks things. `eraseText` is a poor way to clear a field —
  it deletes from the cursor, and tapping a field puts the cursor at the START, so
  it does nothing and new text lands in front of the old.
