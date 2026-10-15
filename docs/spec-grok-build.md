# Grok Build integration

[Back to index](SPEC.md) · [Backend services](spec-backend-services.md)

## Identity and ownership

The physical CLI harness and internal backend ID are `grok-build`; the UI label
is **Grok Build**, and the default command is `grok`. `server.ts` registers
`GrokBuildAdapter`. Profiles persist `CliProfile.harness`; legacy `vendor` stays
at existing migration boundaries. Grok has no provider-specific profile object.
`command`, `configDir`, and string `env` overrides use the existing profile
schema. Workspace instructions use the harness-neutral `AGENTS.md` source.
The architecture is recorded in [ADR-0092](adr/0092-integrate-grok-build-through-acp-and-native-extensions.md).

| Module | Responsibility |
|---|---|
| `src/services/backends/grok.ts` | Adapter facade, conversation leases, native session preparation/recovery, streaming, goals, sequential ephemeral calls, titles/summaries, reset/shutdown |
| `grokProtocol.ts` | Newline JSON-RPC framing, outgoing correlation, reverse requests, RPC errors, closed-process signal, stream queue |
| `grokRuntime.ts` | Profile command/env/auth-home resolution, process creation, ACP initialization/cached authentication, access checks |
| `grokProcess.ts` | Process-table parsing, descendant ownership, termination/escalation |
| `grokEvents.ts` | Root/child event ownership, tools/outcomes, native media paths, goal/mode updates, background completion tracking |
| `grokInteractions.ts` | Pending question/plan requests, permission decisions, input responses and cancellation |
| `grokModels.ts` | Native catalog IDs, effort options, verified model modality flags |
| `grokUsage.ts` | Disjoint token buckets, cost ticks/completeness, per-model rows, resident counter deltas |
| `grokGoals.ts` | Live/persisted goal projection into `ThreadGoal` |
| `grokBilling.ts` | Billing normalization and cache by effective profile fingerprint |
| `src/contracts/grokBilling.ts` | Browser-safe billing response shapes |

## Runtime and protocol

Spawn `grok --no-auto-update --always-approve agent --no-leader stdio`, using
the resolved execution directory, piped stdin/stdout/stderr, and hidden Windows
windows. POSIX runtimes are detached into an owned process group. Client
filesystem read/write and terminal capabilities are false: Grok executes native
tools. `--always-approve` matches Cockpit's unattended tool-enabled execution;
plan/question decisions remain separate reverse RPC interactions.

Merge host and profile env, then force `GROK_DISABLE_AUTOUPDATER=1`,
`GROK_PROMPT_SUGGESTIONS=false`, `GROK_TURN_SUMMARY=0`, and `GROK_MEMORY=0`.
These defaults prevent independent update/memory/summary behavior in supervised
sessions. Other profile env values remain available to Grok. Map `configDir`
to an absolute, tilde-expanded `GROK_HOME`, taking precedence over a profile env
override. Do not change `HOME`. Executable search uses the host installation
home, independently of account auth isolation; explicit `command` still wins.
The runtime fingerprint hashes effective executable/args/env, without logging
the env values.

Initialize ACP version 1. Reject other negotiated versions. When `cached_token`
is advertised, call `authenticate` with `{methodId:'cached_token',
_meta:{headless:true}}`. Otherwise, select `xai.api_key` when an effective
`XAI_API_KEY` is configured or that method is advertised, also with headless
metadata. Released 1.0.52 can advertise only `grok.com` with an API key present
while accepting the `xai.api_key` authentication method; do not require its
advertisement in the configured-key case. Native administrator auth restrictions
still apply to the authenticate request. Do not launch interactive login
implicitly. Configuring a key does not prove request authorization.
Grok extension wire methods include the leading underscore, such as
`_x.ai/session/info`. Decode each result wrapper explicitly.

Use UTF-8 decoding across split reads and newline-delimited JSON frames. Accept
multiple frames per read and bound each frame/unfinished buffer to 32 MiB.
Malformed or oversized frames close the client and reject outstanding requests
without echoing their contents. Route `method` before `id`; reverse request ID
zero is valid and independent of outgoing numeric IDs. Drain stderr without
publishing its raw account/tool details. Process `exit`, not only `close`, so an
orphan holding stdout open cannot leave pending requests hanging. Normal RPCs
time out after 45 seconds; active prompts use the adapter's deadline instead.

