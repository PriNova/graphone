use std::process::Command;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;

use crate::types::RpcImageAttachment;

fn run_command_stdout(command: &str, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    Some(output.stdout)
}

fn normalize_image_mime_type(mime_type: &str) -> String {
    mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .trim()
        .to_lowercase()
}

fn pick_preferred_image_mime_type(types: &[String]) -> Option<String> {
    const PREFERRED_TYPES: [&str; 6] = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/bmp",
        "image/x-ms-bmp",
    ];

    for preferred in PREFERRED_TYPES {
        if let Some(found) = types
            .iter()
            .find(|mime| normalize_image_mime_type(mime) == preferred)
        {
            return Some(found.clone());
        }
    }

    types
        .iter()
        .find(|mime| normalize_image_mime_type(mime).starts_with("image/"))
        .cloned()
}

pub fn read_clipboard_image_linux() -> Option<RpcImageAttachment> {
    let mime_types = run_command_stdout("wl-paste", &["--list-types"])
        .and_then(|output| String::from_utf8(output).ok())
        .map(|text| {
            text.lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(selected_type) = pick_preferred_image_mime_type(&mime_types) {
        if let Some(bytes) = run_command_stdout(
            "wl-paste",
            &["--type", selected_type.as_str(), "--no-newline"],
        ) {
            return Some(RpcImageAttachment {
                r#type: "image".to_string(),
                data: BASE64_STANDARD.encode(bytes),
                mime_type: normalize_image_mime_type(&selected_type),
            });
        }
    }

    let target_types =
        run_command_stdout("xclip", &["-selection", "clipboard", "-t", "TARGETS", "-o"])
            .and_then(|output| String::from_utf8(output).ok())
            .map(|text| {
                text.lines()
                    .map(|line| line.trim().to_string())
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

    let fallback_types = if target_types.is_empty() {
        vec![
            "image/png".to_string(),
            "image/jpeg".to_string(),
            "image/webp".to_string(),
            "image/gif".to_string(),
            "image/bmp".to_string(),
            "image/x-ms-bmp".to_string(),
        ]
    } else {
        target_types
    };

    for mime_type in fallback_types {
        if !normalize_image_mime_type(&mime_type).starts_with("image/") {
            continue;
        }

        if let Some(bytes) = run_command_stdout(
            "xclip",
            &["-selection", "clipboard", "-t", mime_type.as_str(), "-o"],
        ) {
            return Some(RpcImageAttachment {
                r#type: "image".to_string(),
                data: BASE64_STANDARD.encode(bytes),
                mime_type: normalize_image_mime_type(&mime_type),
            });
        }
    }

    None
}
