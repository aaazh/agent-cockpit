---
id: 0092
title: Integrate Grok Build through ACP and native extensions
status: Proposed
date: 2026-10-13
supersedes: []
superseded-by: null
tags: [backends, profiles, protocol, goals]
affects:
  - src/services/backends/grok.ts
  - src/services/backends/grokProtocol.ts
  - src/services/backends/grokRuntime.ts
  - src/services/backends/grokProcess.ts
  - src/services/backends/grokEvents.ts
  - src/services/backends/grokInteractions.ts
  - src/services/backends/grokUsage.ts
  - src/services/backends/grokModels.ts
  - src/services/backends/grokGoals.ts
  - src/services/backends/grokBilling.ts
  - src/contracts/grokBilling.ts
  - docs/spec-grok-build.md
---

## Context

Grok Build supplies an authenticated local coding harness with ACP chat,
sessions, tools, and MCP. Questions, plan decisions, goals, detailed usage,
and subagent lifecycle require native extensions. The released CLI also
starts shell tools in separate process groups and can finish background
children after returning the initial parent response.

## Decision

Register `grok-build` as a physical CLI harness and backend. Keep its facade in
`grok.ts`; keep transport, process ownership, decoding, interactions, models,
usage, goals, and billing in focused Grok modules. Use existing Cockpit stream,
artifact, profile, one-shot, and goal contracts rather than exposing native
extensions to clients. Do not refactor Kiro's private ACP implementation.

Reuse normal terminal auth for server-configured and Welcome setup profiles;
use `GROK_HOME` for explicit account isolation. Resolve and update the shared
executable independently of that auth home. Disable automatic CLI updates and
native memory in supervised runtimes.

Require both a curated zero-tool profile and a zero-definition preflight for
restricted calls. Prefix their requests as text so native slash commands cannot
bypass the restriction. Keep one-shot deadlines and cancellation caller-owned.

Preserve native goal execution, including soft budget semantics. Pause active
work by cancellation; serialize other control prompts. Advertise session history
recovery, but leave active-turn reattachment unsupported. Track owned POSIX
descendants by PID and start identity because a root-group kill cannot reap
Grok's separately detached shell groups. Drain background child/parent work
before finalizing and reconcile resident usage deltas without counting child
usage twice.

## Alternatives Considered

- **Plain headless text or terminal automation:** loses native interactions and
  durable session/event ownership that ACP already supplies.
- **Generalize Kiro immediately:** its transport is coupled to Kiro extensions;
  this adds unrelated changes without establishing a reusable shared boundary.
- **Cockpit goal loop or automatic prompt retry:** duplicates native goal
  control and can repeat side effects after interruption.
- **Root process/group termination alone:** real tests left native shell work
  alive; descendant ownership must survive root death.

## Consequences

- Grok uses the same desktop/mobile and background-service contracts as other
  harnesses, while its protocol details remain server-side.
- Native extensions and curated-tool behavior require pinned real-CLI checks.
- POSIX ownership tracking uses process enumeration while a runtime is alive.
  A child created and detached between snapshots and immediate parent death
  can evade observation; this is not kernel-enforced containment.
- Windows launch/wrapper paths have deterministic coverage, but native Windows
  and Linux compatibility still need runs on those machines.
- Reported model cost and optional billing fields are displayed without
  claiming complete subscription or auxiliary-media charge reconciliation.

## References

- [Grok Build specification](../spec-grok-build.md)
- [Authenticated evaluation](../research/grok-build-acp-evaluation.md)
- [ADR-0051](0051-adopt-shared-contracts-and-logging-foundations.md)
- [ADR-0057](0057-represent-goal-mode-as-backend-capability-driven.md)
- [ADR-0064](0064-use-system-cli-auth-for-welcome-setup.md)
