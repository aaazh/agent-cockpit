# Grok Build ACP evaluation for Agent Cockpit

**Evaluated:** 2026-10-13, against Agent Cockpit revision
`6c02d776319848e2de4d12cb4cdcd01f72116bdc`.
**CLI:** Grok Build `1.0.52`, binary revision `0920c8169e27`, macOS arm64.
**Status:** Authenticated evaluation of the pre-integration revision. The current local implementation is documented in [spec-grok-build.md](../spec-grok-build.md); remaining implementation statements below describe the evaluation baseline.

Grok Build can support a first-class Agent Cockpit integration through ACP plus
Grok-specific extensions. Standard ACP covers conversation transport, native
sessions, tool activity, cancellation, configuration, and injected MCP servers.
Questions, plan approval, detailed usage, goals, subagent lifecycle, and steering
also depend on Grok extensions. A dedicated Grok adapter is needed to translate
those behaviors into Cockpit's existing contracts.

The official binary passed both local protocol probes and authenticated tests
against the real Grok service. The authenticated tests reused terminal login
and exercised chat, model switching, session recovery, tools, questions, plan
revision, parallel subagents, goals, Cockpit's MCP stubs, restricted one-shots,
image/PDF understanding, and native image generation. No ACP blocker was found
for implementing the core adapter.

First-class support still requires adapter and UI implementation, process-tree
cleanup, explicit goal pause/budget semantics, and capability gates. Killing the
CLI alone left an active shell descendant alive. Native goal budgets were soft
limits, and pausing active work required `session/cancel` rather than another
concurrent prompt. Actual subscription charge reconciliation, remote login jobs,
two-account isolation, and non-macOS platforms remain unverified.

## Evidence and scope

### Implementation follow-up

Authenticated adapter compatibility tests on the same released CLI additionally
confirmed that a background child can finish after the initial parent prompt
RPC returns, and Grok then automatically produces another parent response.
The initial reply's usage can have incomplete cost. The adapter therefore
drains native child/parent completion before ending the Cockpit stream and
reconciles before/after resident usage counters rather than adding child usage
to an already aggregated parent total. The settled real test included reported
model cost. The forced CLI-exit test also confirmed descendant identity cleanup
and later session recovery without replaying the interrupted shell command.
Restricted sequential text tests verified zero native tool definitions and
that a `/goal` request is treated as text, leaving its requested file absent.
These scenarios are retained in `test/grokBuild.e2e.test.ts` through
`npm run e2e:grok-build`; they do not establish native Windows/Linux support.

The adapter review on 2026-10-14 additionally verified native questions, revised
plan approval, and goal set/pause/resume-to-active/pause/clear/status. The native
goal status request requires both `sessionId` and `cwd`; omitting `cwd` returned
`Invalid params`. Native child thinking was observed and is grouped into one
activity rather than one row per chunk. A full file-completion goal probe
exceeded its deadline during native planning/verification, so the retained
control test did not claim fresh full-goal-completion coverage at that point.
The subsequent certification below closes that gap.

### Implementation certification on 2026-10-14

The released CLI remains `1.0.52 (0920c8169e27)`, on macOS arm64, with local
implementation changes above git revision `6c02d776319848e2de4d12cb4cdcd01f72116bdc`.
These results describe an uncommitted working tree rather than a published
release or a cross-platform certification.

- A direct native ACP file goal completed in **217.0 seconds**. The equivalent
  Cockpit adapter goal completed in **151.9 seconds**, with exact `GOAL_OK` file
  contents, native `complete` status, reported model cost, and exactly one done
  event. Complete notifications preceded additional native child/update traffic;
  the adapter continued draining through settled prompt completion. The opt-in
  native suite now retains a full-completion test with an external deadline.
- An empty isolated `GROK_HOME` stayed unauthenticated while normal terminal auth
  remained valid. A real isolated device-code login displayed its prompt and
  cancelled successfully without replacing normal credentials. A synthetic
  invalid API key could not complete a request. A valid API key, server-expired/
  revoked credentials, and two distinct real accounts were unavailable.
- API-key probing uncovered missing native authentication in the adapter.
  Grok's [official authentication documentation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md)
  describes `XAI_API_KEY` as a fallback to session tokens. This released binary
  advertised only `grok.com` with a synthetic API key, but a headless
  `authenticate` call using **`xai.api_key`** succeeded and allowed session creation.
  The adapter now invokes that method for configured keys, preferring an
  advertised `cached_token`. Local checks still report key validity as unknown;
  the invalid-key result is not evidence of valid-key authorization.
- Real KB digestion produced committed entries. Grok chat called the actual
  token-scoped Cockpit `memory_note`, `memory_search`, and KB `search_entries`
  stdio tools; a real Grok Memory processor saved the synthetic durable rule.
  Workspace Context maintenance incorporated a reference into actual context
  markdown, and an explicitly enabled manual Routine recorded its final output
  without sending notifications. These three retained native workflow tests passed.
- Browser checks verified desktop questions, revised plans, profile/model/effort
  persistence, file downloads, reload during tools, abort, and later recovery;
  mobile questions/plan approval and settled reported cost also passed. These
  checks found that the server discarded native effort selections because the
  synchronous adapter catalog was empty; retaining the initialized catalog fixes
  that issue. Desktop Grok plans also needed a revision-feedback control.
- The final browser suite passed all **four** scenarios, including mobile
  artifact preview/download response validation and desktop set/pause followed
  by mobile resume/pause/clear of the same native goal. It found and corrected
  desktop goal hydration/polling/profile guards that omitted Grok, plus mobile
  delivery cards that incorrectly interpreted a marker in the user's prompt as
  an already-created file. The full native run passed **11** checks across two
  suites (281.0 seconds); the final browser run passed in about 90 seconds.

