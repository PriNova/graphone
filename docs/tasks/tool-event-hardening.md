# Future enhancement: tool event payload hardening

## Context

Tool UIs now render immediately on `tool_execution_start` and attach final output on `tool_execution_end`.

A remaining operational risk is oversized event payloads (especially large tool outputs) crossing the Tauri WebView IPC boundary.

`src-tauri/src/sidecar.rs` already has a 60k character guard for emitted payloads. When exceeded, the event is skipped.

## Proposed hardening (future work)

1. **Pre-emit payload compaction for tool events**
   - In `EventHandler::compact_session_event_for_frontend`, add dedicated handling for:
     - `tool_execution_start`
     - `tool_execution_update`
     - `tool_execution_end`
   - Keep required fields only (`toolCallId`, `toolName`, `args`, `isError`, compacted result text preview).

2. **Deterministic truncation metadata**
   - If result/update content is truncated for IPC safety, include explicit metadata:
   - `truncated: true`, `truncatedBytes`, `originalBytesEstimate`.

3. **Prefer update suppression over end suppression**
   - If size pressure occurs, suppress/compact `tool_execution_update` first.
   - Preserve `tool_execution_end` whenever possible so UI can always reach a terminal state.

4. **Fallback fetch path for oversized end results**
   - If an end event still exceeds limits, emit a compact marker event and let frontend request full content via RPC (future command) keyed by `toolCallId`.

## Why this helps

- Prevents silent drops for large tool outputs.
- Preserves immediate UX while remaining robust under worst-case output sizes.
- Keeps frontend logic simple: always correlate via `toolCallId`.
