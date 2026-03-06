# Parallel Workstreams

## Goal

Split the program into parallel-friendly work packages so multiple coding agents can implement it with minimal overlap and minimal architectural drift.

This document is optimized for agent assignment and supervision.

Use [`00-sequenced-implementation-roadmap.md`](./00-sequenced-implementation-roadmap.md) for the recommended execution order and tracker. Use this document for parallel decomposition within that sequence.

---

## 1) Dependency graph

Use this high-level dependency order:

- **WS-A** and **WS-B** can start immediately
- **WS-C** depends on A and partially on B
- **WS-D** can start after A and use provisional B contracts
- **WS-E** can start immediately after D boundaries are agreed
- **WS-F** depends on C + D + E
- **WS-G** can start immediately in parallel with A-D
- **WS-H** should start after G has identified stable contribution points

Simplified graph:

- A -> C
- B -> C
- A -> D
- D -> E
- C + D + E -> F
- G -> H
- A/B/D/G are the best early-parallel lanes

---

## 2) Workstream index

| ID   | Name                                    | Main outcome                                                               |
| ---- | --------------------------------------- | -------------------------------------------------------------------------- |
| WS-A | Host runtime consolidation              | `services/agent-host` is the canonical runtime boundary                    |
| WS-B | Runtime reflection + protocol additions | clients can discover capabilities/resources/commands                       |
| WS-C | HTTP/WebSocket transport                | browser and future remote clients can talk to the host                     |
| WS-D | Frontend service client extraction      | shared UI no longer depends directly on Tauri for core runtime behavior    |
| WS-E | Desktop shell adapter extraction        | desktop-only behavior is isolated cleanly so the shell remains replaceable |
| WS-F | Browser mode enablement                 | Graphone main UI runs in browser against the service                       |
| WS-G | Declarative Graphone UI extensibility   | stable Graphone-specific UI metadata/rendering contracts                   |
| WS-H | Graphone plugin API foundation          | first local client-side contribution points                                |

---

## 3) Workstream details

## WS-A — Host runtime consolidation

### Goal

Make `services/agent-host` the clear canonical Graphone runtime service boundary.

### Read first

- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/commands.ts`
- `../pi-mono/packages/coding-agent/docs/sdk.md`

### Primary files

- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/commands.ts`

### Deliverables

- runtime authority confirmed in code structure
- no hidden parallel runtime behavior added elsewhere
- command/event ownership remains centered in the host

### Validation

- existing stdio mode still works
- session lifecycle still behaves the same
- no frontend/runtime regression from host cleanup/refactor

### Notes

WS-A should avoid transport implementation details except where necessary to prepare for them.

---

## WS-B — Runtime reflection + protocol additions

### Goal

Expose enough service/runtime metadata for browser-capable and extensible clients.

### Read first

- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/host-runtime.ts`
- `../pi-mono/packages/coding-agent/docs/rpc.md`
- `../pi-mono/packages/coding-agent/src/core/resource-loader.ts`

### Primary files

- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/commands.ts`

### Deliverables

- service capabilities/identity contract
- available commands reflection
- resource reload support
- reflective resource diagnostics/summaries as needed

### Validation

- client can ask the service what commands/resources exist
- command/resource outputs come from pi-backed runtime state
- no Graphone-owned parallel extension registry exists

### Notes

WS-B is one of the best early workstreams because it unlocks both frontend and transport work.

---

## WS-C — HTTP/WebSocket transport

### Goal

Expose the host runtime over browser-friendly transports without changing runtime ownership.

### Read first

- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/commands.ts`
- `services/agent-host/README.md`

### Primary files

- new transport files in `services/agent-host/src/`
- host CLI/bootstrap entry files
- maybe `package.json` scripts

### Deliverables

- HTTP request/response server
- WebSocket event streaming server
- transport adapters around the canonical host contract
- local dev entrypoint for service mode

### Validation

- browser-capable client can create/list/prompt sessions
- WebSocket delivers live session events
- stdio transport still works for desktop integration

### Notes

WS-C should not redesign the runtime protocol. It should wrap it.

---

## WS-D — Frontend service client extraction

### Goal

Move shared frontend code off raw Tauri command/event dependencies for core runtime behavior.

### Read first

- `apps/desktop/web/src/lib/stores/agent/api.ts`
- `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- `apps/desktop/web/src/routes/+page.svelte`

### Primary files

- `apps/desktop/web/src/lib/stores/agent/api.ts`
- new `apps/desktop/web/src/lib/service/*`
- shared stores and handlers

### Deliverables

- service client interface + implementations
- shared stores migrated to service client usage
- event bridge migrated to service client event subscription

### Validation

- desktop mode still works through the new client boundary
- shared UI paths stop importing raw Tauri APIs for core runtime operations

### Notes

WS-D should coordinate interface names with WS-B/C but can start with provisional adapters.

---

## WS-E — Desktop shell adapter extraction

### Goal

Separate desktop-only shell behavior from shared workbench logic.

### Read first

- `apps/desktop/web/src/lib/windowing/*`
- `apps/desktop/web/src/routes/+page.svelte`

### Primary files

- new `apps/desktop/web/src/lib/desktop/*`
- `apps/desktop/web/src/lib/windowing/*`
- `apps/desktop/web/src/routes/+page.svelte`

### Deliverables

- desktop adapter interface
- Tauri implementation
- browser-safe implementation/no-op behavior
- shared UI no longer directly responsible for desktop-shell specifics

