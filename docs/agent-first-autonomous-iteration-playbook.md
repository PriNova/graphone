# Agent-First Autonomous Iteration Playbook

## Purpose

Default operating model for coding agents working with minimal human supervision across repos such as:

- CLI tools
- web apps
- desktop apps
- APIs/services
- networked systems
- file/data pipelines
- SDKs/libraries
- plugin/extension systems

Goal: make agents **self-correcting**, not human-corrected.

---

## Core loop

A task is not done when code is changed. Follow this loop:

1. **Orient** — identify boundary, intended behavior, current behavior, relevant files, likely failure mode, and success signal.
2. **Reproduce or define** — create/use a failing test, smoke, contract check, repro script, or artifact comparison.
3. **Instrument** — ensure useful feedback exists: structured logs, traces, snapshots, explicit exit codes, machine-readable summaries.
4. **Implement in small steps** — keep changes narrow, one boundary at a time, and update tests/contracts with code.
5. **Validate** — run the narrowest useful check first, then broader checks as needed.
6. **Inspect failures** — use logs, traces, diffs, artifacts, stdout/stderr, and stack traces; do not guess.
7. **Conclude with proof** — acceptance criteria met, validations pass, gaps documented, regressions not knowingly introduced.

Before editing, be able to answer:

- What should happen?
- What happens now?
- How will success be detected?

---

## Universal rules

1. **Prefer machine-checkable success** — use tests, smokes, contracts, or artifact diffs whenever possible.
2. **Reproduce before refactor** — if behavior is not checkable yet, create a reproducible signal first.
3. **Preserve boundaries** — classify the change before editing:
   - UI/presentation
   - business logic
   - protocol/contract
   - transport/network
   - persistence/storage
   - platform/shell integration
   - build/tooling
4. **Add observability before guessing** — improve visibility with logs, traces, dumps, snapshots.
5. **Narrow the blast radius** — touch as few files/layers as practical per iteration.
6. **Prefer explicit contracts over hidden coupling** — define and validate requests, responses, events, file formats, CLI output, lifecycle expectations.
7. **Fail loudly and informatively** — failures should point to the exact command, artifact, missing field, or diff.
8. **Use human supervision only for exceptions** — escalate for ambiguous product decisions, security/trust boundaries, public contract changes, architecture disputes, or missing requirements.

---

## Acceptance criteria pattern

For substantial work, define:

### Behavior
What the system must do.

### Non-regression
What must continue to work.

### Validation
Which commands/tests/smokes prove success.

### Artifacts
Which logs/traces/files must exist on success or failure.

### Escalation triggers
What requires human review.

Example:

```md
Acceptance criteria:

- API returns expected field X for valid requests
- invalid requests return 4xx with machine-readable error body
- existing endpoint Y behavior is unchanged
- contract tests pass
- smoke script exits 0
- on failure, request/response trace is written to artifacts/
```

---

## Required feedback surfaces

Projects that support autonomous iteration should provide as many of these as practical.

### 1) Tests

Choose the right test for the boundary:

- **Unit** — pure logic, parsers, validators, small transformations
- **Integration** — component interaction, service/database integration, file I/O, SDK/API wrappers
- **Contract** — schemas, protocol compatibility, event envelopes, CLI/JSON/file format stability
- **Smoke** — end-to-end critical path and boot confidence
- **Snapshot/golden** — render output, formatted output, protocol traces, generated artifacts, stable serialization

### 2) Logs

Prefer structured logs with fields such as:

- timestamp
- level
- component
- event name
- identifiers (`sessionId`, `requestId`, `jobId`, etc.)
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

### 3) Traces

Often better than logs for event-driven systems. Common trace types:

- request/response
- event stream
- state transition
- browser console
- network capture summary
- filesystem action trace

Prefer line-oriented formats like NDJSON.

### 4) Failure artifacts

Save inspectable artifacts automatically when practical, for example:

- `artifacts/test-run/<timestamp>/stdout.txt`
- `artifacts/test-run/<timestamp>/stderr.txt`
- `artifacts/test-run/<timestamp>/trace.ndjson`
- `artifacts/test-run/<timestamp>/screenshot.png`
- `artifacts/test-run/<timestamp>/response.json`

### 5) Guardrails

Automated checks that prevent drift, such as:

- forbidden imports across layers
- forbidden direct filesystem scanning outside approved modules
- forbidden network access in pure/test code
- forbidden secrets in logs
- forbidden contract-breaking changes without version bump

---

## TDD and debug-first guidance

### TDD

Use TDD aggressively when requirements are precise and feedback is fast, especially for:

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

For UI-heavy flows, combine focused component/contract tests with smoke tests and stable screenshots/snapshots where useful.

