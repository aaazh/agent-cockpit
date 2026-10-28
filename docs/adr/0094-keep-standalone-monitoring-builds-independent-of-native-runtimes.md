---
id: 0094
title: Keep standalone monitoring builds independent of native runtimes
status: Proposed
date: 2026-10-29
supersedes: []
superseded-by: null
tags: [monitoring, deployment]
affects:
  - monitor.ts
  - src/services/httpApp.ts
  - src/services/monitorServer.ts
  - scripts/build-monitor.js
  - docs/spec-external-monitoring.md
---

## Context

External monitoring uses authentication and read-only HTTP access, but the full
server entry imports optional native chat dependencies before selecting its
monitor-only branch. Hosts with an incompatible native build toolchain cannot
use that entry even though monitoring needs none of those packages.

## Decision

Provide a standalone monitor entry that imports the shared owner/session HTTP
composition and the existing HTTP/WebSocket execution guards. Require
`MONITOR_ONLY=true`. Produce a self-contained Node bundle with static monitor
assets, a source commit and bundle digest, and reject native runtime modules in
the build dependency graph. Continue running the bundle under PM2.

## Alternatives Considered

- Require native toolchain upgrades for monitoring. Rejected because native
  chat features are outside the read-only monitor's needs.
- Generate a private trimmed server during deployment. Rejected because it
  would drift from tested source and authentication composition.

## Consequences

- Monitoring no longer requires PTY, SQLite, model CLIs or web build tooling on
  its host.
- Full and monitor entries share owner/session/source behavior.
- The independent build guard and startup tests must remain part of validation.

## References

- [External session monitoring](../spec-external-monitoring.md)
- [ADR-0093](0093-monitor-external-runs-with-a-read-only-source.md)
