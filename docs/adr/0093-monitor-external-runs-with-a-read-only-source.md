---
id: 0093
title: Monitor external runs with a read-only source
status: Accepted
date: 2026-10-29
supersedes: []
superseded-by: null
tags: [security, monitoring]
affects:
  - server.ts
  - src/contracts/externalSessions.ts
  - src/services/externalSessionSource.ts
  - src/services/monitorServer.ts
  - docs/spec-external-monitoring.md
---

## Context

An independently deployed agent owns its live turns and end-user isolation.
Cockpit's native conversation store and backend resume operations own their
own local threads. Monitoring must preserve that ownership and work without a
model login while keeping administrative transcripts behind Owner login.

## Decision

Use an independent, read-only `ExternalSessionSource` contract for run lists
and transcripts. A fixed server-side source URL and dedicated Bearer token
provide two GET endpoints; browser requests cannot select hosts or credentials.
An authenticated standalone monitor page polls every four seconds. The
`MONITOR_ONLY` startup branch creates no chat runtime, MCP listener or scheduler
and denies all native HTTP execution routes and WebSocket upgrades. Disable
localhost authentication bypass in that mode. Preserve normal Cockpit mode by
default. Bind the configured `HOST` and pin release updates to this Fork.

## Alternatives Considered

- **Resume native threads to inspect them**: rejected because resume can change
  lifecycle ownership or interfere with an active external turn.
- **Expose the source token to the browser**: rejected because the monitoring
  credential must remain separate from browser-owned Owner sessions.
- **Hide execution controls in the existing UI**: rejected because server APIs,
  WebSockets and automatic schedulers would still permit execution.

## Consequences

- Monitoring cannot submit, resume or cancel external runs.
- No CLI authentication or Vite build is needed for monitor-only operation.
- Source services must implement bounded, appropriately redacted responses.
- The Owner sees the source's administrative run view; end-user isolation stays
  in the owning service. Mobile uses the responsive monitor page.

## References

- [External monitoring specification](../spec-external-monitoring.md)
- [Server security](../spec-server-security.md)
