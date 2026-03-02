pub(crate) fn shorten_for_log(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let shortened = value.chars().take(max_chars).collect::<String>();
    format!("{}…", shortened)
}

pub(crate) fn compact_session_event_for_frontend(event: serde_json::Value) -> serde_json::Value {
    let event_type = event.get("type").and_then(|value| value.as_str());

    match event_type {
        Some("agent_start") => serde_json::json!({ "type": "agent_start" }),
        Some("agent_end") => serde_json::json!({ "type": "agent_end" }),
        Some("turn_start") => serde_json::json!({ "type": "turn_start" }),
        Some("turn_end") => serde_json::json!({ "type": "turn_end" }),
        Some("message_update") => {
            let mut event_map = match event {
                serde_json::Value::Object(map) => map,
                _ => {
                    return serde_json::json!({
                        "type": "message_update",
                        "message": { "role": "assistant" },
                        "assistantMessageEvent": {},
                    });
                }
            };

            let role = event_map
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(|value| value.as_str())
                .unwrap_or("assistant")
                .to_string();

            let assistant_message_event = match event_map.remove("assistantMessageEvent") {
                Some(serde_json::Value::Object(mut map)) => {
                    let assistant_event_type = map
                        .get("type")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default();

                    if (assistant_event_type == "toolcall_start"
                        || assistant_event_type == "toolcall_delta")
                        && !map.contains_key("toolCall")
                    {
                        if let Some(tool_call) = extract_tool_call_from_partial(&map) {
                            map.insert("toolCall".to_string(), tool_call);
                        }
                    }

                    if let Some(tool_call) = map.get("toolCall").cloned() {
                        map.insert("toolCall".to_string(), compact_tool_call(&tool_call));
                    }

                    // Drop `partial`: frontend reconstructs streaming content via deltas.
                    map.remove("partial");
                    serde_json::Value::Object(map)
                }
                Some(value) => value,
                None => serde_json::json!({}),
            };

            serde_json::json!({
                "type": "message_update",
                "message": { "role": role },
                "assistantMessageEvent": assistant_message_event,
            })
        }
        Some("tool_execution_start") => compact_tool_execution_start_event(&event),
        Some("tool_execution_update") => compact_tool_execution_update_event(&event),
        Some("tool_execution_end") => compact_tool_execution_end_event(&event),
        Some("auto_compaction_start") => compact_auto_compaction_start_event(&event),
        Some("auto_compaction_end") => compact_auto_compaction_end_event(&event),
        Some("message_end") => {
            let message = event.get("message");

            let role = message
                .and_then(|message| message.get("role"))
                .and_then(|value| value.as_str())
                .unwrap_or("assistant");

            let mut compact_message = serde_json::Map::new();
            compact_message.insert("role".to_string(), serde_json::json!(role));

            if let Some(stop_reason) = message
                .and_then(|message| message.get("stopReason"))
                .and_then(|value| value.as_str())
            {
                compact_message.insert("stopReason".to_string(), serde_json::json!(stop_reason));
            }

            if let Some(error_message) = message
                .and_then(|message| message.get("errorMessage"))
                .and_then(|value| value.as_str())
            {
                compact_message
                    .insert("errorMessage".to_string(), serde_json::json!(error_message));
            }

            serde_json::json!({
                "type": "message_end",
                "message": serde_json::Value::Object(compact_message),
            })
        }
        _ => event,
    }
}

fn compact_auto_compaction_start_event(event: &serde_json::Value) -> serde_json::Value {
    let reason = event
        .get("reason")
        .and_then(|value| value.as_str())
        .unwrap_or("threshold");

    serde_json::json!({
        "type": "auto_compaction_start",
        "reason": reason,
    })
}

fn compact_auto_compaction_end_event(event: &serde_json::Value) -> serde_json::Value {
    const MAX_SUMMARY_CHARS: usize = 12_000;

    let aborted = event
        .get("aborted")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let will_retry = event
        .get("willRetry")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let error_message = event
        .get("errorMessage")
        .and_then(|value| value.as_str())
        .map(|value| truncate_string(value, 2000));

    let summary = event
        .get("result")
        .and_then(|result| result.get("summary"))
        .and_then(|value| value.as_str())
        .map(|value| truncate_string(value, MAX_SUMMARY_CHARS));

    let tokens_before = event
        .get("result")
        .and_then(|result| result.get("tokensBefore"))
        .and_then(|value| value.as_u64());

    let result = if summary.is_some() || tokens_before.is_some() {
        serde_json::json!({
            "summary": summary,
            "tokensBefore": tokens_before,
        })
    } else {
        serde_json::Value::Null
    };

    serde_json::json!({
        "type": "auto_compaction_end",
        "aborted": aborted,
        "willRetry": will_retry,
        "errorMessage": error_message,
        "result": result,
    })
}

