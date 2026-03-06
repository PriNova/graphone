# Agent-First Autonomous Iteration Playbook

## Purpose

This document is a **general reference for coding agents** working on any kind of software project:

- CLI tools
- web apps
- desktop GUIs
- APIs
- services
- networked systems
- file/I/O-heavy systems
- SDKs/libraries
- protocol/contract-driven systems

Use this as a **default operating model** when a repository wants coding-agent-first execution with **minimal human supervision**.

This playbook is intentionally generic and reusable across projects.

---

## Core principle

A coding agent should not stop at:

- “I changed the code.”

It should work in a closed loop:

1. **understand the intended behavior**
2. **reproduce the current problem or define the desired behavior**
3. **create or use a machine-checkable signal**
4. **implement the change**
5. **run validation**
6. **inspect failures, logs, traces, and artifacts**
7. **iterate until acceptance criteria are satisfied**

The goal is to make the agent self-correcting rather than human-corrected.

---

## Default execution loop

Use this loop unless the repository provides a more specific one.

## 1) Orient

Before changing code, identify:

- the system boundary you are changing
- the expected behavior
- the existing validation surface
- the nearest relevant files
- the most likely failure mode

Do not begin implementation until you can answer:

- what should happen?
- what happens now?
- how will success be detected?

---

## 2) Reproduce or define

Whenever possible, create or identify one of these:

- failing unit test
- failing integration test
- failing contract test
- failing smoke test
- minimal reproduction script
- deterministic debug command
- stable before/after artifact comparison

If none exists, create the smallest one that proves the problem or desired behavior.

---

## 3) Instrument

Make sure the system exposes useful feedback while you iterate.

Prefer:

- structured logs
- labeled debug output
- trace files
- snapshots/golden outputs
- explicit exit codes
- machine-readable summaries

Avoid relying only on:

- ad hoc console output
- visual inspection without artifacts
- human interpretation of ambiguous states

---

## 4) Implement in small steps

Prefer:

- narrow changes
- one boundary at a time
- preserving existing behavior where not explicitly changing it
- updating tests/contracts with code

Avoid:

- broad rewrites without reproduction coverage
- changing architecture and features in one patch
- changing multiple unrelated subsystems together

---

## 5) Validate

Always run the narrowest meaningful validation first, then broader validation if needed.

Typical order:

1. focused test
2. related test suite
3. smoke flow
4. full project validation

If validation fails, do not guess. Inspect artifacts.

---

## 6) Inspect failures

When validation fails, inspect:

- logs
- stack traces
- snapshots/diffs
- event traces
- network traces
- output files
- generated artifacts
- stderr/stdout

The next patch should be based on observed evidence, not speculation.

---

## 7) Conclude with proof

A task is complete only when:

- acceptance criteria are met
- relevant validations pass
- known gaps are documented
- regressions are not introduced knowingly

---

## Universal operating rules

## Rule 1: Prefer machine-checkable success

A human should not have to decide whether the task succeeded if a test, smoke, contract check, or artifact comparison can decide it.

---

## Rule 2: Reproduce before refactor

If a bug or requirement cannot be reproduced or checked, first create a reproducible signal.

---

## Rule 3: Preserve boundaries

Before editing, classify the change:

- UI/presentation
- business logic
- protocol/contract
- transport/network
- persistence/storage
- platform/shell integration
- build/tooling

Do not casually move logic across layers.

---

## Rule 4: Add observability before guessing

If a system is hard to debug, first improve visibility:

- structured logs
- request/response traces
- event capture
- artifact dumps
- intermediate state snapshots

---

## Rule 5: Narrow the blast radius

Change as few files and layers as practical for each iteration.

---

## Rule 6: Prefer stable contracts over hidden coupling

Where systems meet, define and validate:

- request shapes
- response shapes
- event envelopes
- file formats
- CLI output formats
- lifecycle expectations

---

## Rule 7: Fail loudly and informatively

Validation and runtime tooling should make failure easy to inspect.

Bad:

- vague “something went wrong”

Better:

- exact failing command
- exact artifact path
- exact missing contract field
- exact expected vs actual diff

---

## Rule 8: Human supervision should be exception-based

Escalate to humans mainly for:

- ambiguous product decisions
- trust/security boundary changes
- public contract changes
- architectural boundary disputes
- missing requirements

Humans should not need to manually verify routine implementation quality if the repository can do that automatically.

---

## Acceptance criteria pattern

Every substantial task should define acceptance criteria in this form:

### Behavior

What the system must do.

### Non-regression

