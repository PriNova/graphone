# Sequenced Implementation Roadmap

## Purpose

This document turns the architecture and workstream plans in this folder into a **single sequenced execution roadmap**.

Use it as the program tracker for the Graphone platform-extensibility effort.

It exists to answer three practical questions:

1. **What should be implemented first?**
2. **What can be done in parallel vs what should wait?**
3. **How do we keep Graphone working during the migration, in strangler-fig style?**

---

## Status

**Current recommended starting point:** Phase 1 — durable host recovery ledger

Reason:

- it strengthens the canonical runtime boundary in `services/agent-host`
- it directly addresses accidental session/sidecar termination recovery
- it is additive and low-risk
- it does not block current desktop behavior
- it creates the recovery foundation needed before broader transport/client refactors

---

## Operating rules for this roadmap

1. **Use strangler-fig sequencing.** Prefer additive seams and adapters over rewrites.
2. **Keep Graphone working at every meaningful stage.** Desktop flow should remain usable while new boundaries are introduced.
3. **Put runtime/session recovery in the host service boundary, not in the frontend.**
4. **Reuse pi persistence semantics.** Do not build a second message/session store in Graphone.
5. **Track agent progress coarsely, not token-by-token.** Persist recoverable execution checkpoints, not transient stream noise.
6. **Do browser mode only after service and client boundaries exist.**
7. **Do Graphone executable plugins only after declarative UI contracts are stable.**

---

## Roadmap at a glance

| Phase | Name | Primary workstreams | Goal | Status |
| --- | --- | --- | --- | --- |
| 1 | Durable host recovery ledger | WS-A, WS-B (slice) | Recover hosted sessions/runs after accidental termination | In progress (Phase 1A) |
| 2 | Service capabilities + runtime reflection | WS-B | Make runtime/service metadata explicit to clients | Planned |
| 3 | Frontend service client extraction | WS-D | Move core runtime access behind a service client boundary | Planned |
| 4 | Desktop shell adapter extraction | WS-E | Isolate Tauri/native shell behavior from shared UI | Planned |
| 5 | HTTP + WebSocket service transport | WS-C | Expose the same host runtime to browser-capable clients | Planned |
| 6 | Browser mode v1 | WS-F | Run the main workbench in a browser against the service | Planned |
| 7 | Declarative Graphone UI extensibility | WS-G | Formalize Graphone UI metadata/rendering contracts | Planned |
| 8 | Graphone plugin foundation | WS-H | Add a small local workbench plugin API | Planned |

---

## Relationship to other planning docs

- `01-architecture-principles.md` defines the non-negotiable rules.
- `03-service-runtime-and-api-plan.md` defines the target service/runtime shape.
- `04-client-shell-and-browser-plan.md` defines the frontend extraction shape.
- `05-graphone-plugin-api-plan.md` defines the Graphone plugin direction.
- `07-parallel-workstreams.md` defines how work can be split across agents.
- **This file defines the recommended implementation order and serves as the tracker.**

---

## Phase 1 — Durable host recovery ledger

## Goal

Persist enough Graphone-owned supervisory state so that if a hosted session or sidecar dies unexpectedly, Graphone can reopen the pi session file and continue from the last durable checkpoint.

## Why first

Today, pi already persists the conversation via `sessionFile`, but Graphone loses in-memory hosting state when the sidecar dies.

This phase closes that gap without changing the fundamental architecture.

## Scope

Add a small host-side recovery/ledger layer in `services/agent-host`.

Suggested file:

- `services/agent-host/src/session-ledger.ts`

Suggested tracked state:

### Session-level

- `graphoneSessionId`
- `sessionFile`
- `cwd`
- `createdAt`
- `updatedAt`
- `status`
- `lastKnownModel`
- `activeRunId?`
- `lastError?`
- `activeToolName?`

### Run-level

- `runId`
- `sessionId`
- `kind` (`prompt` / `steer` / `follow_up`)
- `startedAt`
- `updatedAt`
- `endedAt?`
- `status`
- `promptPreview`
- `activeToolName?`
- `lastCheckpoint`

Suggested statuses:

- `idle`
- `running`
- `tool_running`
- `aborting`
- `completed`
- `failed`
- `interrupted`

