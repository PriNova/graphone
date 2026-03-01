pub(crate) fn sanitize_json_line(line: String) -> String {
    let trimmed = line
        .trim()
        .trim_start_matches('\u{feff}')
        .trim_matches('\0');

    if is_probably_clean_json_line(trimmed) {
        return trimmed.to_string();
    }

    // Sidecars may occasionally emit terminal escape sequences (OSC/CSI),
    // UTF-8 BOMs, or stray control bytes around otherwise valid JSON.
    let stripped = strip_ansi_escapes(&line);

    let mut value = stripped
        .trim()
        .trim_start_matches('\u{feff}')
        .trim_matches('\0')
        .to_string();

    if let Some(candidate) = extract_json_object_candidate(&value) {
        value = candidate;
    }

    value
}

pub(crate) fn debug_prefix_codepoints(value: &str, max_chars: usize) -> String {
    let mut parts = value
        .chars()
        .take(max_chars)
        .map(|c| format!("U+{:04X}", c as u32))
        .collect::<Vec<_>>();

    if value.chars().count() > max_chars {
        parts.push("…".to_string());
    }

    parts.join(" ")
}

pub(crate) fn extract_lines(chunk: Vec<u8>, buffer: &mut Vec<u8>) -> Vec<String> {
    buffer.extend_from_slice(&chunk);

    let mut lines = Vec::new();
    while let Some(newline_index) = buffer.iter().position(|b| *b == b'\n') {
        let mut line = buffer.drain(..=newline_index).collect::<Vec<u8>>();

        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if line.last() == Some(&b'\r') {
            line.pop();
        }

        lines.push(decode_utf8_lossy(line));
    }

    lines
}

pub(crate) fn decode_utf8_lossy(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes)
        .unwrap_or_else(|err| String::from_utf8_lossy(&err.into_bytes()).into_owned())
}

fn is_probably_clean_json_line(value: &str) -> bool {
    if !value.starts_with('{') || !value.ends_with('}') {
        return false;
    }

    !value.as_bytes().contains(&0x1b)
}

fn strip_ansi_escapes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }

        match chars.peek().copied() {
            Some('[') => {
                // CSI: ESC [ ... <final byte>
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            Some(']') => {
                // OSC: ESC ] ... BEL or ESC \
                chars.next();
                while let Some(c) = chars.next() {
                    if c == '\u{07}' {
                        break;
                    }
                    if c == '\u{1b}' && matches!(chars.peek().copied(), Some('\\')) {
                        chars.next();
                        break;
                    }
                }
            }
            Some('P') | Some('X') | Some('^') | Some('_') => {
                // DCS/SOS/PM/APC: ESC <code> ... ESC \
                chars.next();
                while let Some(c) = chars.next() {
                    if c == '\u{1b}' && matches!(chars.peek().copied(), Some('\\')) {
                        chars.next();
                        break;
                    }
                }
            }
            Some(_) => {
                // Other ESC sequence with one introducer byte.
                chars.next();
            }
            None => break,
        }
    }

    out
}

fn extract_json_object_candidate(input: &str) -> Option<String> {
    let start = input.find('{')?;
    let end = input.rfind('}')?;
    if end < start {
        return None;
    }

    Some(input[start..=end].to_string())
}
