# Path B SDK Host Measurements (February 2026)

## Summary

Measured on:
- WSL2 Linux (`x64`), Node `v22.22.0`
- Graphone host sidecar: `services/agent-host`
- Legacy baseline: one `@mariozechner/pi-coding-agent` RPC process per session

Result: **Path B host implementation is functionally working and now the Graphone runtime backend.**

## What was measured

Scripts:
- `tooling/scripts/measure-path-b.mjs`
- `tooling/scripts/verify-path-b-host.mjs`

Scenarios per architecture:
- 1, 2, and 4 concurrent sessions
- RSS memory usage (sum across processes)
- Session creation latency
- `get_state` command latency
- Concurrent prompt wall-clock (`"Reply with exactly: OK"`)

Raw result file:
- `reports/path-b-measurements-2026-02.json`

## Functional verification

`verify-path-b-host.mjs` passed:
- create two sessions (`sess-A`, `sess-B`)
- run concurrent prompts and observe `session_event` routing by `sessionId`
- close one session
- verify no further events are emitted for the closed session

## Key numbers (final run)

### Memory (RSS total)
- **1 session**: host `180,840 KB` vs legacy `182,868 KB` (~1.1% lower)
- **2 sessions**: host `183,644 KB` vs legacy `363,348 KB` (~49.5% lower)
- **4 sessions**: host `189,528 KB` vs legacy `711,596 KB` (~73.4% lower)

### Session creation total time
- **1 session**: host `~808 ms` vs legacy `~1,049 ms`
- **2 sessions**: host `~947 ms` vs legacy `~1,937 ms`
- **4 sessions**: host `~1,236 ms` vs legacy `~3,994 ms`

### Concurrent prompt wall-clock
- **1 session**: host `~892 ms` vs legacy `~997 ms`
- **2 sessions**: host `~1,077 ms` vs legacy `~2,196 ms`
- **4 sessions**: host `~1,663 ms` vs legacy `~1,904 ms`

Notes:
- Prompt timings include network/model variability and can fluctuate.
- Memory and creation-time trends were stable and clearly favored Path B for multi-session loads.

## Decision

Based on functional checks + measurements:
- ✅ Keep Path B host sidecar implementation
- ✅ Fully switch Graphone to host backend
- ✅ Remove runtime legacy backend toggle path from Graphone app backend/build flow

## Implementation switch completed

Switched to host-only flow in:
- `src-tauri/build.rs`
- `src-tauri/src/sidecar.rs`
- `src-tauri/src/commands.rs`

Legacy comparison remains available only in `tooling/scripts/measure-path-b.mjs` (for benchmark runs), not in Graphone runtime.
