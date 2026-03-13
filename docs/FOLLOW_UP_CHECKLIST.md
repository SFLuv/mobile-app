# Follow-up Checklist

## Decisions Needed

1. Backend deployment shape
   - single service (current) vs split gateway/worker/indexer services

2. Sponsorship policy
   - allow all `execute` calls (current minimal validation) vs token-only allowlist

3. Legacy route sponsorship ownership
   - keep legacy paymaster contract and update sponsor
   - or point legacy TokenEntryPoint at a newly deployed paymaster

## Information Required

1. Privy mobile credentials:
   - `EXPO_PUBLIC_PRIVY_APP_ID`
   - `EXPO_PUBLIC_PRIVY_CLIENT_ID`
2. Production sponsor key management path (KMS provider + key IDs)
3. Production Berachain RPC endpoint(s) and failover URLs
4. Real mobile bundle IDs and signing setup
5. Push credentials (APNs key + FCM project)

## Gaps Remaining

1. Transfer history endpoint/indexer is still userop-centric; ERC20 transfer indexing is not implemented yet.
2. Push delivery worker is not implemented (token registration API exists).
3. Auth/signature enforcement on push endpoints is not implemented yet.
4. Production hardening:
   - paymaster abuse controls (rate limits / policy rules)
   - relayer key custody (KMS/HSM) and rotation

## Errors Encountered During This Pass

1. `@privy-io/react-native` package does not exist; correct Expo package is `@privy-io/expo`.
2. Privy Expo integration may require a development build depending on native extension support in Expo Go.
