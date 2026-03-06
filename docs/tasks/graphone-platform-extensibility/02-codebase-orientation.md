# Codebase Orientation

## Goal

Give a new coding agent enough local orientation to start work without guessing where the real architecture lives.

This document is intentionally practical and repo-specific.

---

## 1) Repositories involved

There are two local repositories that matter for this work:

### A. Graphone

Current working repo:

- `graphone/`

Primary responsibilities:

- desktop/frontend client (`apps/desktop/web`)
- replaceable Tauri desktop shell (`src-tauri`)
- Graphone host sidecar/service (`services/agent-host`)

### B. pi-mono

Sibling local repo:

- `../pi-mono/`

Primary responsibilities:

- pi runtime SDK
- resource loading
- extension API
- skills/prompts/packages behavior
- session and RPC semantics

---

## 2) What to read first in Graphone

## 2.1 Service/runtime side

### `services/agent-host/src/host-runtime.ts`

Why it matters:

- this is already the closest thing Graphone has to a real runtime service
- it uses the pi SDK directly
- it owns hosted session lifecycle
- it exposes session/model/OAuth/resource reflection behavior

What to notice:

- imports `createAgentSession`, `SessionManager`, `AuthStorage`, `ModelRegistry`
- `createSession(...)` creates pi-backed sessions
- `session.subscribe(...)` forwards runtime events into Graphone envelopes
- `getRegisteredExtensions(...)` already exposes resource metadata from pi

### `services/agent-host/src/protocol.ts`

Why it matters:

- current canonical host command/response/event envelope lives here
- future transports should build on this, not bypass it casually

### `services/agent-host/src/commands.ts`

Why it matters:

- maps protocol commands to `HostRuntime`
- good place to understand current command surface and validation behavior

### `services/agent-host/README.md`

Why it matters:

- documents the current sidecar protocol as newline-delimited JSON over stdio
- confirms current host is a local multiplexer for multiple `AgentSession`s

---

## 2.2 Frontend client side

### `apps/desktop/web/src/routes/+page.svelte`

Why it matters:

- this is the main orchestration surface for the current UI
- it currently imports Tauri APIs directly
- it coordinates sessions, runtime bootstrapping, window context, and event setup

### `apps/desktop/web/src/lib/stores/agent/api.ts`

Why it matters:

- current RPC helper for Tauri `invoke(...)`
- a key place that will need service-client extraction

### `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`

Why it matters:

- current event transport is Tauri event-based
- browser mode and future service mode need an equivalent event subscription path

### `apps/desktop/web/src/lib/stores/*.ts`

Focus first on these:

- `cwd.svelte.ts`
- `sessions.svelte.ts`
- `projectScopes.svelte.ts`
- `enabledModels.svelte.ts`
- `agent.svelte.ts`

Why they matter:

- many of these call `invoke(...)` directly
- these are the main service-facing state holders in the UI

### `apps/desktop/web/src/lib/windowing/*`

Why it matters:

- window behavior must remain desktop-specific and be isolated from core service access

---

## 2.3 Tauri side

### `src-tauri/src/*`

Why it matters:

- current desktop runtime bridge is implemented here
- useful for preserving desktop behavior while the frontend is extracted toward a service client model

But note:

- Tauri is not the desired long-term architecture boundary for core chat/session behavior
- Tauri should be treated as a replaceable desktop shell, not as required infrastructure for all future clients

---

## 3) What to read first in pi-mono

## 3.1 SDK and session model

### `../pi-mono/packages/coding-agent/docs/sdk.md`

Read this to understand:

- `createAgentSession(...)`
- `AgentSession`
- prompt/steer/followUp behavior
- event streaming
- resource loader usage

### `../pi-mono/packages/coding-agent/docs/rpc.md`

Read this to understand:

- existing pi RPC model
- available commands semantics
- extension command/skill/prompt behavior in RPC contexts

### `../pi-mono/packages/coding-agent/docs/session.md`

Read this to understand:

- session persistence semantics
- message structures
- session tree and metadata basics

---

## 3.2 Extensibility and resources

### `../pi-mono/packages/coding-agent/docs/extensions.md`

Read this to understand:

- what extensions can do
- extension lifecycle and API surface

### `../pi-mono/packages/coding-agent/docs/skills.md`

Read this to understand:

- how skills are discovered and included
- project/global/package loading rules

### `../pi-mono/packages/coding-agent/docs/prompt-templates.md`

Read this to understand:

- prompt template discovery and expansion

### `../pi-mono/packages/coding-agent/docs/packages.md`

Read this to understand:

- package-based resource distribution
- how pi packages bundle extensions, skills, prompts, themes

---

## 3.3 Local source files in pi-mono that matter most

### `../pi-mono/packages/coding-agent/src/core/resource-loader.ts`