Reproduce these checks using `npm run e2e:grok-build` and
`npm run e2e:grok-build-ui` with an authenticated CLI. Each runner records a
temporary compatibility report containing the exact Grok version, platform,
Node version, Cockpit revision, dirty-tree flag, timestamps, and exit code.
No normal Cockpit server was restarted or redeployed during certification.
The final ordinary regression run passed **2,541 tests in 130 suites**; 20
opt-in tests in three suites were skipped there and Grok's paid suites were run
separately as recorded above. V8 coverage was 87.91% statements/lines, 73.96%
branches, and 93.49% functions. Backend/web/mobile typechecks, zero-warning lint,
maintainability, specification drift (186 routes), ADR lint, production builds,
and the web budget passed. Final production JS was 894.6 KiB against 895 KiB.

Native Linux/Windows, valid API-key authorization, second-account isolation, and
account-charge reconciliation remain unverified. The portable runners write
temporary version/OS/git-state reports and exclude auth secrets and account
identity from repository evidence. Fixture/wrapper coverage is not a substitute
for native platform runs.

The initial CLI was downloaded as the official
`@xai-official/grok-darwin-arm64@1.0.52` npm package and extracted into a temporary
directory. It was not installed globally. Its package integrity was
`sha512-3e02UcyrA9s5J3Tp3N72FwcP2rzK9ogMe+nR4xzXaKZaLIwLHm6kgyFbtij1A8R3xO26oSGq0oxTJjKKErGK5g==`.
The authenticated phase used the user's installed `grok` at
`~/.local/bin/grok`, with the same version/revision. It inherited the normal
`~/.grok` login, without an API key or `GROK_HOME` override, and authenticated
through ACP's `cached_token` method. Tests used temporary fixture workspaces
and native test sessions. Auto-update, telemetry uploads, and native memory
were disabled only in the test child environment. The tests did not change
Cockpit production application processes, profiles, or credentials.

Raw wire logs and billing responses were retained only in private temporary
test directories. This report records schemas and synthetic fixture outcomes;
it excludes account identifiers, tokens, balances, and billing dates. Test
goals were cleared and owned test processes were stopped, including the shell
process deliberately orphaned by the hard-crash test.

