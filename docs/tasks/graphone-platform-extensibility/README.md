# Graphone Platform Extensibility — Agent-First Hand-off Index

## Purpose

This folder contains the hand-off material for turning Graphone into:

1. a **service-capable client/workbench** for the pi runtime,
2. a **browser- and desktop-capable frontend** over the same service boundary, and
3. an **extensible Graphone workbench** with its own future plugin API.

This documentation is written for **coding agents first** and **supervising developers second**.

The goal is that multiple coding agents can work in parallel with minimal prior knowledge of either repo:

- `graphone/`
- `../pi-mono/`

---

## Read this first

### Mandatory reading order

0. [`00-sequenced-implementation-roadmap.md`](./00-sequenced-implementation-roadmap.md)
1. [`01-architecture-principles.md`](./01-architecture-principles.md)
2. [`02-codebase-orientation.md`](./02-codebase-orientation.md)
3. [`03-service-runtime-and-api-plan.md`](./03-service-runtime-and-api-plan.md)
4. [`04-client-shell-and-browser-plan.md`](./04-client-shell-and-browser-plan.md)
5. [`05-graphone-plugin-api-plan.md`](./05-graphone-plugin-api-plan.md)
6. [`06-protocol-and-data-contracts.md`](./06-protocol-and-data-contracts.md)
7. [`07-parallel-workstreams.md`](./07-parallel-workstreams.md)
8. [`08-agent-execution-playbook.md`](./08-agent-execution-playbook.md)

Do not start implementation from this index alone.

Use `00-sequenced-implementation-roadmap.md` as the single execution-order tracker for this program.

Current execution note:

- The earlier durable host recovery ledger slice was reverted.
- Treat this plan set as reset to a fresh baseline with **no Graphone-owned recovery ledger currently active**.
- Recommended restart point is the service/runtime boundary work (capabilities + reflection), then client extraction and browser transport.

---

## Core architectural decisions

These documents assume the following decisions are already made:

- **pi remains the canonical runtime/extensibility engine** for agent behavior.
- **Graphone must not create a parallel loader/registry** for pi extensions, skills, prompts, or packages.
- **`services/agent-host` becomes the canonical Graphone service runtime** over the pi SDK.
- **Tauri becomes a desktop shell/client**, not the long-term architectural boundary.
- **The desktop shell must remain replaceable later**; Graphone should be able to run with a different shell or no shell at all for browser-first deployment.
- **Browser mode and desktop mode must use the same service-facing client model**.
- **Graphone eventually gets its own UI/workbench plugin API**, separate from pi runtime extensions.
- **Graphone plugin extensibility must start with declarative conventions first**, then optional local executable plugins later.
- **Remote/cloud support must be possible later without undoing the first implementation**.

---

## Desired end-state

### Runtime side

- Graphone host service wraps pi SDK sessions via `createAgentSession(...)`
- same service can run:
  - inside desktop app support flow
  - as a local service
  - later on remote devices or cloud
- pi resources continue to load the normal pi way:
  - `~/.pi/agent/extensions`
  - `.pi/extensions`
  - `.pi/skills`
  - `.pi/prompts`
  - pi packages

### Client side

- frontend talks to a **service client**, not directly to Tauri for core session behavior
- desktop-only behavior is isolated behind a **desktop shell adapter**
- browser mode works against the same service contract
- Tauri remains a **desktop delivery shell only** and can later be replaced without changing the core runtime/service model

### Graphone extensibility

- Graphone supports **declarative UI extensions** first
- Graphone later supports **local client-installed workbench plugins**
- runtime extensions and UI plugins remain distinct by trust boundary

---

## Deliverables in this hand-off set

### 1. Architecture

- ownership boundaries
- trust boundaries
- extension model split
- long-term compatible direction

### 2. Implementation plans

- sequenced implementation roadmap / tracker
- service/runtime plan
- client/browser plan
- plugin API plan

