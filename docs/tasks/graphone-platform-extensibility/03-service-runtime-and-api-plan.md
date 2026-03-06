# Service Runtime and API Plan

## Goal

Turn `services/agent-host` into the canonical Graphone runtime service over pi, while keeping the first implementation simple and future-compatible.

This plan is specifically about:

- runtime ownership
- host/service responsibilities
- protocol additions
- browser-friendly transport
- future local/remote/cloud deployment compatibility

This plan is **not** about Graphone UI plugins. That is covered separately.

---

## 1) Current starting point

Graphone already has a strong starting point:

- `services/agent-host/src/host-runtime.ts` creates and manages pi SDK sessions
- `services/agent-host/src/protocol.ts` defines transport-neutral commands/events
- `services/agent-host/src/commands.ts` dispatches protocol commands to the runtime
- host currently runs over stdio as a Graphone sidecar

This is the correct foundation.

The plan is to **evolve this host into a service**, not replace it.

---

## 2) Target state

## 2.1 Canonical runtime model

The canonical Graphone runtime should be:

- one host runtime process
- managing multiple in-process pi sessions
- exposing a stable service API to clients
- reusing pi resource loading and pi session semantics

### Deployment modes

The same runtime model should support:

- embedded desktop-side local mode
- standalone local service mode
- later remote device mode
- later cloud/hosted mode

The runtime model must not require Tauri specifically. Tauri is only one possible desktop host shell for this runtime.

---

## 2.2 Canonical transports

The host runtime should support multiple transports over the same runtime behavior.

### Transport 1 — stdio

Keep this for:

- current Tauri desktop-shell integration
- compatibility during migration
- any future shell/launcher that wants a local child-process transport

### Transport 2 — HTTP + WebSocket

Add this for:

- browser mode
- standalone local service mode
- future remote service mode

### Rule

Transport must adapt the runtime protocol, not redefine the runtime model.

---

## 3) Service responsibilities

The Graphone host service should own:

- session creation/listing/closure
- prompt/steer/follow-up/abort lifecycle
- message retrieval
- state/model/thinking changes
- resource reflection needed by clients
- event streaming to clients
- capabilities metadata
- future connection/auth hooks

It should not own:

- frontend layout logic
- desktop window management
- Graphone client plugin loading

---

## 4) What must remain pi-driven

The service must continue to rely on pi for:

- extension loading
- skill loading
- prompt template discovery/expansion
- pi package loading
- session persistence behavior
- provider/model behavior
- slash command availability derived from runtime resources

### Hard rule

Do not add a Graphone service-side parallel resource loader for pi resources.

The host should expose **metadata and control** around what pi loaded, not re-implement discovery.

---

## 5) Required runtime/API additions

The current host protocol is a good base, but it is missing a few important service-facing features.

## 5.1 Capabilities and health

Add service-level information endpoints/commands for:

- health
- version/build info
- supported transports/features
- supported Graphone UI conventions
- supported auth modes

Why:

- clients need a stable way to negotiate behavior
- browser/desktop/remote compatibility is easier when explicit

---

## 5.2 Available command reflection

The client needs service-reported command visibility for:

- extension commands
- prompt templates
- skills
- other runtime-available slash commands where relevant

This should come from the pi-backed runtime, not from a frontend-maintained list.

### Minimum output

Expose:

- command name
- description
- source (`extension` / `prompt` / `skill` / built-in where appropriate)
- optional location/scope metadata
- optional path for diagnostics/UI display

---

## 5.3 Resource diagnostics and summaries

The client needs a way to display what the service loaded and what failed.

Minimum reflective data the service should expose:

- registered extensions
- extension load errors
- prompt/skill diagnostics where useful
- resource reload success/failure

This is not a second registry. It is service-reported state.

---

## 5.4 Resource reload

The service should support a controlled resource reload operation for:

- extensions
- skills
- prompts
- themes if later relevant

This keeps Graphone closer to pi’s extensible workflow and avoids restart-only development loops.

---

## 5.5 Connection metadata

Add a compact service identity response, for example:

- service ID/version
- runtime mode (`embedded`, `local-service`, future `remote-service`)
- supported protocol version
- capability flags

This helps with browser + remote service evolution later.

---

## 6) Transport-neutral command model

Keep the host command/event model as the canonical runtime contract.

That means:

- do not create one domain model for stdio and another for HTTP/WS
- do not let Tauri command naming become the permanent public service shape

### Preferred pattern

- internal command types remain defined in `services/agent-host/src/protocol.ts`
- transports map requests/responses/events to that canonical model

This minimizes divergence and duplicate behavior.

---

## 7) HTTP + WebSocket plan

## 7.1 HTTP

Use HTTP for request/response service calls.

Keep the first version narrow and mechanical.

Examples of initial routes:

