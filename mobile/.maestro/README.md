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

**Build Release, not Debug.** Maestro restarts the app to attach to it, and an
Expo *development* build cannot reattach to Metro when that happens — it comes
up on "Unable to Start SFLUV / Aborted" and eventually needs a reinstall. A
Release build carries its JS bundle inside the app (`main.jsbundle`, ~8MB) and
has no bundler dependency at all, so restarts are free.

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

## Flows

| Flow | Covers |
|---|---|
| `00-boot.yaml` | Launch, clear the privacy-policy gate if present, land on Wallet. Every other flow starts with it. |
| `01-wallet-shell.yaml` | Balance, Send/Receive, populated Recent activity, all five tabs. |
| `02-tab-navigation.yaml` | Each tab opens its own screen and Wallet is reachable again. |

`01` deliberately asserts on **Recent activity**, which is drawn from indexed
on-chain transfers. It cannot render if the backend is unreachable, so it is the
step that distinguishes "the app is running" from "the app is working". A flow
that only checked for chrome would have passed through the entire outage above.

## What is missing

The signed-in account is a personal one, so the app shows the volunteer layout.
**Merchant mode, the merchant PIN, device setup and the W-9 tier modal have no
coverage**, and they are the surfaces the merchant refactor changed. Writing
those needs a signed-in merchant account — one that owns an approved location —
against the local stack.

`01` already asserts `Participate` is visible, which is the seam: a merchant
account is locked to merchant surfaces and should not see that tab, so the same
flow run as a merchant should fail there. That is the natural place to start.

## Notes for whoever writes the next flow

- **There are no testIDs anywhere in the app** (zero across every `.tsx`). Every
  selector is user-visible copy, so a wording change breaks a flow and reports as
  "element not found". Worth adding testIDs to the merchant surfaces before
  writing flows against them.

- **Some buttons need a leading `.*`** — e.g. `.*Send`, `.*Receive`. iOS composes
  a button's accessibility label from its children, so an unlabelled icon and an
  empty spacer `View` turn "Send" into ", Send". On the signed-out screen the
  same thing produces ", Continue with Email". A plain `"Send"` matches nothing.

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