What existing behavior must continue to work.

### Validation

Which commands/tests/smokes prove success.

### Artifacts

Which logs/traces/files must exist on failure or success.

### Escalation triggers

What conditions require human review.

Example:

```md
Acceptance criteria:

- API returns expected field X for valid requests
- invalid requests return 4xx with machine-readable error body
- existing endpoint Y behavior is unchanged
- contract tests pass
- smoke script exits 0
- if failure occurs, request/response trace is written to artifacts/
```

---

## Required feedback surfaces

Projects that want strong autonomous agent iteration should provide as many of these as practical.

## 1) Tests

Use the right kind of test for the boundary.

### Unit tests

Best for:

- pure logic
- parsers/formatters
- validation functions
- small transformations

### Integration tests

Best for:

- component interaction
- service/database integration
- file I/O flows
- SDK/API wrappers

### Contract tests

Best for:

- request/response schemas
- protocol compatibility
- event envelopes
- CLI/JSON output guarantees
- file format stability

### Smoke tests

Best for:

- end-to-end critical path
- “does the app boot and perform the core use case?”
- browser/desktop/CLI top-level confidence

### Snapshot/golden tests

Best for:

- render output
- formatted output
- protocol traces
- generated code/artifacts
- stable text/JSON/UI serialization

---

## 2) Logs

Prefer structured logs for systems an agent must inspect.

Good properties:

- timestamp
- level
- component
- event name
- identifiers (sessionId/requestId/jobId/etc.)
- concise error field

Example:

```json
{
  "ts": "2026-03-06T16:00:00Z",
  "level": "error",
  "component": "api",
  "event": "request_failed",
  "requestId": "r1",
  "error": "missing field 'name'"
}
```

Avoid burying key state only in prose logs.

---

## 3) Traces

Traces are often more useful than logs for event-driven systems.

Useful trace types:

- request/response trace
- event stream trace
- state transition trace
- browser console trace
- network capture summary
- filesystem action trace

Prefer line-oriented formats such as NDJSON when possible.

---

## 4) Failure artifacts

On failure, the system should save inspectable artifacts automatically when practical.

Examples:

- `artifacts/test-run/<timestamp>/stdout.txt`
- `artifacts/test-run/<timestamp>/stderr.txt`
- `artifacts/test-run/<timestamp>/trace.ndjson`
- `artifacts/test-run/<timestamp>/screenshot.png`
- `artifacts/test-run/<timestamp>/response.json`

This reduces reruns and makes debugging much more autonomous.

---

## 5) Guardrails

Guardrails are automated checks that prevent architectural drift.

Useful guardrails:

- forbidden imports in shared layers
- forbidden direct filesystem scanning outside approved modules
- forbidden network access in pure/test code
- forbidden secrets in logs
- forbidden contract-breaking changes without version bump

Guardrails often save more supervision time than additional documentation.

---

## TDD for coding agents

TDD is especially valuable when requirements are precise and feedback is fast.

## Best use of TDD

Use TDD aggressively for:

- parsers/serializers
- protocol handlers
- command dispatch
- state transitions
- formatters
- validation logic
- render dispatch logic
- boundary transformations

Use pragmatic TDD for:

- APIs/services
- CLIs
- event-driven flows
- file processors
- plugin systems

For UI-heavy flows, combine:

- focused component/contract tests
- smoke tests
- screenshot/snapshot tests where stable

Do not force ultra-fine-grained TDD where system-level feedback is more meaningful.

---

## Debug-first development

When a task is hard to validate directly, switch to debug-first mode.

## Debug-first mode checklist

- enable verbose or structured logging
- enable trace capture
- run a minimal scenario
- inspect exact failure point
- reduce scenario size if needed
- patch smallest likely cause
- rerun same scenario

This is often better than speculative refactoring.

---

## Domain-specific guidance

## A) CLI tools

Best feedback loop:

- command invocation test
- exit code check
- stdout/stderr snapshot
- output file snapshot if applicable

Add:

- `--json` or machine-readable output mode where helpful
- stable error formatting
- command smoke scripts for common flows

Agent should verify:

- exit status
- output format
- behavior on invalid input
- help/usage text if affected

---

## B) Web apps

Best feedback loop:

- component/unit tests for logic
- API contract tests
- browser smoke tests
- browser console/error capture
- network trace or request log capture

Add:

- browser-mode smoke command
- captured console logs
- stable test IDs/selectors for automation

Agent should verify:

- page boot
- core flow completion
- no uncaught runtime errors
- expected network/service contract behavior

