# Graphone Plugin API Plan

## Goal

Define how Graphone itself becomes extensible without competing with or replacing pi’s runtime extensibility.

This document covers:

- Graphone-native UI/workbench extensibility
- contribution points
- trust boundaries
- rollout phases
- what should be declarative first vs executable later

This is intentionally separate from pi runtime extensions.

---

## 1) Core distinction

Graphone needs its own extensibility model, but it must not replace pi’s.

## 1.1 pi extensions

pi extensions remain the extensibility model for:

- tools
- commands
- skills
- prompts
- providers
- runtime/session behavior

These extend **how the agent behaves**.

---

## 1.2 Graphone plugins

Graphone plugins should extend:

- workbench rendering
- panels and views
- visualizations
- settings contributions
- commands/actions in the GUI
- Graphone-only workflows and inspectors

These extend **how the workbench behaves**.

---

## 1.3 Why Graphone needs its own plugin layer

Without a Graphone plugin API, the only way to customize Graphone UI behavior is to patch core code.

That does not scale.

The goal is to make Graphone more like:

- a workbench/platform
- with stable extension points
- and client-side customization possibilities

This is the open/closed principle applied to the Graphone product surface.

---

## 2) Design rules

## 2.1 Client-installed, not service-injected

Graphone plugins must be installed where the Graphone client runs.

### Hard rule

A connected local/remote service must not silently inject executable UI plugins into the client.

Why:

- security
- version compatibility
- browser/desktop differences
- trust boundary clarity

The service may provide declarative metadata that Graphone knows how to render. That is different.

---

## 2.2 Declarative before executable

Graphone should start with declarative UI extension contracts before introducing a full executable plugin host.

Examples of declarative contracts:

- `details._html`
- structured tool result metadata
- canvas/artifact descriptors
- view hints
- renderer keys

This gives Graphone extensibility sooner and with less risk.

---

## 2.3 Contribution points over arbitrary hooks

Do not design Graphone extensibility as arbitrary “run code anywhere” injection.

Instead, use stable contribution points.

Examples:

- register tool renderer
- register panel/view
- register settings section
- register command/action
- register session inspector
- register artifact/canvas renderer

This keeps the system understandable and versionable.

---

## 2.4 Versioned API

Graphone plugins should target a versioned API.

Minimum requirement:

- plugin declares API version
- Graphone checks compatibility before activation

This is necessary for a sustainable plugin ecosystem.

---

## 3) Recommended rollout phases

## Phase P0 — Declarative Graphone UI conventions

Goal:

- support rich, Graphone-specific UI behavior without client-side plugin code loading

Examples to formalize:

- `details._html`
- structured renderer hints in tool result/message metadata
- canvas/artifact descriptors
- named presentation targets

### Why this first

- works with local and remote services
- low implementation risk
- no executable plugin loader needed
- immediately useful for pi runtime extensions targeting Graphone UI

---

## Phase P1 — Local Graphone plugin host foundation

Goal:

- introduce a small Graphone-native client plugin API for workbench contributions

Initial scope should be narrow.

Recommended first contribution points:

- tool renderer registration
- settings section contributions
- command/action contributions
- sidebar/detail panel contributions

Keep v1 intentionally modest.

---

## Phase P2 — Package story alignment

Goal:

- allow a broader ecosystem story where a package may contain:
  - pi runtime resources
  - Graphone UI plugin resources

Important:

- runtime pieces are installed where the service runs
- client plugin pieces are installed where the client runs

Do not collapse those two install targets.

---

## 4) Declarative extensibility model

## 4.1 What belongs here

Use declarative Graphone UI contracts for things like:

- rich tool result rendering
- embedded HTML/SVG previews
- custom artifact/canvas rendering metadata
- structured status cards or tables
- tool-specific renderer selection hints

### Current starting point

Graphone already has this pattern:

- `details._html`

This should be formalized and documented as part of a broader Graphone UI contract family.

---

## 4.2 What does not belong here

Do not force declarative metadata to solve everything.

If a feature clearly needs reusable client-side behavior, it may belong in the plugin layer later.

But the first question should be:

- “Can this be represented as stable data that Graphone can render?”

If yes, prefer the declarative route first.

---

## 5) Executable plugin host model

When Graphone introduces executable plugins, keep them:

- local to the client
- versioned
- contribution-point-based
- capability-scoped

### Recommended v1 plugin shape

A plugin should look conceptually like:

```ts
export interface GraphonePlugin {
  id: string;
  apiVersion: "1";
  activate(ctx: GraphonePluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```

### Recommended plugin context capabilities

