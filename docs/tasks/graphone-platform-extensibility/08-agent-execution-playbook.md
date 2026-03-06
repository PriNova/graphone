# Agent Execution Playbook

## Goal

Provide a practical execution guide for coding agents working from the plans in this folder.

This is not architecture. This is the operational playbook for parallel implementation.

---

## 1) Operating assumptions

This program is intended to be implemented primarily by coding agents, with human developers supervising.

The execution sequence should be tracked in [`00-sequenced-implementation-roadmap.md`](./00-sequenced-implementation-roadmap.md).

That means each agent should optimize for:

- minimal ambiguity
- minimal cross-workstream conflicts
- explicit validation
- explicit handoff output
- respect for architectural boundaries

---

## 2) Before you code

Every coding agent should complete this checklist first.

- [ ] Read `README.md` in this folder
- [ ] Read `00-sequenced-implementation-roadmap.md`
- [ ] Read `01-architecture-principles.md`
- [ ] Read the workstream section relevant to your task in `07-parallel-workstreams.md`
- [ ] Read the exact local files you expect to touch
- [ ] Confirm whether your task is in:
  - runtime/service
  - client shell/browser
  - Graphone declarative extensibility
  - Graphone plugin foundation
- [ ] Identify likely merge-conflict files before making changes

If you cannot do all six, stop and ask for clarification.

---

## 3) Mandatory local-first workflow

Before using broad assumptions, inspect the local code.

For Graphone tasks, especially inspect:

- `services/agent-host/src/*`
- `apps/desktop/web/src/*`
- `src-tauri/src/*` where desktop integration is relevant

For pi behavior questions, inspect local `../pi-mono` sources/docs first.

Do not design from memory if the local code can answer the question directly.

---

## 4) Workstream classification guide

Use this cheat sheet.

### If the task is about...

Remember throughout: desktop-shell work is not the same as core runtime/client architecture. Tauri-specific code belongs only at the shell boundary.

#### Session/runtime behavior

Examples:

- create/list/prompt/abort sessions
- command reflection
- resource reload
- event streaming

Then it belongs to:

- **service/runtime workstream**

Primary area:

- `services/agent-host`

#### Tauri/browser shell differences

Examples:

- current window context
- floating windows
- focus handling
- desktop-only hooks

Then it belongs to:

- **desktop shell/client workstream**

Primary area:

- frontend desktop adapter / windowing helpers

#### Rich tool rendering / Graphone-specific visual output

Examples:

- `_html`
- structured tool result rendering
- canvas/artifact metadata routing

Then it belongs to:

- **declarative Graphone UI extensibility**

Primary area:

- frontend renderers + Graphone UI contracts

#### Client-installed workbench extension points

Examples:

- custom panels
- plugin commands
- plugin renderers

Then it belongs to:

- **Graphone plugin foundation**

Primary area:

- future `apps/desktop/web/src/lib/plugins/*`

---

## 5) Validation discipline

Every code change should be validated at the smallest appropriate level.

### Service/runtime changes

Typical checks:

- host builds/runs
- command dispatch works
- session lifecycle still works
- reflective metadata returns expected shape

### Frontend/client changes

Typical checks:

- type check passes
- main chat page still boots
- desktop mode still works if touched
- browser mode works if relevant

### Renderer/plugin changes

Typical checks:

- rendering path still works for default content
- new renderer path only activates when expected
- unsupported metadata fails safely

---

## 6) Recommended validation commands

Use only the ones relevant to your work.

### Graphone repo

- `npm run check`
- `npm run build`
- `npm run dev:linux` for desktop verification where needed

### Service/host-focused iteration

If working in `services/agent-host`, also use targeted build/run steps there if available.

### pi-mono reference validation

Only when needed for understanding or comparison. Avoid unnecessary cross-repo edits.

---

## 7) Change-sizing rules

Prefer small, boundary-preserving steps.

### Good changes

- introducing one interface and moving one call site to it
- adding one reflective service command and wiring it end-to-end
- extracting one Tauri-specific concern behind a desktop adapter
- formalizing one Graphone UI metadata contract

### Risky changes

- rewriting many stores and runtime wiring in one pass
- changing transport and UI logic in the same large patch
- inventing plugin machinery before renderer contribution points are stable

If your patch is large, split it.

---

## 8) Handoff format for each completed task

Every coding agent should end with a plain-text handoff in this structure:

### Summary

- workstream
- scope
- files changed

### Implemented

- bullet list of concrete completed steps

### Validated

- commands run
- flows tested

### Open follow-ups

- what remains
- what depends on another workstream

### Risks / notes

- compatibility risks
- merge-conflict hotspots
- architectural assumptions made

This is the minimum required handoff format.

---

## 9) Escalation rules

Escalate to a supervising developer if any of these happen:

- you need to change `../pi-mono` core behavior instead of Graphone only
- two workstreams need to claim the same high-conflict file extensively
- a proposed change would introduce a second extension/resource registry in Graphone
- a proposed browser-mode change depends on Tauri internals
- a proposed plugin feature would allow remote code injection into clients

Do not “just proceed” on those.

---

## 10) Definition of done for an agent task

A task is done only if:

- the code change is implemented
- validation was actually run
- acceptance criteria for that sub-task are met
- the handoff is written clearly
- the change does not violate the architecture principles in this folder

If validation was skipped, the task is not done.

---

## 11) Final operating rule

When in doubt, bias toward:

- pi-owned runtime behavior
- Graphone-host-owned service boundaries
- Graphone-client-owned workbench behavior
- declarative UI extension contracts before executable plugin systems

That bias will keep the implementation aligned even when multiple agents work in parallel.
