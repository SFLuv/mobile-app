## Collaborative Agent Work

Agents working concurrently in this repository should download and use the `agent-work-coordinator` skill before implementation work. Use it to reserve files in `LIBRARY.md`, queue behind active checkouts, and archive completed work in `ARCHIVE.md`.

## Debugging: check Sentry first

The mobile app reports crashes, failed backend requests and screens stuck loading to Sentry. Before investigating a bug report, query it through the SFLUV admin MCP (`sentry_issues`, then `sentry_issue`) and start from the stack trace and trail it returns rather than from guesses. Each failed request carries a `request_id`; search the backend's Railway logs for it to see the server side. See `docs/SENTRY.md`.