```ts
export interface GraphonePluginContext {
  registerToolRenderer(def: ToolRendererContribution): void;
  registerPanel(def: PanelContribution): void;
  registerCommand(def: CommandContribution): void;
  registerSettingsSection(def: SettingsSectionContribution): void;
  getServiceClient(): GraphoneServiceClient;
  getWorkbenchState(): WorkbenchStateView;
}
```

This is illustrative, not final code.

---

## 6) First-class contribution points

These are the best candidates for the first Graphone plugin API.

## 6.1 Tool renderers

Why first:

- Graphone already renders tool results richly
- Graphone already has Graphone-specific presentation conventions
- tool renderer registration is a natural, bounded extension point

Use cases:

- custom tool result UI
- charts/diagrams
- canvas/artifact previews
- structured diagnostics views

---

## 6.2 Settings sections

Why early:

- bounded UI surface
- easy to version
- useful for plugin configuration

Use cases:

- plugin config UIs
- visualization preferences
- connection/workbench preferences

---

## 6.3 Commands/actions

Why early:

- useful in command palette/toolbars/context actions
- bounded behavior
- supports workbench automation scenarios later

Use cases:

- open custom panel
- refresh a plugin view
- inspect active session
- run a Graphone-local visualization action

---

## 6.4 Panels and inspectors

Why useful:

- supports workbench customization
- supports session-aware visual tools
- natural path for more advanced Graphone functionality

Use cases:

- active-session inspector
- tool diagnostics panel
- model/provider status panel
- artifact explorer

---

## 7) What to postpone

Do not put these into the first plugin API unless there is a very strong need:

- arbitrary access to all internal stores/state objects
- unrestricted DOM injection across the app
- plugin-defined network transport layers
- service-delivered executable plugins
- deep sandbox design before there is a proven need

The first plugin API should be intentionally narrow and boring.

---

## 8) Packaging and installation model

## 8.1 Separate install targets

Even if one package later contains both runtime and UI pieces, installation targets must remain conceptually separate:

- pi runtime resources -> installed where the service runs
- Graphone UI plugins -> installed where the client runs

This matters for remote service setups.

---

## 8.2 Trust model

Graphone plugins should be treated as trusted local extensions.

The first implementation does not need an advanced sandbox, but it does need explicit user intent and predictable loading.

### Minimum future-safe principles

- plugin loading should be opt-in
- plugin directories/sources should be explicit
- plugin API version mismatch should fail safely
- plugin activation failures should be isolated and visible

---

## 9) Suggested implementation sequence

## Step G1 — Formalize declarative Graphone UI contracts

Deliverables:

- clear docs for `_html` and related metadata patterns
- stable internal renderer routing points
- capability metadata for client/service awareness

---

## Step G2 — Introduce renderer registry foundation

Deliverables:

- internal Graphone renderer registry for core + future plugin contributions
- tool-name or metadata-based dispatch points
- no external plugin execution required yet

---

## Step G3 — Introduce local plugin manifest + activation skeleton

Deliverables:

- plugin manifest shape
- plugin API version check
- activation lifecycle
- first contribution points only

---

## Step G4 — Add a small local plugin loading path

Deliverables:

- explicit client-side plugin discovery/loading path
- failure diagnostics
- enable/disable control later if needed

Keep this local-only and explicit.

---

## 10) Files likely to change later

### Declarative/renderer foundation

- `apps/desktop/web/src/lib/components/Messages/*`
- renderer utility files
- new Graphone UI contract helpers

### Plugin API foundation

- new `apps/desktop/web/src/lib/plugins/*`
- new contribution registries
- future settings/workbench wiring

### Documentation/examples

- `services/agent-host/runtime-overrides/examples/extensions/*`
- new Graphone plugin examples once the plugin API exists

---

## 11) Acceptance criteria

### Declarative extensibility milestone

- [ ] Graphone-specific UI metadata conventions are documented and stable
- [ ] renderer dispatch points are explicit and reusable
- [ ] Graphone can render richer UI from service-provided declarative metadata without executable plugin loading

### Plugin foundation milestone

- [ ] Graphone has a small versioned plugin API draft
- [ ] at least one bounded contribution point works end-to-end
- [ ] plugin failures do not crash the entire app
- [ ] no remote service can auto-install executable UI plugins into a client

---

## 12) Decision rule for implementers

Use this rule before adding Graphone extensibility machinery:

- If it can be modeled as **data the client already knows how to render**, keep it declarative.
- If it clearly needs **reusable client behavior**, add a bounded Graphone plugin contribution point.
- If it changes **agent/runtime behavior**, it belongs in pi/runtime/service, not the Graphone plugin API.