### Validation

- desktop-specific features still work in desktop mode
- browser mode does not crash on missing desktop capabilities

### Notes

WS-E should avoid service/runtime logic. It is shell-only.

---

## WS-F — Browser mode enablement

### Goal

Make the main Graphone workbench usable in a normal browser against the service.

### Read first

- outputs from WS-C, WS-D, WS-E
- `apps/desktop/web/package.json`
- root `package.json`
- `apps/desktop/web/vite.config.js`

### Primary files

- frontend startup/config files
- browser-mode service selection files
- dev scripts

### Deliverables

- browser-capable startup path
- browser dev scripts
- main chat flow working in browser

### Validation

- no raw Tauri runtime errors in browser
- create/open/list session works
- prompt and streaming work
- core settings persist locally

### Notes

WS-F should remain narrow. Do not chase full desktop parity in v1.

---

## WS-G — Declarative Graphone UI extensibility

### Goal

Formalize Graphone-specific declarative UI conventions and renderer routing.

### Read first

- `services/agent-host/runtime-overrides/examples/extensions/tool-result-html.ts`
- `apps/desktop/web/src/lib/components/Messages/AssistantMessage.svelte`
- any current tool-rendering utilities

### Primary files

- message/tool rendering code in frontend
- Graphone UI contract helpers/docs/examples

### Deliverables

- documented Graphone declarative UI contract family
- renderer registry foundation or equivalent routing point
- stable handling of Graphone-specific metadata like `_html`

### Validation

- Graphone renders declared UI metadata consistently
- other surfaces can ignore the metadata safely
- no executable plugin host required yet

### Notes

WS-G can begin in parallel with service/browser work because it mostly affects client rendering contracts.

---

## WS-H — Graphone plugin API foundation

### Goal

Create the first local client-side Graphone plugin contribution points.

### Read first

- `05-graphone-plugin-api-plan.md`
- outputs from WS-G
- current rendering/layout code in frontend

### Primary files

- new `apps/desktop/web/src/lib/plugins/*`
- contribution registries
- plugin activation bootstrapping

### Deliverables

- plugin manifest/API version skeleton
- first contribution point(s), preferably bounded ones
- activation failure isolation and diagnostics

### Validation

- at least one client-installed plugin contribution works
- plugin API remains local-client-scoped
- remote services cannot auto-inject executable client plugins

### Notes

WS-H should not start by building a huge plugin system. Start with one or two contribution types only.

---

## 4) Merge-conflict avoidance guidance

To keep work parallel-safe, prefer these file boundaries:

### WS-A / WS-B / WS-C

Own mostly:

- `services/agent-host/src/*`

### WS-D / WS-E / WS-F

Own mostly:

- `apps/desktop/web/src/lib/service/*`
- `apps/desktop/web/src/lib/desktop/*`
- selected store/handler files

### WS-G / WS-H

Own mostly:

- `apps/desktop/web/src/lib/components/Messages/*`
- new `apps/desktop/web/src/lib/plugins/*`
- renderer/contribution registry files

### High-conflict files to coordinate carefully

- `apps/desktop/web/src/routes/+page.svelte`
- `apps/desktop/web/src/lib/stores/agent.svelte.ts`
- `apps/desktop/web/src/lib/handlers/commands.ts`

If multiple workstreams must touch one of those, coordinate through small preparatory refactors first.

---

## 5) Handoff template for each coding agent

Each coding agent should report back in this format:

### Task summary

- workstream ID
- files changed
- contracts introduced/modified

### What was implemented

- concise list of completed sub-tasks

### Validation performed

- commands run
- manual checks performed

### Known gaps

- follow-up items
- blocked pieces waiting on another workstream

### Risks introduced

- any compatibility or merge risks

This makes developer supervision much easier.

---

## 6) Recommended assignment order

For maximum parallelism, assign in this order:

1. WS-A
2. WS-B
3. WS-D
4. WS-G
5. WS-C
6. WS-E
7. WS-F
8. WS-H

This assignment order should be applied within the higher-level program sequence defined in [`00-sequenced-implementation-roadmap.md`](./00-sequenced-implementation-roadmap.md). In particular, the current recommended first implementation slice is the host recovery ledger in Phase 1.

### Why

- WS-A/B define the runtime boundary
- WS-D starts the UI dependency split
- WS-G can progress independently on rendering/extensibility contracts
- WS-C/F depend more on the service boundary being stable
- WS-H should build on stable Graphone contribution points, not guess them early

---

## 7) Program-level acceptance criteria

The overall program reaches a strong first milestone when all of the following are true:

- [ ] `services/agent-host` is the clear runtime boundary over pi
- [ ] browser-capable transport exists
- [ ] frontend shared code talks to a service client for core runtime behavior
- [ ] desktop shell behavior is isolated
- [ ] browser mode works for main chat flow
- [ ] Graphone declarative UI extensibility is formalized
- [ ] first Graphone plugin contribution point design is ready or implemented locally
- [ ] no duplicate pi resource loader/registry has been added to Graphone

---

## 8) Final note to supervising developers

If parallel work starts to drift, use these questions to re-align teams:

1. Is this a **pi/runtime/service** concern or a **Graphone client/plugin** concern?
2. Is anyone accidentally building a **second registry/loader** for pi resources?
3. Is anyone making **Tauri the primary architecture again**?
4. Is anyone allowing **remote-service-delivered executable UI code**?

If the answer to any is yes, correct course immediately.
