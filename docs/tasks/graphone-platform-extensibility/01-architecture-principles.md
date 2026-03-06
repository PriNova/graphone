# Architecture Principles

## Goal

Define the non-negotiable architectural rules for Graphone as it evolves from a Tauri UI wrapper into:

- a pi-backed service-capable client/workbench,
- a browser-capable frontend,
- and a future-extensible Graphone platform.

These principles are meant to prevent accidental over-engineering and accidental divergence from pi.

---

## 1) Source-of-truth boundaries

## 1.1 pi runtime is canonical for agent behavior

The pi runtime remains the source of truth for:

- session lifecycle
- message/event semantics
- extension loading/execution
- skill loading/execution
- prompt template loading/expansion
- package-driven resource discovery
- provider/model behavior
- auth/model registry behavior
- session persistence semantics

Graphone must **consume** that behavior, not recreate it.

### Consequence

Graphone must not implement a parallel loader/registry for:

- `~/.pi/agent/extensions`
- `.pi/extensions`
- `.pi/skills`
- `.pi/prompts`
- pi packages

For those resources, the loading chain is:

**filesystem/package sources → pi resource loading → Graphone host service → Graphone UI**

---

## 1.2 Graphone host service is canonical for client-facing runtime access

The long-term boundary for clients is the Graphone host service, not Tauri commands.

The preferred runtime core is:

- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/protocol.ts`
- transport adapters around that host runtime

### Consequence

Browser mode, desktop mode, and later remote/cloud mode should converge on the same service-facing runtime model.

---

## 1.3 Graphone client is canonical for UI/workbench behavior

The Graphone client owns:

- layout
- visual rendering
- workbench state
- windowing behavior
- user-facing settings for presentation
- plugin contributions to the UI shell

The client should not own pi runtime semantics.

---

## 2) Extensibility split

Graphone must intentionally support **two extension layers**.

## 2.1 pi extensions = runtime extensibility

Use pi extensibility for:

- tools
- extension commands
- skills
- prompt templates
- providers
- packages
- runtime event hooks
- agent/session behavior

These run where the service/runtime runs.

---

## 2.2 Graphone plugins = UI/workbench extensibility

Use Graphone-native extensibility for:

- custom tool renderers
- custom panels and views
- settings sections
- session inspectors
- commands/actions in the GUI
- workspace visualizations
- Graphone-only workbench contributions

These run where the client runs.

---

## 2.3 Do not merge the two systems

The two extension layers must cooperate, but they must not be collapsed into one ambiguous mechanism.

### Why

They live in different environments and trust boundaries:

- pi runtime extensions can execute with service/runtime privileges
- Graphone UI plugins execute in the client environment

Trying to make one API serve both will create avoidable complexity and security problems.

---

## 3) Trust boundaries

## 3.1 Runtime extensions are service-installed

pi extensions, skills, prompts, and packages are installed and loaded where the service runs.

This remains true when the service runs:

- locally
- on another device
- in the cloud

### Consequence

The Graphone UI must treat service-reported runtime resources as belonging to the connected service environment, not necessarily the local UI machine.

---

## 3.2 UI plugins are client-installed

Graphone UI plugins are installed where the Graphone client runs.

### Hard rule

A connected service must **not** be allowed to auto-inject executable client-side plugins into Graphone by default.

The service may send:

- data
- events
- declarative metadata
- capability information
- renderer hints

It must not silently send arbitrary code for execution in the client.

---

## 3.3 Declarative before executable

Graphone-specific extensibility should start with declarative conventions, for example:

- `details._html`
- structured tool result metadata
- artifact/canvas descriptors
- panel/view hints
- named render targets

This should come before a local executable plugin host.

### Reason

Declarative extensions are:

- easier to support across browser and desktop
- safer across local and remote service modes
- easier to version
- easier to debug

---

## 4) Open/closed principle applied to Graphone

Graphone should be:

- **closed for modification** in its core runtime/client architecture
- **open for extension** through stable, explicit extension points

### This means

Do not normalize customization by patching core files.

Instead, create stable contribution points for:

- renderers
- panels
- commands/actions
- settings sections
- session-aware UI views
- future workbench integrations

---

## 5) Service-first compatibility rules

The first implementation may be local-only in deployment, but not local-only in design.

### All service-facing designs should assume future support for:

- localhost service
- desktop-embedded local service
- remote device service
- cloud service

### Therefore

Do not hardcode assumptions such as:

- service is always `127.0.0.1`
- service has direct local filesystem parity with the client
- service can always open local UI windows
- service and client share install roots or package directories

---

## 6) Tauri’s role

Tauri remains valuable as a desktop shell, but it should not define the long-term app architecture.
It must be treated as a **replaceable shell layer**, not as a permanent dependency of the Graphone runtime/client model.

### Tauri should own only desktop-specific concerns

Examples:

- native windows
- focus/window events
- desktop storage implementation if desired
- OS integrations
- launcher/bundling concerns

### Tauri should not remain the primary contract for core chat/session operations

Those belong behind the service client boundary.

### Replaceability rule

A future Graphone deployment should be able to use:

- Tauri for desktop,
- a browser with no wrapper,
- or a different shell later,

without redefining the runtime/service architecture.

---

## 7) Minimal-change strategy

Graphone should prefer this change order:

1. extend `services/agent-host`
2. adapt the Graphone frontend
3. add transports and plugin contribution points
4. change `../pi-mono` only when a capability clearly belongs in pi core

### Reason

This preserves compatibility and reduces risk.

---

## 8) Ownership matrix

| Concern                             | Owner                                     |
| ----------------------------------- | ----------------------------------------- |
| Session execution                   | pi runtime                                |
| Tool execution semantics            | pi runtime                                |
| Skill discovery/execution           | pi runtime                                |
| Prompt template discovery/expansion | pi runtime                                |
| Package resource discovery          | pi runtime                                |
| Runtime events                      | pi runtime, surfaced by Graphone host     |
| Client-facing session API           | Graphone host service                     |
| Browser/desktop transport           | Graphone host service + clients           |
| Layout/windowing/workbench state    | Graphone client                           |
| Graphone tool rendering             | Graphone client / future Graphone plugins |
| Graphone UI plugin loading          | Graphone client                           |
| Runtime extension loading           | Service/runtime side only                 |

---

## 9) Design constraints for implementation work

Any implementation proposal should be rejected if it violates one of these:

1. adds a second resource loader for pi runtime resources in Graphone
2. makes browser mode depend on the Tauri bridge
3. ties the future service API to localhost-only assumptions
4. allows remote services to execute arbitrary client plugins automatically
5. couples Graphone plugin APIs to pi internals so tightly that versioning becomes impossible
6. turns declarative UI extension needs into a mandatory dynamic plugin system too early

---

## 10) Decision shorthand for implementers

Use these short rules during implementation:

- **If it changes agent behavior, it belongs to pi/runtime/service.**
- **If it changes workbench behavior, it belongs to Graphone client/plugin land.**
- **If the UI only needs to know what pi loaded, expose metadata; do not build a new registry.**
- **If a feature must work locally and remotely, prefer data contracts over executable injection.**
- **If a change can be done in `services/agent-host` instead of pi core, do that first.**

---

## 11) Current architecture implications from local code

These principles are grounded in the current repository state:

- `services/agent-host/src/host-runtime.ts` already uses pi SDK directly via `createAgentSession(...)`
- `services/agent-host/src/protocol.ts` already defines a transport-neutral command/event envelope
- the frontend still imports Tauri APIs directly in shared UI paths
- Graphone already has a Graphone-specific declarative UI example via `details._html`

So the correct direction is **evolution**, not replacement.

---

## 12) Summary

Graphone should evolve into:

- a **pi-backed service-aware platform**,
- with **desktop and browser clients**,
- and a **future Graphone workbench plugin model**,

while preserving pi as the canonical runtime/extensibility engine for agent behavior.
