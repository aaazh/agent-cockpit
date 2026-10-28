# External Session Monitoring

[Back to index](SPEC.md)

The independent `/monitor/` page reads runs owned by a separate agent service.
It never imports runs into native Cockpit conversations, calls native thread
resume, sends input, aborts a run, or changes the source service. Source access
is implemented by `ExternalSessionSource` in
`src/services/externalSessionSource.ts`; its HTTP implementation only performs
the two fixed GET requests below. Browser-safe response validation is in
`src/contracts/externalSessions.ts`.

## Configuration and authentication

| Environment variable | Default | Behavior |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Actual HTTP listen address, including native-mode port guard. Set `127.0.0.1` behind a local reverse proxy or SSH tunnel. |
| `MONITOR_ONLY` | `false` | When exactly `true`, starts only authentication, CSRF, monitoring routes and static monitor assets. |
| `EXTERNAL_SESSION_SOURCE_URL` | empty | Empty disables the source. Otherwise a root HTTPS URL, or HTTP on `localhost`, `127.0.0.1`, or `[::1]`. Credentials, prefix paths, queries and fragments are rejected at startup. |
| `EXTERNAL_SESSION_SOURCE_TOKEN` | empty | Required when a source URL is configured. Sent only server-to-server in `Authorization: Bearer …`. Use a dedicated read-only token for monitoring endpoints. |
| `UPDATE_REPOSITORY` | `aaazh/agent-cockpit` | Pins production release checks/downloads to this Fork, overriding any old install manifest repository. Development update uses the checkout's `origin/main`. |

The monitor page and all monitoring endpoints require an authenticated owner
session even on loopback. They share existing local password, passkey and
recovery login; no model CLI installation or authentication is needed. In
monitor-only mode the localhost auth bypass is disabled for all owner auth
management too. First owner setup requires `AUTH_SETUP_TOKEN`, including on
loopback, and successful setup lands at `/monitor/`. Keep `SESSION_SECRET` and
`AUTH_SETUP_TOKEN` nonempty and out of source control. Owner authorization is
administrative: it may view all runs exposed by the source, and is separate from
end-user session isolation in that service.

## Standalone monitoring entry

`monitor.ts` uses the shared `createCockpitHttpApp` authentication/session/source
composition and the same monitor HTTP/WebSocket enforcement as `server.ts`.
It requires `MONITOR_ONLY=true` and imports no native chat, CLI, Memory, KB,
Routines or migration modules. Use this entry on hosts where the full app's
optional native packages cannot be built.

`npm run monitor:build` creates a self-contained CommonJS Node 22+ bundle and
copies only monitor static assets into `monitor-dist/`. Its build guard rejects
native runtime inputs. `manifest.json` records the source commit and bundle
SHA-256. Run `monitor-dist/monitor.cjs` under the existing PM2 supervisor; the
bundle itself needs no npm dependencies, CLI installation or Vite output.
Keep persistent configuration and auth/session data outside this directory.
See [ADR-0094](adr/0094-keep-standalone-monitoring-builds-independent-of-native-runtimes.md).

## API and source contract

Authenticated browser endpoints:

* `GET /api/monitoring/status` → `{ enabled, monitorOnly, pollIntervalMs: 4000 }`.
  Does not return the source URL, token or credentials.
* `GET /api/monitoring/runs?cursor=<opaque>` → forwards only the optional string
  cursor (maximum 500 characters) to `GET /internal/monitoring/runs` at the fixed
  source origin.
* `GET /api/monitoring/runs/:id/transcript` → forwards to
  `GET /internal/monitoring/runs/:id/transcript`. IDs must match
  `[a-zA-Z0-9_-]{1,200}` and the returned run must match the requested ID.

All responses are `Cache-Control: no-store`. Source disabled returns 503;
malformed cursor or ID returns 400; upstream rejection, redirect, timeout,
oversize response or invalid contract returns a generic 502 without exposing
upstream errors or response bodies. Source fetches reject redirects, use a
five-second deadline, and cap decoded response bodies at 2 MiB.

List response: `{ items: ExternalRun[], nextCursor?: string }`, maximum 200 runs.
An `ExternalRun` has `id`, `conversationId`, `status`, `createdAt`, optional
`startedAt`, `finishedAt`, `error` (maximum 4000 characters), and `usage` (JSON
object). Status is `queued`, `running`, `cancelling`, `completed`, `failed`,
`cancelled`, or `timed_out`. Timestamps must parse as dates. Unknown run fields
are removed before forwarding.

Transcript response: `{ run: ExternalRun, messages, events }`. Messages (maximum
2000) have `role: 'user' | 'assistant'`, string `content` (maximum 100000
characters) and `createdAt`. Events (maximum 5000) have nonnegative safe-integer
`seq`, string `type` (maximum 100 characters), JSON `data` and `createdAt`.
Run/conversation IDs are strings up to 200 characters. The source owns redaction
of private business data inside message content and event data; Cockpit does
not grant access to any additional source endpoints.

## Read-only lifecycle and UI

`MONITOR_ONLY=true` branches before creating `ChatService`, model adapters,
Memory/KB MCP listeners, session finalizers, background schedulers, CLI update or
plan-usage services. It skips pending data imports and web/mobile build
preflights. `/`, `/v2/*` and `/mobile/*` redirect to `/monitor/`; all `/api/chat/*`
methods return 403 with `code: 'MONITOR_ONLY'` after authentication, including
native chat/resume, Memory, KB, Routines and update routes. All WebSocket
upgrades return 403. There is no client-side switch that enables execution.

With monitoring mode off, existing native Cockpit behavior remains available.
The desktop sidebar links to the same independent monitor page. The source is
still disabled by default. Monitor assets are ordinary static files under
`public/monitor/` and require no Vite build or model onboarding.

The page shows run state/times, transcript, optional usage/error and expandable
execution events. It fetches every four seconds after the previous request
finishes, uses aborts/generation checks to prevent overlapping updates from
changing the selected run, pauses while hidden, and retries temporary source
failures. Switching runs clears the previous transcript immediately. Unchanged
transcripts retain their DOM and scroll. Older-page cursors and refresh-latest
are supported. Content is rendered through `textContent`, never HTML. Mobile
uses the responsive monitor page; native PWA assets/metadata are unchanged and
the PWA route redirects here in monitor-only mode.

## Verification

`test/externalSessions.test.ts` covers fixed authenticated upstream requests,
contract bounds/validation, redirects, oversize bodies, path traversal,
credential-safe errors, owner requirement, disabled sources, denial of HTTP
execution and WebSocket upgrades. `test/externalMonitorUi.test.ts` covers text
rendering, list/detail, safe four-second polling, pause and pagination.
`test/auth.test.ts` covers token-protected loopback owner setup without model
login. `test/config.test.ts` and `test/installStateService.test.ts` cover defaults
and Fork release source pinning. See [ADR-0093](adr/0093-monitor-external-runs-with-a-read-only-source.md).

`test/monitorStartup.test.ts` verifies the real server composition takes the
monitor branch without constructing native services or applying data imports.

`test/monitorEntry.test.ts` verifies standalone entry configuration and that native backend imports are unreachable.