## Sessions and turn ownership

If an initial parent response returns while background children remain, emit
`turn_boundary` before draining their automatic parent continuation. This keeps
the initial reply and later final answer in separate Cockpit text segments.

Cache one runtime per stable conversation ID (session ID is the fallback key),
with an effective profile/cwd fingerprint. Reject overlapping turns and changes
to a busy runtime. Explicit unavailable/non-directory workspaces produce a
terminal error; create only the adapter's default scratch directory when no
explicit working directory is supplied. Idle runtimes expire after one hour.
`shutdown()` clears owned runtimes while keeping the registered adapter usable,
as required by CLI update cleanup. A startup that arrives after its cache entry
was reset/removed is closed. Terminal failures close only the runtime leased by
that failed turn; rejecting an overlap must leave the other active turn alive.

Create sessions with `cwd`, `mcpServers`, and `_meta.rules` containing sanitized
Cockpit instructions. Resume the persisted opaque native ID with negotiated
`session/resume`, or use `session/load` when resume was not advertised. Ignore
load/recovery replay before activating the event decoder. Every turn emits
server-only `external_session` and `backend_runtime` identifiers for durable
storage once its session is ready, including a session that a goal status read
attached first. Serialize session preparation per runtime: each caller runs with
its own recovery and event policy after earlier preparation settles, so a status
read can never hand a turn its non-recovering, event-discarding preparation.
Set requested model/effort through
`session/set_model` and `session/set_config_option` (`reasoning_effort`).
Apply the same negotiated resume/load method when refreshing MCP configuration.

Only `-32603` with `data.code:'FS_NOT_FOUND'` during resume/load qualifies for
missing-session recovery. A send creates the existing Cockpit recovery snapshot,
opens a new native session, places mandatory snapshot-read instructions in its
rules, and emits `session_recovery`. Authentication, other filesystem errors,
timeouts, and interrupted tool prompts do not trigger automatic retries.
Goal status reads and idle pause/clear controls only attach an existing persisted
native session. They never create a session, recover a missing one, or create
recovery snapshots. An absent or missing native session reads as no goal; pause
then returns no goal and clear succeeds without a session. A control reserves
the runtime before attaching, so a turn started meanwhile is rejected as
overlapping. Resuming a missing native goal fails rather than inventing a new goal loop.

Changed managed instructions are prefixed to the next ordinary prompt after
attach/change. Native `/goal` control prompts remain literal; they must not be
prefixed into ordinary model text. Files referenced by AGENTS.md remain native
file inputs. A changed reference can be explicitly reread; automatic refresh of
every changed instruction is not inferred from that behavior.

Map root answer/thought chunks to `text`/`thinking`. Suppress child assistant
text from the parent answer. Lifecycle parent/child IDs create Agent cards and
`parentAgentId` ownership for child tools/thought activity. Native default
delegation is parallel with one level of children. Map tools from structured
`_meta['x.ai/tool']`; `use_tool.rawInput.tool_name` identifies the actual MCP
target. Emit outcomes once per tool ID. Root narration preceding a new tool
batch may become a `turn_boundary`; final one-shot text excludes that narration.

A parent RPC can return while children continue. Keep its Cockpit stream and
lease open for child completion and any `will_wake` parent continuation. Service
interactions throughout this period. Reconcile resident usage before emitting
`result` and exactly one `done`. Cancellation during this background phase
cancels owned children and closes the runtime, preventing a late continuation
from contaminating a later turn.
Track native `subagent_id` separately from `child_session_id`: child session IDs
own Cockpit Agent cards, but `_x.ai/subagent/cancel` takes the native subagent ID.

Abort sends `session/cancel`, cancels pending interactions and owned children,
and closes an unresponsive runtime after five seconds. History recovery on the
next turn is supported; exact active-turn reattachment is unsupported.

## Process cleanup

Grok's native shells can lead separate sessions/groups, so killing the CLI group
alone is insufficient. While a POSIX runtime exists, enumerate
`ps -axo pid=,ppid=,pgid=,lstart=` every 500 ms, coalescing overlapping scans.
Record descendants by ancestry plus PID/start identity. On stop or unexpected
exit, terminate only identities still matching the current process table and
their owned groups; escalate to SIGKILL after two seconds. Never identify work
by generic `grok`/shell command-name matches. PID reuse must not enroll a new
process after root death. This polling cannot observe a descendant that detaches
and loses ancestry between snapshots; it is not kernel-level containment.
Windows termination uses hidden `taskkill /pid <ownedPID> /t /f` with a direct
process-kill fallback. Native Windows hard-crash behavior remains a compatibility
check for that platform.

