## Universal Link Prod Switch

The current internal iOS universal-link setup is intentionally targeting the dev bundle ID:

- `APPLE_IOS_BUNDLE_ID=org.sanchezoleary.sfluvwallet.dev`

Before a production mobile rollout, switch the web deployment env to:

- `APPLE_IOS_BUNDLE_ID=org.sfluv.wallet`

Keep:

- `APPLE_TEAM_ID=9M6MC6C78F`

And rebuild the production iOS app after the switch so the released binary and the AASA file point at the same bundle ID.
