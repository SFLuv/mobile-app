# Maestro suite (iOS simulator)

Three flows. Two pass; one is blocked on a Privy dashboard setting that cannot
be changed from a terminal. Details below — the blocker is the reason there is
no merchant-mode or W-9 coverage here yet.

## Running

Maestro needs a JVM and the machine has no system Java, so the Homebrew one has
to be on PATH:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk
export PATH="$JAVA_HOME/bin:$PATH:$HOME/.maestro/bin"
maestro test .maestro/
```

The app must already be installed and Metro running:

```bash
# Metro
npx expo start --port 8081

# Build + install. NOT `expo run:ios` — its device detection is broken here
# ("Unexpected devicectl JSON version output"), so it takes the physical-device
# path and dies on "No code signing certificates are available", even with a
# simulator UDID passed to --device.
cd ios
xcodebuild -workspace SFLuv.xcworkspace -scheme SFLuv \
  -configuration Debug -sdk iphonesimulator \
  -destination 'id=<SIMULATOR_UDID>' -derivedDataPath /tmp/dd \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO \
  PRODUCT_BUNDLE_IDENTIFIER=org.sanchezoleary.sfluvwallet.dev
xcrun simctl install booted /tmp/dd/Build/Products/Debug-iphonesimulator/SFLuv.app
```

Two things about that command are load-bearing:

- **`CODE_SIGNING_ALLOWED=NO` must not be used.** It produces an unsigned app
  with no entitlements, iOS then refuses every keychain call, and expo-secure-store
  fails with `Calling the 'getValueWithKeyAsync' function has failed`. Privy
  stores its client ID there, so the app hangs forever on "Initializing Privy…"
  with nothing on screen to say why. `CODE_SIGN_IDENTITY="-"` ad-hoc signs it and
  the keychain works.
- **The bundle identifier must be the dev one.** Privy allowlists app
  identifiers, and a build carrying `org.sfluv.wallet` is refused at login.

## Flows

| Flow | State | Covers |
|---|---|---|
| `00-boot.yaml` | passes | Clears state, re-enters through Expo's launcher and dev menu, waits for the first app screen. Every other flow starts with it. |
| `01-login-options.yaml` | passes | All three sign-in methods and both policy links are on the signed-out screen. |
| `02-email-code-request.yaml` | **blocked** | Requesting a login code. Gets as far as submitting the address, then hits the Privy allowlist error. |

### Why 02 is blocked

```
Native app ID org.sanchezoleary.sfluvwallet.dev has not been set as an
allowed app identifier in the Privy dashboard.
```

`.dev.env` points the whole local stack — backend, web and mobile — at Privy app
`cmnhyyeda00sv0cjmsrrcpuiv`, and is right to: the backend rejects any token whose
`aud` differs from its own `PRIVY_APP_ID`, and dev-up.sh warns when the three
disagree. But that Privy app has no iOS app identifier allowlisted, so the app
cannot log in at all.

The other Privy app in the repo — `cmlidct3t00pql50du730rr3o`, named in
`eas.json`, `backend/.env` and `frontend/.env` — does allowlist
`org.sanchezoleary.sfluvwallet.dev`. Pointing the app at it logs in fine (verified:
code delivered, session established, app shell rendered). But then every backend
call 403s, because the running backend trusts the other app. So the app can log
in or reach the backend, not both.

**The fix is one dashboard change**: add `org.sanchezoleary.sfluvwallet.dev` to
the allowed app identifiers of Privy app `cmnhyyeda00sv0cjmsrrcpuiv`. Nothing in
this repo needs to change. Once that is done, 02 should pass unchanged, and
merchant-mode and W-9 flows become writable.

Entering a code still needs the inbox, so a fully unattended login is a separate
problem from this one.

## Notes for whoever writes the next flow

- **There are no testIDs anywhere in the app** (zero across every `.tsx`). Every
  selector is user-visible copy, so a wording change breaks a flow and reports as
  "element not found". Worth adding testIDs to the merchant surfaces before
  writing flows against them.

- **The social login buttons need a leading `.*`.** iOS composes each button's
  accessibility label from its children — an unlabelled icon slot, the text, and
  an empty spacer `View` — so what reaches Maestro is `", Continue with Email"`,
  with a leading comma. Plain `"Continue with Email"` matches nothing.

- **Do not assert on `"SFLUV"`.** Expo's developer menu is itself titled "SFLuv"
  and Maestro matches case-insensitively as a substring, so that assertion passes
  while the app is still hidden behind the menu. `00-boot` originally did this and
  reported green against the wrong screen.

- **Assert that typed text came back.** `inputText` after a missed tap silently
  types into nothing; the only symptom is a validation error further down. `02`
  asserts the address is visible before submitting, which is what caught it.

- **`clearState` is doing real work in `00-boot`.** Maestro does not reset
  between flows, and the email field keeps its value across in-app navigation, so
  repeat runs append into `"...oleary.comsanchezsanchez@oleary.com"`. `eraseText`
  is not a reliable substitute — it deletes from the cursor, which is not always
  at the end.