## Interactions and plans

Retain `_x.ai/ask_user_question` and `_x.ai/exit_plan_mode` reverse request IDs.
Questions use their native question text as answer-map keys and arrays of answer
strings. Present multiple questions sequentially through the existing single
question card. Reply `{outcome:'accepted',answers}` when complete, or
`{outcome:'cancelled'}` on cancel/skip. Queue simultaneous interactions.

For plans, trimmed input that is exactly `yes`, `approve`, `approved`,
`continue`, or `run` (case-insensitive) accepts with `outcome:'approved'`;
abandon/cancel sends `abandoned`; other input sends `cancelled` with feedback,
allowing another revised plan request. Null plan content still permits a
decision. `interaction_resolved.tool_call_id` clears the corresponding pending
interaction. Permission requests select an offered `allow_once`; if none is
offered, cancel. Restricted calls reject interactions/tools. Without a pending
interaction, explicit input uses `_x.ai/interject` with a fresh interjection ID.
Ordinary queued messages remain owned by Cockpit.
Each native plan request emits an enter/exit decision cycle into the shared
stream contract. This resets the server's duplicate-approval guard for a revised
plan even when Grok remains in native plan mode without another mode-change
notification. Mobile presents exit events as approval cards and notifications,
using a fallback prompt when plan content is absent. Pasted goal-card headers
recognize both `grok-build` and **Grok Build** across server, desktop, and mobile
objective normalization; ordinary objectives keep those prefixes.

## Restricted and tool-enabled background calls

Child thought chunks create one grouped Thinking activity per child, with a
bounded 500-character excerpt completed alongside the child. Subsequent thought
chunks do not create duplicate transcript rows. Duplicate child-finish frames
are ignored, including their parent-wake signal.

`runSessionShot` uses one ephemeral native session/process for sequential
prompts and returns trimmed final root text per prompt. `runOneShot` delegates
one prompt to it. Apply selected profile, cwd, model/effort, attachments, total
caller deadline (60 seconds default), and abort signal. Timeout includes setup;
cancelled/non-`end_turn` one-shots reject instead of trusting partial output.
Always release the ephemeral runtime. Title/summary calls use 30-second limits
and existing fallbacks; titles are limited to 80 characters.

With `allowTools:false`, inject no Cockpit MCP servers, disable skill/AGENTS
discovery, and use this native profile:

```json
{"name":"cockpit-text","description":"Text extraction without tools","discoverSkills":false,"agentsMd":false,"injectDefaultTools":false,"toolConfig":{"tools":[{"id":"GrokBuild:read_file"}]},"disallowedTools":["read_file"]}
```

Before inference, require `_x.ai/session/info.result.context.toolDefinitionsCount`
to equal zero. Fail closed when this cannot be verified. Prefix the request with
plain text so native slash-command dispatch cannot invoke goals or other CLI
actions; a missing-session recovery prompt is placed before that prefix rather
than replacing it. Reject unexpected tool/permission frames. `--tools ''` is not an
alternative: it inherits native tools. With tools enabled, use the native
toolset and forward ACP-shaped MCP `{name,command,args,env:[{name,value}]}` at
creation and when token configuration changes on the same session.

These paths supply Memory governance, titles/summaries, KB digestion/gleaning/
dreaming, Workspace Context, OCR, and Routines through their existing profile
resolver. They do not bypass workspace opt-in or replace those service policies.
`extractMemory`/`getMemoryDir` retain the base null behavior.

## Models, media, artifacts, and usage

Direct media calls fail before inference unless the resolved model is
`grok-4.7`. Explicit image MIME types are limited to PNG, JPEG, and WebP;
unrecognized formats fail rather than being mislabeled as PNG. PDF attachments
require tool-enabled execution and use a native file-read instruction.

