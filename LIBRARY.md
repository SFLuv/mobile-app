# LIBRARY.md

Central work-in-progress ledger for concurrent implementation.
Use the agent-work-coordinator skill or `scripts/coordinator.py` to edit this file.

<!-- agent-work-coordinator-state
{
  "checkouts": {},
  "implementations": {
    "push-installation-id-mobile": {
      "agent": "codex",
      "agent_uuid": "949df2cb-1c76-48b2-b1fa-014b7a279502",
      "bumped_files": [],
      "checked_out": [],
      "checkins": [
        {
          "at": "2026-06-17T13:49:31Z",
          "files": [
            "mobile/App.tsx",
            "mobile/src/services/appBackend.ts"
          ],
          "note": "checkout requested"
        },
        {
          "at": "2026-06-17T13:51:19Z",
          "bumped": [],
          "checked_out": [
            "mobile/App.tsx",
            "mobile/src/services/appBackend.ts"
          ],
          "files": [
            "mobile/App.tsx",
            "mobile/src/services/appBackend.ts"
          ],
          "note": "installation ID payload wired; preflight next",
          "queued": [],
          "remote_state": "up-to-date"
        },
        {
          "at": "2026-06-17T13:51:59Z",
          "bumped": [],
          "checked_out": [
            "mobile/App.tsx",
            "mobile/src/services/appBackend.ts"
          ],
          "files": [
            "mobile/App.tsx",
            "mobile/src/services/appBackend.ts"
          ],
          "note": "released completed files: mobile/App.tsx, mobile/src/services/appBackend.ts",
          "queued": []
        }
      ],
      "completed_files": [
        "mobile/App.tsx",
        "mobile/src/services/appBackend.ts"
      ],
      "goal": "Send installation ID with mobile push subscription sync",
      "id": "push-installation-id-mobile",
      "last_checkin_at": "2026-06-17T13:51:59Z",
      "planned_files": [
        "mobile/App.tsx",
        "mobile/src/services/appBackend.ts"
      ],
      "progress_note": "released completed files: mobile/App.tsx, mobile/src/services/appBackend.ts",
      "queued": [],
      "started_at": "2026-06-17T13:49:31Z",
      "updated_at": "2026-06-17T13:51:59Z"
    }
  },
  "queues": {},
  "updated_at": "2026-06-17T13:51:59Z",
  "version": 1
}
agent-work-coordinator-state -->

## Active Implementation Briefs

### `push-installation-id-mobile`

- Agent: codex [949df2cb-1c76-48b2-b1fa-014b7a279502]
- Started: 2026-06-17T13:49:31Z
- Last check-in: 2026-06-17T13:51:59Z
- Goal: Send installation ID with mobile push subscription sync
- Progress: released completed files: mobile/App.tsx, mobile/src/services/appBackend.ts
- Planned paths:
  - `mobile/App.tsx`
  - `mobile/src/services/appBackend.ts`
- Completed paths:
  - `mobile/App.tsx`
  - `mobile/src/services/appBackend.ts`
- Checked-out paths:
_None._
- Queued paths:
_None._
- Bumped paths:
_None._
- Recent check-ins:
  - 2026-06-17T13:49:31Z: checkout requested (`mobile/App.tsx, mobile/src/services/appBackend.ts`)
  - 2026-06-17T13:51:19Z: installation ID payload wired; preflight next (`mobile/App.tsx, mobile/src/services/appBackend.ts`)
  - 2026-06-17T13:51:59Z: released completed files: mobile/App.tsx, mobile/src/services/appBackend.ts (`mobile/App.tsx, mobile/src/services/appBackend.ts`)

## File Checkouts

_No checked-out files._

## Queues

_No queued files._
