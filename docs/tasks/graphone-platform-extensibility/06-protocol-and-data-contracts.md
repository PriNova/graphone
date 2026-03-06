# Protocol and Data Contracts

## Goal

Document the runtime-facing contracts needed so multiple implementation workstreams can converge on the same shapes.

This is intentionally compact and practical. It is not a full formal spec.

---

## 1) Canonical runtime contract

The canonical runtime contract already begins in:

- `services/agent-host/src/protocol.ts`

That file should remain the source of truth for the internal host command/response/event model.

### Principle

New transports should adapt to that contract, not quietly invent parallel models.

---

## 2) Existing runtime envelope

Current host model already has:

### Command

- typed command names
- optional request IDs
- optional session IDs

### Response

- `{ type: "response", command, success, data?, error? }`

### Event

- `{ type: "session_event", sessionId, event }`

This is a good base and should be preserved where possible.

---

## 3) Required additions

The following additions are recommended for the next milestone.

## 3.1 Service identity / capabilities

Add a service-level response shape such as:

```ts
interface ServiceCapabilities {
  protocolVersion: string;
  serviceVersion: string;
  runtimeMode: "embedded" | "local-service" | "remote-service";
  transports: {
    stdio: boolean;
    http: boolean;
    websocket: boolean;
  };
  features: {
    streaming: boolean;
    resourceReload: boolean;
    availableCommands: boolean;
    graphoneHtmlToolResults: boolean;
    graphoneDeclarativeViews: boolean;
    graphoneUiPlugins: boolean;
  };
  auth: {
    modes: Array<"none" | "bearer">;
  };
}
```

This is illustrative, not mandatory field-for-field.

---

## 3.2 Available commands reflection

The client should not maintain the authoritative slash-command inventory.

Add a runtime-reflected command shape such as:

```ts
interface AvailableCommandInfo {
  name: string;
  description: string;
  source: "extension" | "prompt" | "skill" | "builtin";
  location?: "user" | "project" | "package" | "runtime";
  path?: string;
}
```

### Notes

- this should reflect what the pi-backed session actually exposes
- built-in Graphone-only UI commands may still remain client-local where appropriate

---

## 3.3 Resource reload request

Add a small reload command/request shape such as:

```ts
interface ReloadResourcesRequest {
  sessionId?: string;
  resources?: Array<"extensions" | "skills" | "prompts" | "themes">;
}

interface ReloadResourcesResult {
  reloaded: Array<"extensions" | "skills" | "prompts" | "themes">;
  diagnostics: Array<{ kind: string; path?: string; message: string }>;
}
```

This does not need to be over-generalized.

---

## 3.4 Resource reflection summaries

A session-scoped or service-scoped reflective shape should exist for loaded runtime resources.

Examples:

```ts
interface RegisteredExtensionSummary {
  name: string;
  path: string;
  resolvedPath: string;
  scope: "global" | "local";
  source: string;
  origin: "package" | "top-level" | "unknown";
  toolCount: number;
  commandCount: number;
}
```

Equivalent summary shapes may later be added for:

- prompts
- skills
- packages
- diagnostics

These are metadata/reporting views only.

---

## 4) Event model guidance

## 4.1 Preserve pi event semantics where possible

The service should continue to forward events in a way that is as close as practical to pi session events.

### Why

- frontend behavior already expects these semantics
- future clients should not have to learn a Graphone-specific event universe unnecessarily

---

## 4.2 Stable outer envelope

Prefer a stable outer event envelope such as:

```ts
interface SessionEventEnvelope {
  type: "session_event";
  sessionId: string;
  event: unknown;
}
```

That is already close to current reality.

---

## 4.3 Optional future metadata

Later, the outer envelope may add fields like:

- `timestamp`
- `eventId`
- `protocolVersion`

Do not add these unless they solve a real problem.

---

## 5) HTTP mapping guidance

HTTP transport should be a straightforward projection of the host contract.

### Good rule

- one runtime concept -> one obvious HTTP route
- reuse runtime payload shapes where possible

### Avoid

- inventing a second domain language just because the transport is HTTP
- forcing Tauri command names into public API routes unchanged if a cleaner route name is obvious

---

## 6) WebSocket mapping guidance

WebSocket should primarily stream the same `SessionEventEnvelope` used internally.

### Good rule

- send one event envelope type consistently
- let the client route by `sessionId` and `event.type`

### Avoid

- separate ad hoc event packet types per event family unless necessary

---

## 7) Connection profile model

The client should support a minimal connection profile shape now, even if only one local profile is used initially.

Example:

```ts
interface ConnectionProfile {
  id: string;
  name: string;
  baseHttpUrl: string;
  baseWsUrl?: string;
  authMode: "none" | "bearer";
}
```

### Why this matters now

It keeps the first implementation compatible with future:

- local service
- LAN service
- cloud service
- supervised multi-environment setups

---

## 8) Graphone declarative UI payload guidance

Graphone-specific declarative UI metadata should remain explicit and optional.

### Existing known convention

- `details._html`

### Recommended evolution path

Keep Graphone-specific metadata namespaced by convention and clearly documented.

For example, a future tool result could contain:

```ts
interface GraphoneToolDetails {
  _html?: string;
  _graphone?: {
    renderer?: string;
    view?: string;
    metadata?: Record<string, unknown>;
  };
}
```

This is illustrative only. The important point is:

- Graphone UI metadata is additive
- other pi surfaces can ignore it safely

---

## 9) Service vs client ownership of state

Use this split consistently.

### Service-owned state

- sessions
- message history
- runtime state
- current model/thinking state
- loaded runtime resources
- available commands/resources

### Client-owned state

- sidebar collapse state
- selected layout state
- presentation settings
- local window state
- local Graphone plugin enablement/config later

This split matters once the service can run remotely.

---

## 10) Naming rules

### Prefer names that survive remote deployment

Good examples:

- `sessions`
- `messages`
- `capabilities`
- `available-commands`
- `reload-resources`

Avoid long-term names that are coupled to internal transport or shell assumptions, such as:

- `tauri_get_messages`
- `desktop_open_window`
- `localhost_prompt`

---

## 11) Minimal contract checklist for the next implementation milestone

The next milestone should converge on at least these runtime-facing contracts:

- [ ] service capabilities/identity
- [ ] session list/create/close
- [ ] prompt/steer/follow-up/abort
- [ ] get messages
- [ ] get state
- [ ] set model
- [ ] set thinking level
- [ ] get available models
- [ ] get registered extensions
- [ ] get available commands
- [ ] reload resources
- [ ] session event streaming envelope
- [ ] connection profile model on client side

---

## 12) Decision rule for coding agents

If you are inventing a new payload shape, check three things first:

1. Can an existing host protocol shape be reused?
2. Can the payload remain transport-neutral?
3. Will the name still make sense if the service runs remotely?

If any answer is “no,” revise before implementing.