---

## C) Desktop GUIs

Best feedback loop:

- logic tests where possible
- desktop smoke boot
- shell adapter tests
- captured app logs
- screenshots only if useful and stable

Add:

- headless or scripted launch when possible
- predictable log path
- shell-specific error capture

Agent should verify:

- app starts
- main view loads
- platform-specific hooks do not crash
- core workflow still works

---

## D) APIs and services

Best feedback loop:

- contract tests
- integration tests
- request/response trace capture
- structured logs
- health/smoke endpoint checks

Add:

- golden response fixtures for critical paths
- protocol/version metadata
- local reproducible startup command

Agent should verify:

- response schema
- error schema
- compatibility of required endpoints
- service startup and shutdown behavior

---

## E) Networked/event-driven systems

Best feedback loop:

- event sequence tests
- trace comparison
- timeout/retry tests
- reconnect/recovery smoke tests

Add:

- stable event envelope
- event timestamps/IDs when useful
- event trace dump on failure

Agent should verify:

- expected event ordering
- no silent drops for critical events
- clear timeout/failure behavior

---

## F) File I/O and data pipelines

Best feedback loop:

- fixture-based integration tests
- golden file comparisons
- artifact diffing
- directory tree assertions

Add:

- test fixtures
- output normalization where needed
- explicit path reporting on failure

Agent should verify:

- exact file creation/modification behavior
- invalid input handling
- deterministic output when expected

---

## G) SDKs/libraries

Best feedback loop:

- public API tests
- compatibility tests
- example program tests
- generated docs/examples validation

Add:

- small runnable examples
- contract tests around public types and outputs

Agent should verify:

- public API behavior
- docs/examples still work
- no accidental breaking changes

---

## H) Plugin/extension systems

Best feedback loop:

- host contract tests
- plugin activation/deactivation tests
- isolated failure tests
- trust-boundary tests
- sample plugin smoke tests

Add:

- plugin manifest validation
- plugin API version checks
- activation diagnostics
- sandbox/trust policy checks where relevant

Agent should verify:

- plugin contributions register correctly
- host survives plugin failure
- untrusted sources are not accidentally executed

---

## Contracts and interfaces

Whenever a task touches a boundary, define or preserve a contract.

Common boundary types:

- API request/response
- event envelope
- CLI flags and output
- config file schema
- plugin manifest
- file format
- IPC messages
- storage schema

Recommended checks:

- validate required fields
- validate invalid-case behavior
- preserve backward compatibility where required
- snapshot representative examples

If a contract changes, document the change and update validation.

---

## Observability checklist for autonomous iteration

A project is agent-friendly when an agent can answer these questions from tests and artifacts alone:

1. Did the system start successfully?
2. Which step failed?
3. Which boundary failed?
4. What was expected vs actual?
5. Where are the logs/traces/artifacts?
6. Can the same scenario be rerun deterministically?

If the answer to several of these is “no,” improve the project’s feedback surfaces before expecting high autonomy.

---

## Escalation conditions

A coding agent should escalate to a human when any of these occur:

- product intent is ambiguous
- there are multiple plausible behaviors with no clear source of truth
- a public contract must change and compatibility is unclear
- trust/security boundaries are affected
- the required validation signal cannot be created without a product decision
- the issue depends on external infrastructure the agent cannot access or reproduce
- the problem reproduces intermittently with no available observability

Escalation is a success condition when ambiguity is real. It is not a failure.

---

## Minimal handoff template

Every completed task should end with a plain-text handoff like this:

### Summary

- task goal
- files changed
- core boundary touched

### Reproduction / validation signal

- failing test/smoke/trace before change
- passing test/smoke/trace after change

### Implemented

- concise bullet list

### Validation run

- commands executed
- key results

### Failure artifacts inspected

- logs/traces/snapshots reviewed

### Known gaps / follow-ups

- anything intentionally deferred

This makes supervision lightweight and auditable.

---

## Repository setup recommendations

Any repository that wants to support agent-first iteration should try to provide:

1. **clear build/test commands**
2. **focused smoke commands**
3. **structured logs**
4. **debug/trace mode**
5. **artifact output paths**
6. **guardrail scripts**
7. **stable acceptance criteria in docs or task packets**

Even partial support here dramatically improves autonomous implementation quality.

---

## Final rule

A coding agent should aim to leave behind not just a code change, but a **better self-debugging system**:

- easier to test
- easier to trace
- easier to validate
- easier for the next agent to continue autonomously

That is how human supervision becomes minimal over time.