fn truncate_string(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{}…", truncated)
}

fn compact_json_value(value: &serde_json::Value, depth: usize) -> serde_json::Value {
    const MAX_DEPTH: usize = 2;
    const MAX_STRING_CHARS: usize = 1024;
    const MAX_OBJECT_KEYS: usize = 16;
    const MAX_ARRAY_ITEMS: usize = 16;

    match value {
        serde_json::Value::String(text) => {
            serde_json::Value::String(truncate_string(text, MAX_STRING_CHARS))
        }
        serde_json::Value::Array(items) => {
            if depth >= MAX_DEPTH {
                return serde_json::json!({
                    "_truncatedArrayItems": items.len(),
                });
            }

            let mut compacted = items
                .iter()
                .take(MAX_ARRAY_ITEMS)
                .map(|item| compact_json_value(item, depth + 1))
                .collect::<Vec<_>>();

            if items.len() > MAX_ARRAY_ITEMS {
                compacted.push(serde_json::json!({
                    "_truncatedArrayItems": items.len() - MAX_ARRAY_ITEMS,
                }));
            }

            serde_json::Value::Array(compacted)
        }
        serde_json::Value::Object(map) => {
            if depth >= MAX_DEPTH {
                return serde_json::json!({
                    "_truncatedObjectKeys": map.len(),
                });
            }

            let mut compacted = serde_json::Map::new();

            for (index, (key, entry)) in map.iter().enumerate() {
                if index >= MAX_OBJECT_KEYS {
                    compacted.insert(
                        "_truncatedObjectKeys".to_string(),
                        serde_json::json!(map.len() - MAX_OBJECT_KEYS),
                    );
                    break;
                }

                compacted.insert(key.clone(), compact_json_value(entry, depth + 1));
            }

            serde_json::Value::Object(compacted)
        }
        _ => value.clone(),
    }
}

fn compact_tool_call(value: &serde_json::Value) -> serde_json::Value {
    let id = value
        .get("id")
        .and_then(|entry| entry.as_str())
        .unwrap_or_default()
        .to_string();

    let name = value
        .get("name")
        .and_then(|entry| entry.as_str())
        .unwrap_or_default()
        .to_string();

    let arguments = value
        .get("arguments")
        .map(|entry| compact_json_value(entry, 0))
        .unwrap_or_else(|| serde_json::json!({}));

    serde_json::json!({
        "type": "toolCall",
        "id": id,
        "name": name,
        "arguments": arguments,
    })
}

fn extract_tool_call_from_partial(
    assistant_event: &serde_json::Map<String, serde_json::Value>,
) -> Option<serde_json::Value> {
    let content_index = assistant_event
        .get("contentIndex")
        .and_then(|value| value.as_u64())? as usize;

    let partial = assistant_event.get("partial")?;
    let content = partial.get("content")?.as_array()?;
    let tool_call = content.get(content_index)?;

    if tool_call.get("type").and_then(|entry| entry.as_str()) != Some("toolCall") {
        return None;
    }

    Some(compact_tool_call(tool_call))
}

fn compact_tool_execution_start_event(event: &serde_json::Value) -> serde_json::Value {
    let tool_call_id = event
        .get("toolCallId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    let tool_name = event
        .get("toolName")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    let args = event
        .get("args")
        .map(|value| compact_json_value(value, 0))
        .unwrap_or_else(|| serde_json::json!({}));

    serde_json::json!({
        "type": "tool_execution_start",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "args": args,
    })
}

fn compact_tool_execution_update_event(event: &serde_json::Value) -> serde_json::Value {
    let tool_call_id = event
        .get("toolCallId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    let tool_name = event
        .get("toolName")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    serde_json::json!({
        "type": "tool_execution_update",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
    })
}

fn compact_tool_execution_end_event(event: &serde_json::Value) -> serde_json::Value {
    const MAX_RESULT_CHARS: usize = 24_000;

    let tool_call_id = event
        .get("toolCallId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    let tool_name = event
        .get("toolName")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    let is_error = event
        .get("isError")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let result = match event.get("result") {
        Some(serde_json::Value::String(text)) => {
            serde_json::Value::String(truncate_string(text, MAX_RESULT_CHARS))
        }
        Some(value) => compact_json_value(value, 0),
        None => serde_json::Value::Null,
    };

    serde_json::json!({
        "type": "tool_execution_end",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "isError": is_error,
        "result": result,
    })
}