## Resume semantics

For this program, **resume** means:

- reopen the last durable pi session state from `sessionFile`
- mark any non-terminal in-flight run as `interrupted`
- allow the user to continue with a new prompt/follow-up from that point

It does **not** mean resuming mid-token or mid-tool syscall exactly where execution stopped.

## Acceptance criteria

- [x] Host persists supervisory session/run metadata outside process memory
- [x] Sidecar/session crash leaves recoverable session metadata behind
- [x] On restart, Graphone can list recoverable sessions tied to `sessionFile`
- [x] In-flight work is marked `interrupted`, not silently forgotten
- [ ] Existing desktop flow still works

## Recommended first implementation slice

1. Add the ledger module
2. Write coarse checkpoints from `HostRuntime`
3. Rehydrate ledger entries on startup
4. Surface recovery state through host responses
5. Add desktop UI affordance for interrupted/recoverable sessions later, after host data exists

### Phase 1A/1B status — 2026-03-06

Implemented locally in `services/agent-host` and the desktop web client:

- added a durable host-owned ledger module at `services/agent-host/src/session-ledger.ts`
- persisted coarse session/run checkpoints to `~/.pi/agent/graphone/session-ledger.json`
- marked non-terminal runs `interrupted` on host restart
- surfaced ledger-backed `recoverableSessions` through `list_sessions`
- attached per-session recovery summaries to live hosted session info
- added focused ledger tests under `services/agent-host/test/session-ledger.test.ts`
- updated desktop bootstrap/sidebar flows to consume recoverable session files before starting unrelated fresh sessions
- exposed interrupted/recoverable session state in the session sidebar so the next agent or user can continue from the last durable checkpoint

Deliberate narrowing for early continuation/revert safety:

- recovery remains **coarse-grained** only (reopen `sessionFile`, continue with a new prompt)
- no mid-token or mid-tool resume attempt
- queued steer/follow-up intent is checkpointed coarsely rather than modeled as a full durable host queue
- desktop recovery UI stays inside the existing scope/history affordance instead of introducing a new workflow surface yet

Continuation notes for the next agent:

- run a desktop-mode manual smoke once a GUI session is available, specifically: crash/kill sidecar, relaunch, reopen interrupted session from sidebar, continue with a new prompt
- decide whether queued continuation requests need a richer durable host queue model or can remain coarse
- only after that manual smoke should Phase 1 be marked fully complete in the tracker

Rollback notes for the next agent:

- the recovery slice is still additive/strangler-safe and isolated mainly to `services/agent-host` plus sidebar/bootstrap consumption in the web client
- if this slice must be reverted early, remove the `session-ledger.ts` integration points, revert the desktop `recoverableSessions` consumption, and delete `~/.pi/agent/graphone/session-ledger.json`
- no pi runtime loader semantics were changed

---

## Phase 2 — Service capabilities + runtime reflection

## Goal

Make the host self-describing enough that clients do not have to guess what the runtime supports or what pi loaded.

## Scope

Implement/add:

- service identity/capabilities
- available commands reflection
- resource diagnostics summaries
- resource reload
- protocol version metadata

## Acceptance criteria

- [ ] Client can ask what transports/features/auth modes are supported
- [ ] Client can ask what commands/resources are available from the runtime
- [ ] Resource reflection comes from pi-backed runtime state
- [ ] No duplicate Graphone-side loader/registry exists

---

## Phase 3 — Frontend service client extraction

## Goal

Move core session/runtime operations behind a service client interface while still using the current desktop path underneath.

## Scope

Introduce:

- `src/lib/service/types.ts`
- `src/lib/service/client.ts`
- `src/lib/service/tauri-client.ts`
- event subscription abstraction

Migrate shared code off direct `invoke(...)`/`listen(...)` usage for core session behavior.

## Acceptance criteria

- [ ] Shared UI no longer depends directly on raw Tauri APIs for core runtime behavior
- [ ] Desktop still works through the new service client boundary
- [ ] Stores/handlers become easier to retarget to HTTP/WebSocket later

---

## Phase 4 — Desktop shell adapter extraction

## Goal

Separate desktop-only window/focus/native behavior from the shared workbench.

## Scope