Why it matters:

- this is the real discovery/loading model Graphone must respect
- read this before inventing any Graphone-side resource handling

### `../pi-mono/packages/coding-agent/src/core/extensions/types.ts`

Why it matters:

- contains `ExtensionAPI`
- defines the extension-facing contract Graphone relies on indirectly

### `../pi-mono/packages/coding-agent/src/core/agent-session.ts`

Why it matters:

- underlying session behavior
- prompt/command/template handling
- event flow and slash command availability logic

---

## 4) Current-state summary from local code

These facts are already true in the codebase:

### Graphone host is already pi-backed

`services/agent-host/src/host-runtime.ts` already:

- creates sessions with `createAgentSession(...)`
- uses pi `SessionManager`
- shares `AuthStorage` and `ModelRegistry`
- forwards session events
- reflects registered extensions

This is the strongest architectural anchor in the codebase.

### Frontend is still Tauri-coupled

The frontend currently imports Tauri APIs directly for:

- commands via `@tauri-apps/api/core`
- events via `@tauri-apps/api/event`
- windowing via `@tauri-apps/api/window` and `webviewWindow`
- persistence via `@tauri-apps/plugin-store`

This is the main implementation constraint for browser/service mode.

### Graphone already has one Graphone-specific UI extension convention

There is already a Graphone-specific pattern for rich UI rendering:

- `details._html`
- example in `services/agent-host/runtime-overrides/examples/extensions/tool-result-html.ts`

This should be treated as the start of Graphone declarative UI extensibility.

---

## 5) Suggested search commands for coding agents

Use these local searches before changing architecture.

### Find direct Tauri dependencies in shared frontend code

- search for `@tauri-apps/api/core`
- search for `@tauri-apps/api/event`
- search for `@tauri-apps/api/window`
- search for `@tauri-apps/plugin-store`
- search for `invoke(`
- search for `listen(`

### Find current host/runtime command surface

- search `HostCommandType`
- search `handleHostCommand`
- search `requireSession(` in `host-runtime.ts`

### Find existing Graphone-specific UI conventions

- search `_html`
- search `renderTool`
- search `tool result`
- search `runtime-overrides`

### Find pi resource loading behavior

In `../pi-mono`, search for:

- `DefaultResourceLoader`
- `loadExtensions`
- `loadSkills`
- `getPrompts`
- `getAvailableCommands`
- `registerTool`
- `registerCommand`

---

## 6) Working mental model

If you are new to both repos, use this model:

### pi-mono

- runtime engine
- extension and resource engine
- session behavior engine

### Graphone host (`services/agent-host`)

- Graphone-owned wrapper around pi sessions
- multi-session runtime host
- future canonical service boundary

### Graphone frontend

- workbench/client shell
- current Tauri-based UI
- future browser + desktop client over service boundary

---

## 7) File ownership guidance by work type

### Service/runtime work

Likely primary files:

- `services/agent-host/src/host-runtime.ts`
- `services/agent-host/src/protocol.ts`
- `services/agent-host/src/commands.ts`
- new transport files under `services/agent-host/src/`

### Frontend service-client work

Likely primary files:

- `apps/desktop/web/src/lib/stores/agent/api.ts`
- new `apps/desktop/web/src/lib/service/*`
- `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- `apps/desktop/web/src/lib/stores/*`

### Desktop-shell-only work

Likely primary files:

- `apps/desktop/web/src/lib/windowing/*`
- Tauri-specific integration helpers
- desktop-only adapter files to be introduced

### Graphone plugin/workbench extensibility work

Likely primary files:

- `apps/desktop/web/src/lib/components/Messages/*`
- new `apps/desktop/web/src/lib/plugins/*`
- new renderer/contribution registries
- Graphone declarative rendering contracts/docs/examples

---

## 8) Anti-patterns to avoid while orienting

Do not assume:

- frontend browser support can be solved by mocking `window.__TAURI__`
- Tauri command names should become the public long-term service contract
- Graphone should rescan `.pi` resources on the client
- Graphone plugin API should be designed by copying pi extension API directly

---

## 9) Fast-start checklist for a new coding agent

Before writing code:

- [ ] read `services/agent-host/src/host-runtime.ts`
- [ ] read `services/agent-host/src/protocol.ts`
- [ ] read `apps/desktop/web/src/routes/+page.svelte`
- [ ] read `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- [ ] read `../pi-mono/packages/coding-agent/docs/sdk.md`
- [ ] read `../pi-mono/packages/coding-agent/src/core/resource-loader.ts`
- [ ] identify whether your task belongs to runtime/service, client shell, or Graphone plugin/workbench scope

If you cannot classify your task into one of those three areas, pause and ask for clarification before implementing.
