---
id: 0095
title: Allow explicit public reads of isolated monitoring views
status: Proposed
date: 2026-10-30
supersedes: []
superseded-by: null
tags: [monitoring, security]
affects:
  - src/config/index.ts
  - src/middleware/monitorOnly.ts
  - src/services/httpApp.ts
  - src/routes/externalSessions.ts
  - public/monitor/index.html
  - public/monitor/monitor.js
  - docs/spec-external-monitoring.md
---

## Context

A deployment may explicitly choose to let its visitors inspect external run
history without signing into Cockpit. The existing Owner gate is also used for
account management and cannot be disabled globally to provide that view.

## Decision

Add opt-in `MONITOR_PUBLIC_READ`, effective only with `MONITOR_ONLY`. Mount only
the monitoring GET routes and static monitor assets before the global Owner
gate. Keep source credentials on the server, preserve Owner data and management
authentication, and reject native execution and WebSocket upgrades. Default
monitoring and native Cockpit authentication remain unchanged.

## Alternatives Considered

- Disable Owner authentication globally: rejected because it would expand
  access beyond the explicitly published read view.
- Send a source token to anonymous browsers: rejected because read publication
  does not require distributing the upstream credential.

## Consequences

- A published monitor displays all source-supplied runs and transcripts to its
  visitors, without requiring a browser session.
- Turning the flag off restores Owner-only monitoring using existing auth data.
- Public read policy must stay limited to monitoring GET requests, with the
  same source validation, polling and read-only execution boundaries.

## References

- [External monitoring specification](../spec-external-monitoring.md)
- [ADR-0093](0093-monitor-external-runs-with-a-read-only-source.md)