Read `_meta.modelState.availableModels` from initialization. Keep native
`modelId`/name/description/current default; map negotiated low/medium/high/xhigh
effort values. Retain the most recently initialized native catalog in the adapter's
synchronous `metadata.models`, including initialization during turns. Cockpit's
conversation policy uses that catalog to preserve or normalize the selected
effort instead of silently clearing it. Profile metadata responses still come
from that profile's own freshly initialized runtime. Grok 4.7 Fast is a separate
native model ID, not Codex's service tier. Only the verified `grok-4.7` entry
advertises image/PDF input and image
output. Other catalog entries are text-only for media gating. Backend image
transports are explicit ACP images/native files; PDF uses native file tools.
Audio/video remain disabled.

Explicit image attachments use base64 data/MIME in ACP blocks and require the
verified model. PDFs require tools and instruct the native file reader. Translate
native `ImageGen.path`/filename to `artifact.sourcePath`; existing ArtifactStore
copies the file, even from a native session folder outside the execution dir.
Deduplicate returned media paths. Keep the existing FILE_DELIVERY convention for
ordinary generated files; it is not required for structured native images.

Use full prompt `_meta.usage`, not last-call sibling fields. Full input includes
cache reads/writes: subtract those subsets into disjoint buckets. Reasoning is
already part of output. Convert complete reported `costUsdTicks` with 1e10
ticks/USD; incomplete/partial/missing cost is unavailable, not a trusted zero.
Split complete model breakdowns into ledger rows without also adding the root
aggregate. Selected picker IDs and usage IDs may differ (`grok-4.7` versus
`grok-4.7-build`). No unverified xAI price estimate is supplied.
When the aggregate has complete reported cost, per-model cost must also be
complete and sum to it before splitting. Otherwise keep the aggregate row so
an incomplete cost breakdown cannot silently lose reported USD.

Before a prompt, read resident `_x.ai/session/usage`. For background work, use
the settled after-minus-before delta, including automatic parent continuation;
reject counter regressions and incomplete cost. Do not add child completion
usage again. Resident counters reset on process epochs; the persisted Cockpit
ledger remains authoritative across restarts. An unavailable reconciliation
produces a non-terminal warning and retains the available prompt usage.
Read context `usagePct` from native session info for chat snapshots.

## Goals, auth, billing, and clients

Capabilities enable thinking, plans, tools, questions, input, parallel agents,
and `{set,clear,pause,resume:true,status:'native'}` goals. Send `/goal <objective>`,
resume, and clear through native ACP. Pause an active lease through cancellation,
await settlement, and confirm `user_paused`; use an idle slash command only when
appropriate. Serialize clear after a terminal goal's remaining work settles;
reject clear of active work. Normalize live snake-case fields and persisted
`tokens_used_high_water`; native phase labels are not exposed in the shared goal shape. Keep native counters distinct from
repeated input usage. Token budgets are soft checkpoint limits; both clients
label them **Soft budget**. Budget-limited work can be cleared and replaced.

Status reads call `_x.ai/session/state` with both `sessionId` and the effective
workspace `cwd`; the latter is required by the native filesystem lookup. Native
`blocked` is a paused state that permits resume; preserve `pause_message` in
`lastReason`. Paused and blocked goals prefer `pause_message` over
`last_event_detail`; other states prefer the latest event detail. Non-finite
native elapsed time is omitted.

Welcome setup creates `setup-grok-build-account` without `configDir` or
`GROK_HOME`, sharing normal terminal auth. Explicit non-setup accounts can use
isolated homes. Remote auth jobs run `grok --no-auto-update login --device-auth`,
redact output (including xAI key prefixes), and verify ACP subscription/access
after exit zero. A blocked access gate is an error even with authenticated
credentials. An API key present without cached account verification is reported
as configured with unknown validity; no paid inference is used merely to check
auth. Post-import setup profiles warn that system auth needs checking.

`GET /api/chat/cli-profiles/:profileId/grok-billing` resolves an enabled Grok
profile, returns `{profileId,billing}`, and rejects other/missing profiles with
400. Upstream failures return 503. The cache coalesces requests and lasts 60
seconds per effective profile fingerprint. `GrokBillingSnapshot` includes
`fetchedAt` plus optional tier, explicit credit-use percentage, period type/
start/end, prepaid/on-demand USD balances/caps/usage, and unified-billing flag.
Billing Cent values use 100 cents/USD, separately from model-cost ticks; a
present empty Cent object represents zero. Missing allowance fields stay absent.
No percentage is inferred from prepaid or on-demand balances.