Source inspection used the public
[Grok Build snapshot](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8)
at `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`. That snapshot is not the compiled
binary revision above. Findings marked **Source** describe that snapshot;
findings marked **Probe** were observed with local fixtures; **Authenticated**
findings were observed with that released binary and the real Grok service. The protocol
quickstart documents the supported ACP entrypoint, while the source supplies
details absent from the quickstart. [Official integration guide](https://docs.x.ai/build/cli/headless-scripting)

Cockpit requirements come from
[the adapter facade](../../src/services/backends/base.ts),
[backend capabilities and send options](../../src/types/backends.ts),
[stream events](../../src/types/streams.ts),
[CLI profiles](../../src/types/cliProfiles.ts), and
[the current backend specification](../spec-backend-services.md).
Previous Kiro integration history also establishes two relevant requirements:
replayed history must not become a new response, and child activity must remain
under the child rather than contaminating the parent answer.

## Capability matrix

**Probe** means observed using the real CLI and local fixture services.
**Authenticated** means observed using the installed CLI and real Grok login/model
service; the workspaces, documents, and Cockpit MCP HTTP endpoints were fixtures.
**Source** means implementation evidence without exercising that complete flow.
**Cockpit** means work required in this repository rather than a missing ACP
primitive.

| Cockpit requirement | Evidence | Integration work or remaining condition |
|---|---|---|
| Local executable, version detection | Probe | Resolve `grok` or profile command; capture version and negotiated capabilities. |
| Interactive chat without a visible terminal | Probe | Spawn `grok --no-auto-update agent --no-leader stdio`; implement bidirectional JSON-RPC. `--no-leader` is supported by CLI help and avoids user-configured shared-leader behavior. |
| Workspace and worktree execution directories | Probe for `cwd`; Source for native worktrees | Pass Cockpit's resolved execution directory in `session/new` and resume. Cockpit retains ownership of its workspace IDs and conversation worktrees. |
| Streaming answer and thinking | Probe | Map `agent_message_chunk` and `agent_thought_chunk`, maintaining their order and root-session ownership. |
| Tool activity, arguments, outcomes | Probe | Map `tool_call` and `tool_call_update`; inspect `_meta["x.ai/tool"]`, `rawInput`, `rawOutput`, status, locations, and content. |
| Multi-turn conversation context | Authenticated | Reuse the native session; sequential prompts preserve its history. |
| Session reset | Probe for native close | Close/terminate the old runtime, cancel pending callbacks, and create a new session without deleting the archived Cockpit session. |
| Resume after process restart | Authenticated | Persist the returned opaque ID through `external_session`. Resume returned no replay text and retained prior answers. Prefer negotiated `session/resume`; otherwise suppress replay during `session/load`. |
| Missing native-session recovery | Probe for failure shape; Cockpit for snapshot fallback | Match the missing-session error specifically and use the existing `sessionRecovery` hook before prompting a new native session. |
| Resume the exact active turn after server restart | Unsupported in tested path | A hard-killed CLI could resume history and accept the next prompt, without rerunning the fixture command. The pending turn was not reattached. Keep `activeTurnResume:"unsupported"`; do not retry an interrupted prompt automatically. |
| Abort and continue afterward | Authenticated | `session/cancel` stopped native shell work and a pending question; later turns worked. Native child cancellation also stopped its shell. Hard process death requires separate descendant cleanup. |
| Queue, edit, and follow-up behavior | Cockpit; Probe for steering | Keep normal queue management in Cockpit. Use `_x.ai/interject` for explicitly delivered mid-turn steering; do not send plain text into JSON-RPC stdin. |
| Models and reasoning effort | Authenticated | Real catalog contained Grok 4.7, 4.7 Fast, 4.6, and 4.5. Low effort and a real switch to 4.6 succeeded. Read negotiated options; Fast is a separate model ID. Preserve model-specific media validation. |
| Codex Fast or Claude-specific modes | Cockpit | Do not carry unrelated provider settings into Grok. Expose only negotiated Grok options. |
| Plan mode and approval | Authenticated | Approved one native plan; feedback revised a second plan and its resulting file. Retain `_x.ai/exit_plan_mode` request IDs until approval, feedback, cancellation, or abandonment. |
| Structured questions | Authenticated | Selection and cancellation worked; abort while the callback was pending recovered cleanly. Map `_x.ai/ask_user_question` to existing question events and its response schema. |
| Tool permission policy | Probe for MCP permission callback | Respond to `session/request_permission` using the selected deployment/profile policy and the option IDs supplied by Grok. Plan and question callbacks remain distinct. |
| Subagent lifecycle and grouped activity | Authenticated | Parallel children emitted lifecycle updates and standard child-session tool/text frames; child cancellation and durable replay worked. Filter root synthesis by session ID. The tested default supports one level of children, without grandchildren; authenticated child thought chunks were not observed. |
| Native goals and goal controls | Authenticated | Goal completion, cancel-based pause, persistence/restart, resume, clear, and `budget_limited` worked. Consume structured updates/state. A concurrent `/goal pause` prompt timed out; budget 1 still consumed 27,796 native goal tokens and wrote its fixture file. |
| Token and cache usage | Authenticated | Full prompt usage, cache subsets, model cost, and cumulative usage were returned. Normalize disjoint buckets and avoid adding child usage again to the root aggregate. |
| Reported cost and estimated cost | Authenticated for model cost | Decode cost ticks and completeness flags. Picker model `grok-4.7` reported usage under `grok-4.7-build`. Reported model cost is not proof of subscription cash charges or complete media/auxiliary spend. |
| Context usage indicator | Authenticated | `_x.ai/session/info` returned `context.used`, `total`, `freeTokens`, `usagePct`, and compaction fields. Use the returned window; the tested model used 256,000 tokens. |
| Account quota and subscription display | Authenticated, partial fields | Billing exposed period/reset metadata and monetary balance/cap fields, but no included-use percentage or remaining allowance for this account. Show available fields; do not synthesize quota percentages. |
| Server-configured profile and API-key env | Probe with fake key | Respect executable override and merged profile environment. Actual API authorization/entitlement remains unverified. |
| Shared terminal login and remote account auth | Authenticated for cached login; Source/docs for remote flow | Cached auth and a real prompt succeeded. An empty isolated home returned `Authentication required` without opening a browser. Add dedicated auth jobs/status; device flow, expiry/revocation, and entitlement failures remain untested. |
| Isolated account profiles | Source/docs for `GROK_HOME` | Map explicit `configDir` to `GROK_HOME`; preserve normal terminal auth for Welcome setup. Verify two-account isolation. Global skill discovery can still occur outside `GROK_HOME`. |
| Title and session-summary generation | Authenticated for underlying calls; Cockpit for wrappers | Restricted calls returned a clean title and summary. Implement ephemeral wrappers with timeout, cancellation, selected model/profile, and existing fallbacks. |
| Memory CLI extraction/write governance | Authenticated for tool-free JSON | Restricted session returned parseable governance JSON with no tool calls. Implement `runOneShot(allowTools:false)` using the verified profile, not only an instruction. This was a formatting fixture, not a real Memory save. |
| Cockpit Memory and KB search MCP | Authenticated with actual stubs and fixture HTTP | Real repository stubs performed both searches and Memory note calls. HTTP token revocation surfaced errors; resume with replacement env tokens restored calls. Preserve token ownership and governance; production backend/DB integration remains to test. |
| KB digestion, dreaming, and gleaning | Cockpit; Probe for underlying tools/MCP/multi-turn | Implement tool-enabled one-shots and native `runSessionShot`; preserve configured model, working directory, timeout, attachments, and MCP. |
| Image ingestion and attachment OCR | Authenticated for Grok 4.7 | Direct ACP PNG input read the synthetic text correctly despite `image:false` in negotiation. Gate the tested transport/model explicitly; limits and auxiliary charge coverage remain separate checks. |
| PDF, audio, and video input | Authenticated for native PDF; audio/video untested | Native `read_file` emitted `PdfPageImages` and read fixture text correctly. A PDF frame exceeded 64 KiB. Test Cockpit attachment mapping; leave audio/video disabled until verified. |
| Generated files and media artifacts | Authenticated for CSV and image generation | CSV had a valid `FILE_DELIVERY` marker. Native image generation returned structured `ImageGen.path` but its final text lacked a valid marker. Emit an artifact with `sourcePath`, using existing storage; verify desktop/mobile downloads after implementation. |
| Workspace instructions and Workspace Context | Authenticated for referenced markdown | AGENTS.md led to a context file; modifying that file and explicitly requesting a recheck returned the new text in the same session. This does not prove automatic refresh of changed managed instructions. |
| Workspace Routines | Authenticated for routine-style execution; Cockpit for service | A markdown fixture produced and verified its output file. Test actual scheduler/run-folder/history and disabled-workspace behavior after the one-shot adapter exists. |
| Grok native memory extraction/watching | Source; unverified | Keep optional `extractMemory`/`getMemoryDir` disabled until workspace scoping and stable storage are verified. Grok native memory must not replace Cockpit's governed Memory inbox. |
| Desktop and mobile PWA | Cockpit | Add profile/harness identity, icons, model options, goal handling, and capability-based controls; preserve the shared browser-safe stream contract. |
| Installation, doctor, updates, and migration checks | Cockpit | Add optional CLI detection/install/auth/update paths for supported platforms, including managed Windows entrypoints. Preserve existing macOS/Linux/Windows production paths. |

The source evidence for the additional behaviors is concentrated in
[ACP dispatch](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs),
[Grok notification types](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/notification.rs),
[subagent/task inspection](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/task.rs), and
[billing types](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/billing.rs).

## Authenticated results

| Check | Observed result |
|---|---|
| Shared machine auth | ACP `authenticate` with `methodId:"cached_token"` and `_meta.headless:true` succeeded; a tool-free real prompt returned its exact fixture marker. No API key or separate account home was needed. |
| Text and configuration | Clean title, summary, and governance JSON; low effort; actual 4.6 model switch; multi-turn recall after process restart. |
| Native tools and instructions | Routine-style markdown created the expected file; AGENTS.md context references were read and explicitly refreshed in the same session. |
| Questions and plans | Selected answer, cancelled answer, abort while a question was pending, plan approval, and feedback followed by revised plan approval. |
| Parallel children | Two children read separate files, emitted child tools/text and lifecycle events, and returned their markers to the parent. Child cancellation stopped the fixture shell process; the parent remained usable. |
| Goals | Native workers created and verified a file. Cancel-based pause persisted across restart; resume completed the goal. Clear and budget-limited state worked, with the limitations below. |
| Memory and KB MCP | Actual repository stubs searched fixture HTTP data, wrote a fixture Memory note, surfaced revoked-token errors, and accepted replacement tokens on native session resume. |
| Input media | Grok 4.7 read `RAVEN 731` from direct ACP PNG input and `HARBOR 829` from a native PDF read. |
| Output artifacts | Exact CSV and a generated 1024×1024 PNG. The PNG's pixels matched the requested red circle on white. Structured media paths are needed for artifact delivery. |
| Abort and hard crash | Normal cancellation stopped shell work and allowed the next turn. SIGKILL closed the pending RPC and left the shell alive; explicit cleanup was required. History resumed afterward without repeating the command. |

### Authenticated model catalog

| Model ID | Display name | Advertised reasoning effort |
|---|---|---|
| `grok-4.7` | Grok 4.7 | `xhigh`, `high` (default), `medium`, `low` |
| `grok-4.7-build-fast` | Grok 4.7 Fast | `xhigh`, `high` (default), `medium`, `low` |
| `grok-4.6` | Grok 4.6 | `xhigh`, `high` (default), `medium`, `low` |
| `grok-4.5` | Grok 4.5 | `high`, `medium`, `low` |

The catalog advertised 256,000- and 500,000-token context windows for the 4.7
entries. The exercised sessions reported a 256,000-token window. The Fast entry
was described as a separate variant at twice the price; its inference and
actual cost were not exercised. Do not map Cockpit's Codex Fast toggle to Grok
Fast. The catalog contained no explicit input-image modality flags, even though
the tested 4.7 image/PDF paths succeeded. Model capabilities therefore need
versioned compatibility evidence in addition to catalog parsing.

### Billing availability

The real `_x.ai/billing` result contained top-level `config` and
`subscription_tier`. The observed config keys were `currentPeriod`,
`onDemandCap`, `onDemandUsed`, `prepaidBalance`, `isUnifiedBillingUser`,
`billingPeriodStart`, and `billingPeriodEnd`. `currentPeriod` contained `type`,
`start`, and `end`, with a weekly period enum. Monetary fields were objects with
integer `val`; the inspected source defines those as USD cents, distinct from
model-cost ticks. Decode these units separately.

No `creditUsagePercent`, included allowance/usage, legacy monthly limit, or
history was returned for this account. `_x.ai/auth/check_subscription` confirmed
authenticated status and supplied entitlement metadata, but no quota percentage.
The quota UI can expose the available tier, period/reset, and monetary fields;
it cannot infer included-credit consumption or a remaining percentage from this
response. Other account tiers and refresh/failure behavior still need tests.

## Protocol findings that affect the adapter

### Transport and capability negotiation

`initialize` negotiated ACP version `1`, `loadSession:true`, session list/resume/close,
HTTP/SSE MCP capabilities, and embedded context. Model/effort options appeared
in both initialization metadata and session responses. The fixture catalog
advertised low/medium/high effort; an unknown model produced JSON-RPC `-32602`
with `data:"unknown model id"`.

Set client filesystem and terminal capabilities to false initially. The probes
confirmed Grok can perform those operations natively. Advertising client-hosted
filesystem/terminal capabilities would require Cockpit to implement those
reverse RPC methods, ownership, cleanup, and output handling as well.

The wire names of Grok extensions start with `_`: for example,
`_x.ai/models/list`, `_x.ai/session/usage`, and `_x.ai/interject`. Rust source
dispatch strings omit that leading underscore because the protocol library
handles it. Calls without the underscore returned `-32601`; prefixed calls
succeeded. Some extension responses have a nested `result` object while others
return their payload directly; decode each response shape explicitly. [ACP extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)

Route incoming messages by `method` before treating an `id` as a response.
The real question callback used request ID `0`, so truthiness checks on IDs are
incorrect. Separate outgoing request correlation from incoming reverse-request
correlation, and service reverse requests while a prompt remains pending.

Allow large newline-delimited JSON frames while retaining a bounded buffer. A
single PDF tool frame in the authenticated test was **185,782 bytes**. The test
client's initial 64 KiB reader limit failed; increasing it to 32 MiB allowed the
same PDF path to complete. That was a client framing defect, not a PDF rejection.
An adapter must also handle split reads, multiple frames per read, malformed
frames, EOF, and backpressure without losing an outstanding reverse request.

The released binary emitted live Grok updates on
`_x.ai/session_notification` and replayed Grok updates on `_x.ai/session/update`.
Normalize both into one internal representation and deduplicate by event/turn
identity where the same durable outcome can be encountered again.

### Session recovery and turn completion

After process termination and respawn, `session/load` returned the prior model
and effort and replayed **17 user/assistant text chunks** in the fixture session.
Those are historical messages, not current response text. The standard
`session/resume` path returned **zero history chunks**, and the next inference
request still contained the prior conversation. Prefer resume when negotiated;
keep load-with-replay-suppression as the compatibility path. [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup)

Persist native session identity independently of the child PID. Cache a runtime
by conversation plus effective profile configuration and execution directory;
respawn when a material runtime setting changes. Session reset must clear that
mapping and pending input without confusing stable conversation IDs with
Cockpit's changing session IDs.

A missing session produced this released-binary error:

```json
{
  "code": -32603,
  "message": "Path not found.",
  "data": {"detail": "No such file or directory (os error 2)", "code": "FS_NOT_FOUND"}
}
```

Treat that failure from a native resume/load operation as a recovery candidate.
Do not classify every `-32603`, filesystem error, auth rejection, or timeout as
a missing session.

Normal prompts returned `stopReason:"end_turn"`. Cancellation returned
`stopReason:"cancelled"`, and a subsequent prompt succeeded. Structured
`turn_completed` updates and `_x.ai/session/prompt_complete` were also emitted.
Finalize a Cockpit turn once, correlate these signals to the native prompt ID,
and process final usage before releasing the stream. Do not end the stream
merely because a background tool or child finishes.

The source exposes durable update retrieval and optional leader/reconnect
behavior. Those mechanisms are candidates for future active-turn reattachment,
but do not prove that Cockpit can safely survive its own process death without
duplicating side effects. Start with `activeTurnResume:"unsupported"` and an
accurate reason. [Durable update retrieval](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/session_updates.rs)

Authenticated cancellation stopped both a root Python shell fixture and a
child-owned shell fixture before their completion files could be written. A
pending question could also be cancelled without preventing the next prompt.
However, SIGKILL of the CLI during a shell tool left that shell process alive.
After explicitly terminating it, a new CLI resumed the native session and
completed a text prompt; the fixture command's execution counter stayed at one.
This verifies recovery of history, not continuation of the interrupted turn.
Supervision must contain and clean up owned descendants on timeout, shutdown,
and unexpected CLI exit. Track ownership rather than killing every `grok` or
shell process on the machine, and do not automatically resend interrupted work.

### Questions, plans, and mid-turn input

Questions use `_x.ai/ask_user_question` with `sessionId`, `toolCallId`,
`questions`, and a mode. The accepted fixture reply was:

```json
{"outcome":"accepted","answers":{"Choose fixture color?":["Blue"]}}
```

Source types also support annotations, cancellation, and plan-specific
chat/skip paths. Map ordinary selection and free-text answers to Cockpit's
existing UI first; gate additional paths on actual UI support. [Question wire types](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/implementations/grok_build/ask_user_question/types.rs)

Plan approval uses `_x.ai/exit_plan_mode` with `sessionId`, `toolCallId`, and
`planContent`. A fixture plan was returned as markdown and approval produced a
successful `PlanReady` tool outcome. Grok can also ask to exit with null plan
content. Replies distinguish `approved`, `cancelled` with optional feedback,
and `abandoned`; cancellation is not the same as permanent abandonment. Retain
the original reverse-request ID until Cockpit delivers the user's decision.
[Plan wire types](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/implementations/grok_build/exit_plan_mode/types.rs)

The authenticated plan test approved one plan and verified its output file.
For a second plan, `cancelled` with feedback changed the requested output marker;
Grok revised the plan, asked again, and produced the revised marker after
approval. Thus feedback must retain the session and support another callback,
rather than treating all cancellation outcomes as a terminal turn failure.

`SendMessageResult.sendInput(text)` can remain the facade. Inside Grok, route
the submitted value to a pending question/plan request, or to an explicit
steering operation as appropriate. The latter uses `_x.ai/interject` with
`{sessionId,text,interjectionId}`. The probe returned a queued acknowledgment
and the marker appeared in the next model request at the tool-loop boundary.
Unsolicited ordinary chat messages should remain in Cockpit's queue rather
than become arbitrary native RPC input. [Steering implementation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/interject.rs)

### Usage normalization and cost completeness

The scripted model supplied 100 input tokens, including 30 cache-read tokens,
and 20 output tokens. Grok's full prompt usage reported:

```json
{"inputTokens":100,"cachedReadTokens":30,"cacheCreationTokens":0,"outputTokens":20}
```

Cockpit represents uncached input, cache reads, and cache writes separately.
Normalize this case to `inputTokens:70`, `cacheReadTokens:30`,
`cacheWriteTokens:0`, and `outputTokens:20`. In general, subtract the cache-read
and cache-creation subsets from Grok's full input before filling those separate
buckets. Reasoning tokens are a subset of output; do not add them again.

Use `session/prompt.result._meta.usage` or the correlated `turn_completed.usage`
once per turn. A two-call fixture returned full usage of 200 input/40 output,
while sibling `_meta.inputTokens`/`outputTokens` still described only the last
100-input/20-output call. Sibling metadata is not the aggregate bill.

`_x.ai/session/usage` is cumulative for the resident process. It reported
1,000 input/200 output before restart and **zero** immediately after reload.
Cockpit's persisted usage ledger remains authoritative across process epochs;
never replace its totals with that zero, or add cumulative snapshots repeatedly.

Source cost units are `costUsdTicks / 10_000_000_000`. Missing cost, partial cost,
and `usageIsIncomplete` must not be displayed as a trustworthy zero bill. The
source folds subagent usage, so adding child totals separately risks double
counting. The authenticated parallel-child root prompt and resident usage
reported the same aggregate: 80,364 full input tokens, 49,408 cache reads, 490
output tokens, seven model calls, and 304,490,400 cost ticks. Individual child
completion frames also carried usage; use those for child attribution rather
than adding them again to the conversation bill. Completeness across service
errors, interrupted processes, and auxiliary media charges remains to verify.
[Usage response and epoch semantics](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/usage.rs)

A real tool-free prompt reported 4,020 full input tokens, 1,152 cache reads, 42
output tokens (including 36 reasoning tokens), and 22,317,600 cost ticks:
`inputTokens:2868`, `cacheReadTokens:1152`, `outputTokens:42`, and reported model
cost `$0.00223176` after normalization. The session model was `grok-4.7`, while
`modelUsage` used `grok-4.7-build`. Preserve both the selected model and usage
model identity for display/pricing provenance. This model-cost amount is not a
measurement of cash deducted from a subscription account.

Image description introduced separate `grok-4.6` Responses requests in the
released-binary fixture. The returned prompt usage listed only `probe-model`,
even though the loopback companion response included usage too. This demonstrates
that the observed prompt ledger did not include that auxiliary fixture call;
it does not establish how the production service bills image description.
Validate auxiliary costs against real responses before claiming complete
account spending coverage.

### Restricted one-shots and background services

Passing top-level `--tools ""` before `agent stdio` left **25 tools** in the
model request. Empty tools also means inherit in the source agent definition.
An empty curated tool configuration was rejected during session initialization.
Neither path is a reliable tool-free ACP call.

The following session `_meta.agentProfile` exposed **zero** tools in the actual
inference request and completed a text prompt:

```json
{
  "name":"cockpit-one-shot",
  "description":"Text extraction without tools",
  "discoverSkills":false,
  "agentsMd":false,
  "injectDefaultTools":false,
  "toolConfig":{"tools":[{"id":"GrokBuild:read_file"}]},
  "disallowedTools":["read_file"]
}
```

The nonempty declaration satisfies Grok's curated-toolset validation, and the
denylist removes its only tool before sampling. Keep this provider-specific
restriction under direct compatibility coverage, reject unexpected reverse
permission requests in a tool-free call, and do not expose chat MCP servers to
it. Verify future versions still produce no callable tools before trusting
this path for Memory governance, titles, or extraction.
[Agent profile parsing](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/upload/turn.rs),
[agent definition and builder](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-agent/src/builder.rs)

For `allowTools:true`, use a separate ephemeral session with the normal toolset,
explicit MCP configuration, profile, cwd, model/effort, and deployment policy.
Implement `runSessionShot` by sending sequential prompts through that one
ephemeral session rather than paying to replay prior text into fresh calls.
Collect clean root assistant text, excluding tool output and child narration.
Apply hard caller-owned timeouts and abort signals and terminate the process on
success, cancellation, and failure, including owned descendants. Authenticated
restricted sessions returned a clean title, one-sentence summary, and parseable
Memory-governance fixture JSON with no tool activity. A routine-style markdown
prompt executed native tools and verified the resulting file. These establish
the underlying one-shot paths; they do not validate Cockpit's service wrappers.

This supplies the primitives used by
[Workspace Context](../../src/services/workspaceContext/service.ts),
[Routines](../../src/services/routines/service.ts),
[KB digestion](../../src/services/knowledgeBase/digest.ts), and
[KB dreaming](../../src/services/knowledgeBase/dream.ts). End-to-end tests still
need to validate each service's parsing, filesystem results, and failure paths.

### MCP and media

A stdio MCP server injected at `session/new` received `initialize`,
`notifications/initialized`, `tools/list`, and `tools/call`. Its log location
arrived through ACP's `env:[{name,value}]` representation. Grok discovered its
tool through `search_tool` and invoked it through `use_tool`; its tool name was
`probe-mcp__probe_echo`, not the Claude-style `mcp__probe-mcp__probe_echo`.
Resolve tool identity from structured metadata/output rather than assuming
another harness's naming convention. [Grok MCP documentation](https://docs.x.ai/build/features/mcp-servers)

The authenticated test launched Cockpit's actual
[Memory stub](../../src/services/memoryMcp/stub.cjs) and
[KB stub](../../src/services/kbSearchMcp/stub.cjs) with separate token env arrays
against a synthetic local HTTP server. Grok successfully invoked `memory_search`,
`memory_note`, and `search_topics`. Revoking the first token generation produced
HTTP 401 tool errors. The model reported that the Memory note was not saved and
did not create a local Memory fallback file. Respawning the CLI and resuming the
same native session with fresh `mcpServers` env tokens restored both searches;
the fixture HTTP log confirmed the replacement generation. This validates the
stdio/token lifecycle, not production Memory governance or KB database queries.

The initial handshake advertised `promptCapabilities.image:false` and
`audio:false`, yet a valid 32×32 PNG sent as an ACP image block reached a
companion vision request. Reading that PNG with the native file tool returned
typed image content and also reached the companion pipeline. A 1×1 image was
dropped with a minimum-size explanation. Respect both protocol negotiation and
provider/model validation; this evidence supports a specific tested transport,
not blanket image/audio/PDF/video capability flags for every model.

Keep Cockpit's two-level media gate: backend transport plus a model's verified
input modality. In the authenticated test, Grok 4.7 correctly read synthetic
text from a 720×240 PNG supplied as an ACP image block. Its native PDF file tool
returned `PdfPageImages`, and the model correctly read the fixture's text.
The negotiated image capability still said false. Do not reduce media support
to that single negotiation flag or enable every catalog model without evidence.
Cockpit's own attachment upload/mapping, format/size limits, and browser download
flows remain implementation checks.

Native `image_gen` generated a real 1024×1024 PNG. Its tool `rawOutput` included
`{type:"ImageGen",path,filename,session_folder}`. A generated CSV used the full
Cockpit delivery marker, but the image response contained only a path and the
literal marker name. The adapter should translate structured generated-media
paths into `ArtifactEvent.sourcePath`, letting the existing
[ArtifactStore](../../src/services/chat/artifactStore.ts) copy and serve the
file, including when it originates in Grok's native session folder. Text/tool
frames alone will not provide Cockpit's download UI. Correlate and deduplicate
artifacts if both a marker and structured output refer to the same file.

Real image input, PDF input, and image-generation prompt usage listed only
`grok-4.7-build`; no separate vision/media cost entry appeared. The authenticated
tests did not intercept internal inference routing or reconcile account charges.
Preserve the observed model-cost ledger without promising complete auxiliary
spend. Audio/video ingestion or generation was not exercised.

### Instructions, profiles, subagents, and goals

Session `_meta.rules` placed a fixture instruction into the real system-message
request. The source appends these rules at new-session creation; it does not
automatically append changed rules on a later attach. Source
`systemPromptOverride` replaces the entire leading system prompt, including on
attach, so using it merely to append Cockpit instructions would discard Grok's
own prompt. Preserve Grok's prompt and inject managed instructions deliberately.
[System prompt handling](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/mod.rs)

In the authenticated fixture, AGENTS.md pointed to a context markdown file and
Grok read its marker. After the file changed, an explicit recheck returned the
new marker in the same session. This supports referenced-file refresh; it does
not prove automatic ingestion of newly changed AGENTS.md or session rules.
Cockpit must deliver managed-instruction changes deliberately and preserve
disabled-workspace behavior.

`GROK_HOME` is the documented configuration/auth root override. A normal profile
should reuse terminal Grok auth, while an explicitly isolated profile can
select its own root. The default fixture session still discovered user-global
Claude-compatible skills outside the temporary `GROK_HOME`; home isolation does
not imply complete instruction or filesystem isolation. The restricted profile
above disabled skill/instruction discovery for its extraction call.
[Settings scopes](https://docs.x.ai/build/settings)

The authenticated parallel-child run emitted `subagent_spawned`,
`subagent_progress`, and `subagent_finished`. Standard `session/update` messages
for each distinct child session also carried tools, outcomes, and assistant
text on the same connection without an extra subscription. Map lifecycle
`parent_session_id`/`child_session_id` to Cockpit's agent ownership, and filter
root answers by the root session ID. The low-effort authenticated sample did
not emit thought chunks; child thought attribution still needs direct coverage
when the CLI supplies them.

`_x.ai/subagent/get` returned its snapshot at
`response.result.result.snapshot`, with completed/cancelled status and
parent/child identities. `_x.ai/session/updates` retrieved durable child updates.
`_x.ai/subagent/cancel` cancelled an active child and its owned shell process;
the parent accepted another turn. Child errors, replay deduplication, and browser
rendering still need adapter tests.

An explicit request for a grandchild did not create one: the child reported that
the spawn tool was unavailable. The installed CLI's bundled subagent guide also
documents top-level spawning with a maximum nesting depth of one. Advertise
parallel native children for the tested default, rather than recursive native
delegation. A curated nonempty profile `tools` list needed the `Agent` directive
to enable the tested child tool group; listing `spawn_subagent` alone did not
expose it. A failed initial run without that directive was a test-profile error.
Profile tool-group expansion therefore needs coverage alongside restrictions.
[Official subagent guide](https://docs.x.ai/build/features/subagents)

Native goals use `/goal <objective> [--budget <tokens>]`, status, pause, resume,
and clear commands through `session/prompt`. The clear probe emitted structured
`goal_updated` state. Source `_x.ai/session/state` can retrieve persisted goal
state, and source goal updates include objective, status, budget, tokens, and
elapsed time. This can feed Cockpit's goal model after extending its current
backend union. Map Grok pause variants and blocked reasons explicitly, and
keep budget/completion semantics native; do not recreate a competing goal loop.
[Goal command parsing](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/slash_commands.rs),
[persisted state access](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/session_state.rs)

The authenticated goal created and verified its exact fixture file. Sending a
second `session/prompt` with `/goal pause` while the goal's original prompt was
active timed out after 60 seconds. Cancellation then paused the native goal.
A separate test sent `session/cancel` immediately upon an active goal update:
the prompt completed in about 0.26 seconds, the planner child was cancelled,
and `goal_updated` plus persisted state confirmed `user_paused`. The idle
`/goal pause` command subsequently reported that it was already paused.

Implement active `pauseGoal` by cancelling the native session turn, awaiting its
completion, and confirming `user_paused`; use slash control prompts after the
session is idle. Serialize prompt ownership rather than opening a concurrent
control prompt. A paused goal survived CLI restart, `/goal resume` completed it,
and `/goal clear` removed it. This path allows native goals without building a
second Cockpit execution loop.

Live goal updates expose `tokens_used`, `token_budget`, status, phase, elapsed
time, and worker/verifier progress. Persisted state uses
`goal.tokens_used_high_water` and capitalized phases such as `Executing`/`Idle`,
while live phases used lowercase strings. Decode the two shapes explicitly.
Goal counters are distinct from the total repeated input tokens in the usage
ledger. A completion update reported 72,812 goal tokens; the later state
reported 81,322 after additional work settled. Continue consuming correlated
usage and state through native prompt completion, even after a goal-complete
notification.

A goal budget of **1** still produced its requested file, consumed **27,796**
native goal tokens, and only then reported `budget_limited`. Treat this as a
native checkpoint limit, not a hard spending cap or prevention of side effects.
Preserve the budget-limited outcome in the UI and explain its semantics when a
user chooses a budget.

## Implementation scope

Use the proposed harness/backend identity `grok-build`, label **Grok Build**, and
default command `grok`. Keep the Grok adapter facade stable and put transport,
session lifecycle, event decoding, interactions, usage, models, and one-shots in
focused owning modules. The existing Kiro ACP client is private and mixes Kiro
extensions with transport; sharing ACP is not sufficient reason to copy the
whole adapter or refactor it as part of the first Grok implementation.

| Area | Required repository changes |
|---|---|
| Backend registration | Add the adapter and tests; register it in `server.ts`; implement metadata, streaming, shutdown, and reset. |
| Profiles and validation | Extend `CliHarness`, shared browser-safe profile validation, `SUPPORTED_CLI_HARNESSES`, labels/default commands, settings normalization, runtime resolution, and profile-specific model discovery. Preserve legacy migration boundaries. |
| Streaming and interactions | Translate into the existing `StreamEvent` and browser-safe frame union. Keep protocol extensions server-side and UI state changes in the existing reducers/hooks. Reuse existing question/plan input delivery with explicit pending-request ownership. |
| Recovery and goals | Persist external IDs; integrate missing-native-session snapshots. Extend goal types/routes and both clients; implement serialized cancel-based pause, native resume/clear, and distinct budget-limited outcomes. Leave active-turn reattachment unsupported. |
| Usage and quota | Add a focused Grok usage normalizer; preserve selected/usage model IDs and reported-cost provenance. Add a profile-scoped billing service/cache with optional fields and separate cents/ticks units; hide unavailable allowance percentages. |
| Background jobs | Implement title/summary wrappers, tool-free/tool-enabled `runOneShot`, native sequential `runSessionShot`, timeouts, cancellation, media transports, and MCP forwarding. |
| Auth and operations | Extend auth checks/jobs, Welcome setup, Install Doctor, CLI detection/update catalogs, and migration post-import validation. Prefer managed native Windows package entrypoints and preserve private-runtime behavior where applicable. Disable automatic CLI mutation during supervised conversations. |
| Desktop and mobile | Add identity/icons and harness selection to both clients. Validate model/effort menus, plans/questions, goals, reconnect, persisted activity, usage, and artifacts. Update generated mobile assets only through the existing build process. |
| Documentation and compatibility | Update `BACKENDS.md`, user/reference docs, relevant specs/test inventory, and a pinned real-Grok compatibility procedure. Reassess an ADR when implementation establishes transport/module boundaries or extends persisted contracts. |

The recommended initial capability mapping, once implemented and covered in
Cockpit, is:

| Existing capability | Mapping |
|---|---|
| `thinking`, `planMode`, `toolActivity`, `userQuestions` | Enable their verified wire mappings; include child-session ownership and pending-interaction cleanup. Thinking was exercised by the fixture protocol probe, not the low-effort real child sample. |
| `stdinInput` | Enable the facade for answers/plan decisions/explicit steering. Its implementation uses reverse RPC responses or `_x.ai/interject`, not plain text on stdin. |
| `agents` | Enable parallel native children with the default depth-one constraint. |
| `goals` | `{set:true,clear:true,pause:true,resume:true,status:"native"}` after cancel-based pause and persisted/live-state decoding are implemented. |
| `sessionResume` | `"supported"` for next-turn native history recovery. |
| `activeTurnResume` | `"unsupported"`; a hard-crashed active turn was not reattached and may leave tool descendants. |
| `oneShotMediaInput` | Image via the tested explicit ACP attachment/native-file transports; PDF via the tested native-file tool. Pair these with verified model capabilities, initially Grok 4.7. Keep audio/video disabled. |

The evaluation changes no architecture rule or implemented behavior, so it does
not require an ADR or changes to `AGENTS.md`. Implementation will cross several
subsystems and should make that ADR decision before a PR. A doc-only evaluation
does not add Grok to the supported-backend tables.

## Verification required before first-class support

The next implementation should have fixture tests for large/split framing, request ID zero,
reverse-request races, malformed/error frames, finalization, replay suppression,
usage normalization/epochs/completeness, missing-session classification, profile
changes, child-session demultiplexing, goal state/pause/budget behavior,
structured artifact paths, process-tree cleanup, and no-tool enforcement.
Those deterministic tests are distinct from the authenticated tests performed
here. The temporary evaluation scripts are not an installed Cockpit test suite;
add a pinned opt-in real-Grok compatibility procedure with implementation.

The authenticated results above settle the earlier unknowns about shared login,
real model inference, parallel children, native goal execution, basic media,
model-cost fields, and the account billing response. The remaining release gates
are:

1. **Auth and profiles:** real API-key authorization if supported by the intended
   setup, remote device-login jobs, entitlement failures, real credential
   expiry/revocation, login cancellation, two independent account homes,
   command/env overrides, and Fast-model inference/cost. The empty-home negative
   test does not substitute for expired credentials.
2. **Runtime supervision:** two simultaneous workspaces/profiles, reset during
   tools/interactions, missing-session snapshot recovery in Cockpit, and owned
   descendant cleanup on every shutdown/error path. Verify that cleanup cannot
   kill a different conversation's processes. Preserve no automatic retry after
   an interrupted tool turn.
3. **Desktop and mobile:** model/effort selection, questions with free text and
   multiple selections, plan abandonment/revision, steering, pending-input
   reconnect, child grouping/thinking, goal controls and budget semantics,
   persisted activity, usage display, and artifact downloads through shared
   contracts. This evaluation changes documentation only and requires no mobile
   asset rebuild.
4. **Memory and KB services:** real token-scoped production stub endpoints and
   write governance, collision handling, service-level parsing/fallbacks,
   digestion/gleaning/dreaming, tool-free extraction, attachment upload/mapping,
   caller timeouts, and actual artifact-store ingestion. The tested HTTP fixture
   bypassed the production backend and databases.
5. **Workspace services:** automatic managed-instruction refresh, Workspace
   Context maintenance, disabled-workspace behavior, and actual unattended
   Routine scheduling with selected profile, execution directory, run history,
   files, cancellation, and failure propagation.
6. **Accounting:** interrupted/error usage completeness, auxiliary media and
   mixed-model costs, cash-charge reconciliation, pricing estimates, other
   account quota shapes, and quota refresh/failure behavior. Do not substitute
   unsupported percentages or zero cost for missing data.
7. **Packaging and optional features:** version detection/update compatibility,
   macOS installer integration, Ubuntu 24.04 x64 and Windows launch/install/auth,
   plus any separately advertised audio/video paths or Grok native Memory
   extraction/watching. Neither cross-platform compatibility nor these optional
   native features were exercised.

The evidence supports implementing the adapter with the capability mapping
above. It does not make Grok an implemented Cockpit backend or remove the need
to validate the application paths after integration.