### 3. Contracts

- protocol additions
- event/data shapes
- connection profile model
- resource metadata expectations

### 4. Parallelization guidance

- workstreams
- dependencies
- likely touched files
- validation steps
- conflict-avoidance guidance

---

## Recommended implementation milestones

### Milestone A — Stabilize Graphone around a real service boundary

Goal:

- treat `services/agent-host` as the canonical runtime service
- keep stdio transport for Tauri
- add browser-friendly transport without changing the underlying runtime model

Key outputs:

- service capabilities endpoint
- service command/event transport split
- frontend service client abstraction

### Milestone B — Browser-capable Graphone client

Goal:

- frontend works in browser without direct Tauri dependence for core chat/session behavior
- desktop behavior remains intact

Key outputs:

- browser-safe service client
- desktop adapter split
- browser-mode dev workflow

### Milestone C — Graphone declarative UI extensibility

Goal:

- formalize Graphone-specific UI metadata conventions
- make them stable and service-safe

Key outputs:

- documented structured UI payloads
- tool renderer registration foundation
- capability flags

### Milestone D — Graphone workbench plugin foundation

Goal:

- introduce a small local plugin API for Graphone UI/workbench features
- keep trust boundaries clean

Key outputs:

- local plugin host model
- plugin contribution points
- versioned Graphone plugin API v1 draft

---

## Workstream summary

The project is intentionally split into parallel-friendly workstreams. See [`07-parallel-workstreams.md`](./07-parallel-workstreams.md) for the full breakdown.

High-level split:

- **WS-A**: service runtime consolidation around `services/agent-host`
- **WS-B**: host protocol + resource reflection additions
- **WS-C**: HTTP/WebSocket transport for service mode
- **WS-D**: frontend service client extraction
- **WS-E**: desktop shell adapter extraction
- **WS-F**: browser mode enablement
- **WS-G**: Graphone declarative UI extensibility contracts
- **WS-H**: Graphone plugin API foundation

---

## Rules for coding agents

1. **Do not re-implement pi loading/discovery logic in Graphone.**
2. **Do not make Tauri APIs the main runtime abstraction.**
3. **Do not invent a second source of truth for extensions/skills/prompts.**
4. **Do not let a remote service inject executable UI plugins into a client by default.**
5. **Prefer additive changes in `services/agent-host` over invasive changes in `../pi-mono`.**
6. **Only change pi core if the capability clearly belongs in pi itself.**
7. **Keep browser mode v1 single-window and narrow.**
8. **Prefer stable contribution points over ad hoc UI hooks.**

---

## Useful local source references

### Graphone

- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/commands.ts`
- `apps/desktop/web/src/lib/stores/agent/api.ts`
- `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- `apps/desktop/web/src/routes/+page.svelte`

### pi-mono

- `../pi-mono/packages/coding-agent/docs/sdk.md`
- `../pi-mono/packages/coding-agent/docs/rpc.md`
- `../pi-mono/packages/coding-agent/docs/extensions.md`
- `../pi-mono/packages/coding-agent/docs/skills.md`
- `../pi-mono/packages/coding-agent/docs/prompt-templates.md`
- `../pi-mono/packages/coding-agent/docs/packages.md`
- `../pi-mono/packages/coding-agent/src/core/resource-loader.ts`
- `../pi-mono/packages/coding-agent/src/core/extensions/types.ts`

---

## Expected developer supervision model

Developers should mainly:

- approve architecture direction
- assign workstreams to coding agents
- review API boundary changes
- verify trust/security choices
- validate milestone acceptance criteria

Developers should **not** need to micromanage file discovery or implementation sequencing if agents follow these documents.

---

## Definition of success for this doc set

This hand-off is successful if separate coding agents can independently implement:

- the service/runtime pieces,
- the frontend/browser pieces, and
- the Graphone plugin foundation,

while converging on the same architecture without inventing conflicting local designs.