Introduce:

- `src/lib/desktop/types.ts`
- `src/lib/desktop/tauri.ts`
- `src/lib/desktop/browser.ts`

Move Tauri-specific windowing and focus code there.

## Acceptance criteria

- [ ] Shared UI no longer directly owns Tauri window/focus behavior
- [ ] Desktop features still work in desktop mode
- [ ] Browser mode can safely no-op unsupported desktop features

---

## Phase 5 — HTTP + WebSocket service transport

## Goal

Expose the same host runtime over browser-friendly transports.

## Scope

Add:

- HTTP request/response server
- WebSocket event stream
- transport adapters around the canonical host protocol

## Acceptance criteria

- [ ] Browser-safe transport exists
- [ ] Stdio transport still works
- [ ] HTTP/WS adapt the existing runtime contract rather than redefining it

---

## Phase 6 — Browser mode v1

## Goal

Run the main Graphone workbench in a normal browser against the service.

## Scope

Keep v1 narrow:

- single main window
- main chat flow
- session list/create/open
- streamed output
- history load
- core model/settings behavior

## Acceptance criteria

- [ ] Browser loads without Tauri runtime failures
- [ ] Main chat flow works end-to-end against the service
- [ ] Desktop flow still works

---

## Phase 7 — Declarative Graphone UI extensibility

## Goal

Stabilize Graphone-specific UI metadata conventions before introducing executable plugins.

## Scope

Formalize:

- `details._html`
- renderer hints
- structured artifact/view metadata
- renderer routing/registry foundations

## Acceptance criteria

- [ ] Graphone declarative UI metadata is documented and stable
- [ ] Renderer routing points exist
- [ ] Rich UI output works without executable plugin loading

---

## Phase 8 — Graphone plugin foundation

## Goal

Add a small, local, versioned Graphone workbench plugin API.

## Scope

Start narrowly with contribution points like:

- tool renderers
- settings sections
- commands/actions
- panels/inspectors

## Acceptance criteria

- [ ] Plugin API is versioned
- [ ] At least one bounded contribution point works end-to-end
- [ ] Plugin failures are isolated
- [ ] Remote services cannot auto-inject executable client plugins

---

## Phase dependencies

Use this simplified dependency view:

- Phase 1 -> Phase 2
- Phase 2 -> Phase 3
- Phase 3 -> Phase 4
- Phase 2 + Phase 3 -> Phase 5
- Phase 4 + Phase 5 -> Phase 6
- Phase 7 -> Phase 8

Phase 7 can start in parallel with Phases 2-5 if the team stays within declarative rendering contracts.

---

## Tracker format

Update this table as work progresses.

| Phase | Owner | Branch/PR | Started | Completed | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Active | local working tree | 2026-03-06 |  | Phase 1A/1B landed across `services/agent-host` and desktop web: durable ledger, restart interruption marking, additive `recoverableSessions`, sidebar/bootstrap recovery consumption; remaining explicit close-out = manual desktop smoke. Rollback = remove ledger + desktop recovery consumption and delete `~/.pi/agent/graphone/session-ledger.json` |
| 2 | Unassigned |  |  |  | Capabilities + reflection |
| 3 | Unassigned |  |  |  | Frontend service client extraction |
| 4 | Unassigned |  |  |  | Desktop shell adapter |
| 5 | Unassigned |  |  |  | HTTP + WebSocket transport |
| 6 | Unassigned |  |  |  | Browser mode v1 |
| 7 | Unassigned |  |  |  | Declarative UI extensibility |
| 8 | Unassigned |  |  |  | Plugin foundation |

---

## Rules for updating this tracker

When a phase starts or changes materially:

- update the tracker row
- note key files being changed
- note any dependency or sequencing changes
- link to the workstream(s) involved
- record whether the phase is still additive/strangler-safe

If a phase requires a rewrite or breaks current desktop flow, that is a review trigger.

---

## Decision shorthand

When choosing what to do next, prefer work that:

1. strengthens the host service boundary
2. preserves desktop compatibility
3. reduces Tauri coupling in shared UI
4. keeps browser mode easier later
5. formalizes declarative extension points before executable ones

That keeps the implementation aligned with the architecture and with the recovery requirement.