Settings lists the harness and account/self-configured modes with the usual
command/env/config controls. Welcome/Install Doctor expose optional Grok
installation (`npm i -g @xai-official/grok`) and device auth. CLI update detection
supports npm and native `update --check --json`/`update`; account auth roots do
not redirect physical CLI installation. Windows prefers native user binaries
or managed package entrypoints before shims and repairs managed terminal wrappers
to use private Node. Native Windows/Linux runs remain unverified.
An explicit override to the official extensionless `@xai-official/grok/bin/grok`
JavaScript entrypoint also runs through private Node on Windows.

Desktop context chips display disjoint tokens/context and profile-scoped billing
through `GrokPlanUsageStore`/`GrokBillingSection`. Mobile uses the same billing
contract and API client; unavailable cost/estimates display n/a. Both use existing
shared goal/interaction/artifact frames. No provider protocol fields reach the
browser stream union.
Desktop Grok plan cards additionally accept revision feedback through a
`Plan revision feedback` textarea and `Request changes` button. Blank feedback
and all actions during response submission are disabled; feedback uses the
existing input route and a revised native plan receives a fresh decision.
Other harness plan cards retain their existing approval controls. Mobile plan
cards use explicit `Approve & run` and `Reject` buttons that send the same `yes`
and `no` decisions as desktop, so conversational text cannot be mistaken for
approval. Only Grok mobile plan cards add the revision feedback textarea and
`Request changes` button. Both clients capture the interaction being answered;
a late input acknowledgement clears only that interaction, preserving a newer
question or revised plan that arrived first. Desktop also keeps the newer
interaction in its awaiting state. This uses interaction object identity rather
than tool ID because one native question request can present several questions.
Desktop goal
hydration, polling, optimistic goal state, and profile switching include Grok.
Mobile delivery cards interpret `FILE_DELIVERY` only in assistant messages;
markers quoted in a user request cannot create a premature downloadable file.

## Compatibility verification

Deterministic suites: `grokProtocol.test.ts`, `grokEvents.test.ts`,
`grokBackend.test.ts`, `grokInteractions.test.ts`, `grokProcess.test.ts`, `grokIntegration.test.ts`,
`grokWindows.test.ts`, `grokUi.test.ts`, and Grok coverage in
`planUsageStores.test.ts` / `cliUpdateService.test.ts`.
The isolated CLI fixture is `test/fixtures/grok-acp.cjs`.
`grokBuild.e2e.test.ts` and `grokWorkflows.e2e.test.ts` are opt-in via
`npm run e2e:grok-build`; they require an
authenticated real Grok and exercise restricted/native sequential text,
slash-command restriction, hard-exit descendant cleanup/history recovery, and
background children/parent continuation, questions with revised plan approval,
and goal set/pause/resume-to-active/pause/clear with native status reads, empty
auth-home isolation, invalid-key failure, isolated device-login cancellation,
and full autonomous goal completion. The full completion fixture has an external
360-second cancellation deadline and verifies exact file contents, native complete
state, reported usage, and exactly one final done event. The workflow suite uses
temporary HTTP/WS services and real token-scoped Memory/KB stdio stubs; it verifies
KB digestion, Memory governance/search, KB entry search, Workspace Context
maintenance of a supplied reference, and an explicitly enabled manual Routine
with notifications off.

`npm run e2e:grok-build-ui` runs `test/e2e/grokBuild.ui.pw.ts` against an
isolated PM2-managed fixture server and production desktop/mobile assets. It
checks native profile/model/effort selection and persistence, desktop questions
and plan revisions, actual file downloads, browser reload/abort recovery, mobile
questions/plans/usage/file previews, and desktop/mobile goal controls. Desktop and
mobile question flows hold the first input HTTP acknowledgement until the second
question from the same native request is visible, then answer that preserved
question after releasing the acknowledgement. The runner
deletes only its own PM2 app on completion; it does not restart normal servers.
Both runner scripts accept forwarded Jest/Playwright filters, work without POSIX
inline environment assignment, and write temporary compatibility reports with
timestamps, Cockpit git revision/dirty state, OS/architecture, Node/Grok versions,
and exit status. UI fixture data/logs remain under the reported temporary path
for diagnosis; they are not checked into the repository.

These suites are excluded from ordinary paid CI
runs. The authenticated macOS baseline is CLI 1.0.52 (`0920c8169e27`); review
[the empirical evaluation](research/grok-build-acp-evaluation.md) for additional
protocol evidence and remaining cross-platform/entitlement/media limitations.