### Debug-first mode

When direct validation is hard, switch to debug-first mode:

- enable verbose or structured logging
- enable trace capture
- run a minimal scenario
- inspect exact failure point
- reduce scenario size if needed
- patch the smallest likely cause
- rerun the same scenario

Prefer this over speculative refactoring.

---

## Domain guidance

### A) CLI tools
Use:

- command invocation tests
- exit code checks
- stdout/stderr snapshots
- output file snapshots when applicable

Helpful additions:

- `--json` or other machine-readable mode
- stable error formatting
- smoke scripts for common flows

Verify:

- exit status
- output format
- invalid input behavior
- help/usage text if affected

### B) Web apps
Use:

- component/unit tests for logic
- API contract tests
- browser smoke tests
- browser console/error capture
- network trace or request-log capture

Helpful additions:

- browser-mode smoke command
- captured console logs
- stable test IDs/selectors

Verify:

- page boot
- core flow completion
- no uncaught runtime errors
- expected network/service contract behavior

### C) Desktop GUIs
Use:

- logic tests where possible
- desktop smoke boot
- shell adapter tests
- captured app logs
- screenshots only when useful and stable

Helpful additions:

- headless or scripted launch
- predictable log path
- shell-specific error capture

Verify:

- app starts
- main view loads
- platform hooks do not crash
- core workflow still works

### D) APIs and services
Use:

- contract tests
- integration tests
- request/response trace capture
- structured logs
- health/smoke checks

Helpful additions:

- golden response fixtures for critical paths
- protocol/version metadata
- reproducible local startup command

Verify:

- response schema
- error schema
- endpoint compatibility
- startup and shutdown behavior

### E) Networked/event-driven systems
Use:

- event sequence tests
- trace comparison
- timeout/retry tests
- reconnect/recovery smoke tests

Helpful additions:

- stable event envelope
- event timestamps/IDs where useful
- event trace dump on failure

Verify:

- event ordering
- no silent drops for critical events
- clear timeout/failure behavior

### F) File I/O and data pipelines
Use:

- fixture-based integration tests
- golden file comparisons
- artifact diffing
- directory tree assertions

Helpful additions:

- test fixtures
- output normalization
- explicit path reporting on failure

Verify:

- exact file creation/modification behavior
- invalid input handling
- deterministic output when expected

### G) SDKs/libraries
Use:

- public API tests
- compatibility tests
- example program tests
- docs/examples validation

Helpful additions:

- small runnable examples
- contract tests around public types and outputs

Verify:

- public API behavior
- docs/examples still work
- no accidental breaking changes

### H) Plugin/extension systems
Use:

- host contract tests
- activation/deactivation tests
- isolated failure tests
- trust-boundary tests
- sample plugin smoke tests

Helpful additions:

- manifest validation
- API version checks
- activation diagnostics
- sandbox/trust policy checks where relevant

Verify:

- contributions register correctly
- host survives plugin failure
- untrusted sources are not executed accidentally

---

## Contracts and interfaces

When touching a boundary, define or preserve a contract.

Common boundary types:

- API request/response
- event envelope
- CLI flags and output
- config schema
- plugin manifest
- file format
- IPC messages
- storage schema

Recommended checks:

- validate required fields
- validate invalid-case behavior
- preserve backward compatibility where required
- snapshot representative examples

If a contract changes, document it and update validation.

---

## Observability checklist

A project is agent-friendly when an agent can answer from tests and artifacts alone:

1. Did the system start successfully?
2. Which step failed?
3. Which boundary failed?
4. What was expected vs actual?
5. Where are the logs/traces/artifacts?
6. Can the same scenario be rerun deterministically?

If several answers are “no,” improve feedback surfaces before expecting high autonomy.

---

## Escalation conditions

Escalate when:

- product intent is ambiguous
- multiple plausible behaviors exist with no clear source of truth
- a public contract must change and compatibility is unclear
- trust/security boundaries are affected
- no validation signal can be created without a product decision
- the issue depends on inaccessible external infrastructure
- reproduction is intermittent and observability is insufficient

Escalation is correct when ambiguity is real.

---

## Minimal handoff template

Every completed task should end with:

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

---

## Repository setup recommendations

Repos that want agent-first iteration should provide:

1. clear build/test commands
2. focused smoke commands
3. structured logs
4. debug/trace mode
5. artifact output paths
6. guardrail scripts
7. stable acceptance criteria in docs or task packets

Even partial support here improves autonomous implementation quality.

---

## Final rule

A coding agent should leave behind not just a code change, but a **better self-debugging system**:

- easier to test
- easier to trace
- easier to validate
- easier for the next agent to continue autonomously