- `GET /health`
- `GET /capabilities`
- `GET /sessions`
- `POST /sessions`
- `DELETE /sessions/:sessionId`
- `GET /sessions/:sessionId/messages`
- `GET /sessions/:sessionId/state`
- `POST /sessions/:sessionId/prompt`
- `POST /sessions/:sessionId/steer`
- `POST /sessions/:sessionId/follow-up`
- `POST /sessions/:sessionId/abort`
- `POST /sessions/:sessionId/model`
- `POST /sessions/:sessionId/thinking-level`
- `GET /models/available`
- `GET /sessions/:sessionId/extensions`
- `GET /sessions/:sessionId/commands`
- `POST /resources/reload`

Do not over-design the REST shape. Keep it obvious.

---

## 7.2 WebSocket

Use WebSocket for event streaming.

Minimum requirements:

- subscribe to runtime session events
- preserve session ID in the event envelope
- preserve current event payload semantics as much as possible
- support reconnect cleanly later

### Important

Do not redesign the event model if the current host envelope already works.

---

## 8) Protocol versioning and compatibility

Introduce lightweight protocol version metadata now.

### Minimum

Expose:

- `protocolVersion`
- `serviceVersion`
- capability flags

This does not need a full compatibility framework yet.

The point is to avoid silent contract drift later.

---

## 9) Auth and remote-readiness hooks

Do not build a full remote auth system in the first pass.

But make sure the service layer supports adding it later.

### Minimum future-safe stance

- HTTP layer can accept auth headers
- WebSocket layer can accept auth token metadata
- client model includes connection profile/auth mode concept

### First implementation

Local service may run with:

- no auth, or
- a simple development token if needed

But the service contract must not assume auth is impossible.

---

## 10) Suggested implementation phases

## Phase S1 — Consolidate host as canonical service runtime

Goal:

- confirm `services/agent-host` is the runtime authority
- keep existing stdio path working
- avoid new parallel runtime surfaces elsewhere

Deliverables:

- clean runtime/service boundary review
- canonical command/event ownership in `protocol.ts`
- no new runtime logic hidden in frontend or Tauri wrappers

---

## Phase S2 — Add missing reflective/runtime commands

Goal:

- expose enough runtime metadata for a service-first client

Additions:

- service health/capabilities
- available commands reflection
- resource reload operation
- any missing diagnostics endpoint/command

Deliverables:

- protocol additions
- runtime implementations in `host-runtime.ts`
- dispatch additions in `commands.ts`

---

## Phase S3 — Add HTTP + WebSocket transport

Goal:

- allow browser and external clients to talk to the same host runtime

Deliverables:

- HTTP server wrapper
- WebSocket event stream wrapper
- transport adapter layer around `handleHostCommand(...)`
- local-service dev entrypoint

---

## Phase S4 — Add service identity and connection profile support

Goal:

- make the service consumable by browser and future remote clients cleanly

Deliverables:

- capabilities/identity output
- protocol version info
- basic connection metadata model

---

## 11) Files likely to change

### Primary

- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/commands.ts`
- new transport files under `services/agent-host/src/`

### Possible supporting files

- `services/agent-host/package.json`
- host CLI/bootstrap files
- desktop integration entrypoints if the embedded mode startup path needs updates

---

## 12) What not to do in the service layer

Do not:

- create a second extension loader beside pi
- make the HTTP API a separate domain model from the host protocol
- make browser support depend on Tauri commands internally
- add window-management logic to the service contract
- add Graphone UI plugin loading to the service

---

## 13) Acceptance criteria

Service/runtime work is complete for the first milestone when:

- [ ] `services/agent-host` remains the single runtime owner for hosted sessions
- [ ] stdio transport still works for desktop integration
- [ ] HTTP request/response transport exists for browser mode
- [ ] WebSocket event streaming exists for browser mode
- [ ] service exposes capabilities/identity metadata
- [ ] service exposes runtime-reflected commands/resources needed by the client
- [ ] no parallel resource loader for pi extensions/skills/prompts exists in Graphone

---

## 14) Validation checklist

### Runtime validation

- [ ] create/list/close session through the service transport
- [ ] prompt/steer/follow-up/abort through the service transport
- [ ] message retrieval matches current runtime behavior
- [ ] model/thinking changes still work
- [ ] extension reflection still works

### Reflection validation

- [ ] available commands come from service/runtime, not hardcoded client lists
- [ ] resource reload is visible to clients
- [ ] capabilities endpoint is present and stable

### Compatibility validation

- [ ] current desktop stdio flow is not broken
- [ ] browser-facing transport works against the same hosted runtime behavior

---

## 15) Hand-off note for coding agents

If your task is on the service side, keep asking:

- “Does this belong in `services/agent-host`?”
- “Am I exposing pi-backed runtime state, or inventing Graphone-owned runtime behavior?”
- “Can this design survive if the service runs on another machine?”

If the answer to the second question is “I am inventing new runtime behavior,” that is a red flag. Re-evaluate before implementing.
