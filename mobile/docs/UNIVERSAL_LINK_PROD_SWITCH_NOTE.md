## Universal Link Production Setup

The production iOS universal-link setup should target the SFLuv org bundle ID:

- `APPLE_IOS_BUNDLE_ID=org.sfluv.wallet`
- `APPLE_TEAM_ID=ARLC5L6F5P`

And rebuild the production iOS app after the switch so the released binary and the AASA file point at the same bundle ID.

As of May 20, 2026, `https://app.sfluv.org/.well-known/apple-app-site-association` returned `ARLC5L6F5P.org.sfluv.wallet`, which matches the production bundle.
