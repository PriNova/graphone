# pi-agent-host (Graphone local sidecar)

Graphone-local host/multiplexer sidecar for Path B.

It runs as one process and manages many in-process `AgentSession`s via the SDK.

## Protocol

Transport: newline-delimited JSON over stdio.

### Request

```json
{
  "id": "req-1",
  "type": "create_session",
  "cwd": "/path/to/project"
}
```

### Response

```json
{
  "id": "req-1",
  "type": "response",
  "command": "create_session",
  "success": true,
  "data": { "sessionId": "...", "cwd": "/path/to/project" }
}
```

### Session event

```json
{
  "type": "session_event",
  "sessionId": "sess-123",
  "event": { "type": "message_update", "...": "..." }
}
```

## Supported commands (MVP)

- `create_session`
- `close_session`
- `list_sessions`
- `prompt`
- `steer`
- `follow_up`
- `abort`
- `new_session`
- `get_messages`
- `get_state`
- `set_model`
- `cycle_model`
- `get_available_models`
- `shutdown`

## MVP behavior

- Sessions are **in-memory** (`SessionManager.inMemory()`), no persisted session files.
- Each session has isolated `cwd`.
- Shared host-level `AuthStorage` + `ModelRegistry` are reused across sessions.
- `get_available_models` returns a compact model list `{ provider, id, name }`.
- Legacy RPC-only commands outside the list above are not supported in this host.

## Local development

```bash
cd sidecars/pi-agent-host
bun run build
node dist/cli.js
```

Send newline-delimited JSON requests on stdin.
