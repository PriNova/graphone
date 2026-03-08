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

**Program reset note (2026-03-07):**

- The earlier durable recovery-ledger implementation slice was reverted.
- This roadmap is reset to a fresh baseline.
- The new recommended start point is service/runtime boundary hardening (capabilities + reflection), not host recovery ledger work.

**Current recommended starting point:** Phase 1 — service capabilities + runtime reflection.

Reason:

- it strengthens the canonical runtime boundary in `services/agent-host`
- it unlocks frontend service-client extraction with explicit contracts
- it reduces implicit behavior and guesswork in clients
- it sets up browser transport work without coupling to desktop-only assumptions

---

## Operating rules for this roadmap

1. **Use strangler-fig sequencing.** Prefer additive seams and adapters over rewrites.
2. **Keep Graphone working at every meaningful stage.** Desktop flow should remain usable while new boundaries are introduced.
3. **Keep runtime ownership in `services/agent-host`, not in frontend/Tauri glue.**
4. **Reuse pi persistence/resource semantics.** Do not build a parallel message/session/resource loader in Graphone.
5. **Treat recovery as a later hardening concern for now.** Do not block service/client extraction on a new durability design.
6. **Do browser mode only after service and client boundaries exist.**
7. **Do Graphone executable plugins only after declarative UI contracts are stable.**
8. **Keep protocol and transport changes explicitly versioned/capability-gated.**

---

## Roadmap at a glance

| Phase | Name | Primary workstreams | Goal | Status |
| --- | --- | --- | --- | --- |
| 0 | Baseline reset | WS-A, WS-D (cleanup) | Remove reverted ledger assumptions and reset docs/tracker | Completed |
| 1 | Service capabilities + runtime reflection | WS-A, WS-B | Make runtime/service metadata explicit to clients | Planned |
| 2 | Frontend service client extraction | WS-D | Move core runtime access behind a service client boundary | Planned |
| 3 | Desktop shell adapter extraction | WS-E | Isolate Tauri/native shell behavior from shared UI | Planned |
| 4 | HTTP + WebSocket service transport | WS-C | Expose the same host runtime to browser-capable clients | Planned |
| 5 | Browser mode v1 | WS-F | Run the main workbench in a browser against the service | Planned |
| 6 | Declarative Graphone UI extensibility | WS-G | Formalize Graphone UI metadata/rendering contracts | Planned |
| 7 | Graphone plugin foundation | WS-H | Add a small local workbench plugin API | Planned |
| 8 | Host recovery strategy revisit (hardening) | WS-A, WS-B, WS-D | Reintroduce crash/restart continuity using a validated design | Backlog |

---

## Relationship to other planning docs

- `01-architecture-principles.md` defines the non-negotiable rules.
- `03-service-runtime-and-api-plan.md` defines the target service/runtime shape.
- `04-client-shell-and-browser-plan.md` defines the frontend extraction shape.
- `05-graphone-plugin-api-plan.md` defines the Graphone plugin direction.
- `07-parallel-workstreams.md` defines how work can be split across agents.
- **This file defines the recommended implementation order and serves as the tracker.**

---

## Phase 0 — Baseline reset

## Goal

Reset the roadmap and execution tracker after reverting the ledger experiment.

## Completed outcomes

- remove assumptions that a host recovery ledger is active
- reset “current status” language to reflect fresh-start planning
- keep sequencing focused on service/client/browser architecture first

## Exit criteria

- [x] No roadmap step assumes `session-ledger.ts` exists
- [x] Tracker reflects fresh-start status
- [x] Next implementation recommendation is unambiguous

---

## Phase 1 — Service capabilities + runtime reflection

## Goal

Make the host self-describing enough that clients do not have to guess what runtime features or resources are available.

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

## Phase 2 — Frontend service client extraction

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

## Phase 3 — Desktop shell adapter extraction

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

## Phase 4 — HTTP + WebSocket service transport

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

## Phase 5 — Browser mode v1

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

## Phase 6 — Declarative Graphone UI extensibility

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

## Phase 7 — Graphone plugin foundation

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

## Phase 8 — Host recovery strategy revisit (hardening)

## Goal

Reintroduce session/run continuity after crash/restart using a validated design that does not destabilize core architecture work.

## Scope

Evaluate and implement one pragmatic strategy after Phases 1-4 are stable, for example:

- minimal host-owned checkpoint index tied to `sessionFile`
- runtime-derived session continuity from existing persisted state
- coarse run interruption markers without full durable queue complexity

## Acceptance criteria

- [ ] Chosen approach is documented with explicit failure semantics
- [ ] Recovery does not require duplicating pi message/session persistence
- [ ] Recovery data model is simple enough to keep rollback cheap
- [ ] Desktop and browser clients consume recovery metadata through the same service contract

---

## Phase dependencies

Use this simplified dependency view:

- Phase 1 -> Phase 2
- Phase 2 -> Phase 3
- Phase 1 + Phase 2 -> Phase 4
- Phase 3 + Phase 4 -> Phase 5
- Phase 6 -> Phase 7
- Phase 1 + Phase 2 + Phase 4 -> Phase 8

Phase 6 can start in parallel with Phases 1-4 if the team stays within declarative rendering contracts.

---

## Tracker format

Update this table as work progresses.

| Phase | Owner | Branch/PR | Started | Completed | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | Completed | docs refresh | 2026-03-07 | 2026-03-07 | Planning reset after ledger revert |
| 1 | Unassigned |  |  |  | Capabilities + reflection baseline |
| 2 | Unassigned |  |  |  | Frontend service client extraction |
| 3 | Unassigned |  |  |  | Desktop shell adapter |
| 4 | Unassigned |  |  |  | HTTP + WebSocket transport |
| 5 | Unassigned |  |  |  | Browser mode v1 |
| 6 | Unassigned |  |  |  | Declarative UI extensibility |
| 7 | Unassigned |  |  |  | Plugin foundation |
| 8 | Backlog |  |  |  | Recovery hardening revisit (post-boundary stabilization) |

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
6. delays risky recovery redesign until core service/client seams are stable
