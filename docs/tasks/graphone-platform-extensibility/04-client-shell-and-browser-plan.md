# Client Shell and Browser Plan

## Goal

Refactor the Graphone frontend so that:

- core session/chat behavior talks to a **service client**,
- desktop-only behavior is isolated behind a **desktop shell adapter**,
- the same frontend can run in both Tauri and a normal browser,
- Tauri remains only a **replaceable desktop shell**,
- browser mode stays intentionally small and safe for v1.

This document is about the frontend/client side only.

---

## 1) Current problem

The frontend currently mixes together three concerns:

1. service/runtime access
2. desktop shell behavior
3. workbench UI rendering

This is visible in files like:

- `apps/desktop/web/src/routes/+page.svelte`
- `apps/desktop/web/src/lib/stores/agent/api.ts`
- `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- multiple stores importing `@tauri-apps/api/core`
- windowing helpers importing `@tauri-apps/api/window`

This prevents browser mode and makes service evolution harder.

---

## 2) Target split

The frontend should be split into three layers.

## 2.1 Service client layer

This owns:

- calling the Graphone service
- subscribing to runtime events
- connection/profile handling
- translating transport details away from the UI

This layer must work in:

- Tauri desktop mode
- browser mode
- future non-Tauri shells without redefining the service client contract

---

## 2.2 Desktop shell adapter

This owns:

- current window context
- floating windows
- native focus/window hooks
- desktop-only integrations
- desktop-specific storage if still desired

This layer is allowed to be Tauri-specific, because it represents the shell boundary rather than the core app/runtime boundary.

In browser mode it should degrade to:

- one main window
- no-op or unsupported results for desktop-only features

---

## 2.3 Workbench/UI layer

This owns:

- stores
- components
- layout
- renderers
- future Graphone plugin contribution points

The workbench should depend on:

- service client interfaces
- desktop adapter interfaces

It should not import raw Tauri APIs in shared paths.

---

## 3) Recommended module shape

Do not keep one generic catch-all platform module forever.

Instead, separate the two real boundaries.

### Service layer

Suggested new files:

- `apps/desktop/web/src/lib/service/types.ts`
- `apps/desktop/web/src/lib/service/client.ts`
- `apps/desktop/web/src/lib/service/tauri-client.ts`
- `apps/desktop/web/src/lib/service/http-client.ts`
- `apps/desktop/web/src/lib/service/events.ts`
- `apps/desktop/web/src/lib/service/index.ts`

### Desktop layer

Suggested new files:

- `apps/desktop/web/src/lib/desktop/types.ts`
- `apps/desktop/web/src/lib/desktop/tauri.ts`
- `apps/desktop/web/src/lib/desktop/browser.ts`
- `apps/desktop/web/src/lib/desktop/index.ts`

This is clearer than one broad `platform.*` abstraction.

---

## 4) Service client responsibilities

The service client should expose only the core operations the UI needs.

Examples:

- `createSession(...)`
- `listSessions()`
- `closeSession(...)`
- `getMessages(...)`
- `getState(...)`
- `prompt(...)`
- `steer(...)`
- `followUp(...)`
- `abort(...)`
- `setModel(...)`
- `setThinkingLevel(...)`
- `getAvailableModels()`
- `getRegisteredExtensions(...)`
- `getAvailableCommands(...)`
- `reloadResources(...)`
- `subscribeToSessionEvents(...)`
- `getCapabilities()`

### Important

Prefer domain-specific methods over a forever-generic `invoke(command, payload)` API in the UI layer.

Internally, the client may still use a generic transport helper.

---

## 5) Desktop adapter responsibilities

The desktop adapter should cover only desktop/workbench shell needs.

Examples:

- `getCurrentWindowContext()`
- `openFloatingSessionWindow(...)`
- `openFloatingCanvasWindow(...)` later if needed
- `onFocusChanged(...)`
- `isDesktop()`

### Browser-mode behavior

For browser mode, the adapter should provide safe defaults:

- window role = `main`
- no floating session windows in v1
- no focus hook requirement
- no crashes if desktop-only features are requested

---

## 6) Browser mode scope for v1

Keep browser mode deliberately narrow.

### Browser mode must support

- main chat/workbench page
- creating/opening/listing sessions
- prompt submission
- streamed agent output
- message history loading
- model selection and core settings used by the main UI

### Browser mode does not need in v1

- floating session windows
- full native multi-window parity
- all current desktop-only affordances
- arbitrary Graphone plugin execution

This narrow scope is intentional.

---

## 7) Settings handling

The current UI uses Tauri plugin store in shared code.

For the first browser-compatible split:

- desktop mode may keep plugin-store-backed settings if desired
- browser mode should use `localStorage` for UI settings

### Keep local in the client

These remain client-owned UI settings:

- collapsed scopes
- last selected scope
- model filter display preference
- tool-results collapsed default
- thinking collapsed default

### Do not move these into the runtime service by default

They are presentation concerns, not runtime/session truth.

---

## 8) Frontend migration strategy

## Phase C1 — Inventory Tauri dependencies in shared code

Search for:

- `@tauri-apps/api/core`
- `@tauri-apps/api/event`
- `@tauri-apps/api/window`
- `@tauri-apps/api/webviewWindow`
- `@tauri-apps/plugin-store`
- `invoke(`
- `listen(`

Classify each usage as:

- service-facing
- desktop-shell-only
- purely local UI concern

This classification prevents a messy refactor.

---

## Phase C2 — Introduce the service client skeleton

Add the service client modules and make them usable from shared stores.

### Initial implementations

- Tauri-backed service client implementation for current desktop mode
- HTTP/WebSocket-backed service client implementation for browser mode

The UI should not care which one is active.

---

## Phase C3 — Introduce the desktop adapter skeleton

Add desktop adapter modules and move current window/focus logic there.

Start by extracting:

- current window context logic
- floating session window logic
- focus change subscriptions

---

## Phase C4 — Migrate shared stores and handlers off raw Tauri imports

Prioritize files that block browser boot first.

High-priority files:

- `apps/desktop/web/src/lib/stores/agent/api.ts`
- `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- `apps/desktop/web/src/lib/stores/settings.svelte.ts`
- `apps/desktop/web/src/lib/stores/cwd.svelte.ts`
- `apps/desktop/web/src/lib/stores/sessions.svelte.ts`
- `apps/desktop/web/src/lib/stores/projectScopes.svelte.ts`
- `apps/desktop/web/src/lib/stores/enabledModels.svelte.ts`
- `apps/desktop/web/src/routes/+page.svelte`

### Rule

When moving code, avoid rewriting unrelated business logic.

Change the dependency boundary first; preserve behavior where possible.

---

## Phase C5 — Browser-mode startup and dev flow

Add browser-mode dev scripts and ensure a new developer can run:

1. service runtime
2. browser frontend
3. end-to-end chat flow

Recommended root scripts:

- `npm run dev:browser:backend`
- `npm run dev:browser`

Keep current desktop scripts intact.

---

## 9) Service client runtime detection

Keep runtime selection in one place.

Suggested behavior:

- if explicit browser-service config exists, use HTTP/WebSocket client
- else if running inside Tauri embedded mode, use Tauri-backed client
- do not scatter environment detection throughout stores/components

This should live in a single entry module.

---

## 10) Files likely to change

### High confidence

- `apps/desktop/web/src/routes/+page.svelte`
- `apps/desktop/web/src/lib/handlers/agent-event-bridge.ts`
- `apps/desktop/web/src/lib/stores/agent/api.ts`
- `apps/desktop/web/src/lib/stores/settings.svelte.ts`
- `apps/desktop/web/src/lib/stores/cwd.svelte.ts`
- `apps/desktop/web/src/lib/stores/sessions.svelte.ts`
- `apps/desktop/web/src/lib/stores/projectScopes.svelte.ts`
- `apps/desktop/web/src/lib/stores/enabledModels.svelte.ts`
- new `apps/desktop/web/src/lib/service/*`
- new `apps/desktop/web/src/lib/desktop/*`

### Possible supporting changes

- `apps/desktop/web/package.json`
- root `package.json`
- `apps/desktop/web/vite.config.js`

---

## 11) Acceptance criteria

Frontend/client work is complete for the first milestone when:

- [ ] shared UI code no longer depends directly on raw Tauri APIs for core service/session behavior
- [ ] a service client abstraction exists and is used by the main stores/handlers
- [ ] a desktop adapter abstraction exists for window/focus behavior
- [ ] browser mode loads without Tauri runtime errors
- [ ] browser mode can perform the main chat flow against the Graphone service
- [ ] desktop mode still works

---

## 12) Manual validation checklist

### Browser mode

- [ ] app loads in browser without `@tauri-apps/*` runtime failures
- [ ] session list/create/open works
- [ ] prompts work
- [ ] streaming responses render live
- [ ] messages/history load correctly
- [ ] settings persist via browser-safe storage

### Desktop mode

- [ ] current desktop dev flow still boots
- [ ] event bridge still works in desktop mode
- [ ] floating session windows still work if they existed before
- [ ] desktop settings persistence still works

---

## 13) What not to do

Do not:

- solve browser mode by faking a Tauri global without a real service path
- let shared stores/components keep importing raw Tauri modules indefinitely
- block browser mode on floating-window parity
- move client presentation settings into the runtime service unnecessarily
- tie the service client interface to localhost-only assumptions

---

## 14) Handoff note for coding agents

If you are working on the frontend, ask these questions before changing code:

- “Is this a service concern or a desktop shell concern?”
- “Can browser mode survive if this stays in shared UI code?”
- “Can I preserve current UI behavior while only moving the dependency boundary?”

If a feature only makes sense for desktop shell behavior, keep it behind the desktop adapter.
If it is about sessions/messages/models/events, it belongs in the service client.
