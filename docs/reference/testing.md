# Testing

Tests use Jest for the main suite and separate commands for web, mobile, and
real-CLI compatibility checks.

## Common Checks

```bash
npm run typecheck
npm run lint
npm test
npm run maintainability:check
npm run spec:drift
```

## Web And Mobile

```bash
npm run web:typecheck
npm run web:build
npm run web:budget
npm run mobile:typecheck
npm run mobile:build
```

## Claude Code Interactive Compatibility

These suites require an authenticated real `claude` CLI and are intentionally
not part of normal CI:

```bash
npm run e2e:claude-interactive:report
npm run e2e:claude-interactive-ui:report
```

Review the Claude Code Interactive compatibility guidance in [AGENTS.md](../../AGENTS.md)
before changing that backend path.

## Grok Build Compatibility

These suites require an authenticated real `grok` CLI, send real requests
through that account, and are intentionally not part of normal CI. Native runs
can take several minutes:

```bash
npm run e2e:grok-build
npm run e2e:grok-build-ui
```

The first runs the native Jest compatibility and workflow suites. The second
builds the desktop and mobile apps, starts an isolated PM2-managed fixture
server with temporary data, and removes only that PM2 app when it finishes.
Both forward extra arguments to Jest or Playwright and print the temporary
folder that holds their compatibility report.

Review the Grok Build compatibility guidance in [AGENTS.md](../../AGENTS.md)
and [spec-grok-build.md](../spec-grok-build.md) before changing that backend
path.
