use std::path::Path;
use std::process::{Command, Stdio};

use crate::logger;

pub fn has_windows_host_interop() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|version| version.to_lowercase().contains("microsoft"))
        .unwrap_or(false)
        || Path::new("/mnt/c/Windows").exists()
}

pub fn open_external_url_linux(url: &str) -> Result<(), String> {
    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();

    if has_windows_host_interop() {
        candidates.push((
            "cmd.exe".to_string(),
            vec![
                "/C".to_string(),
                "start".to_string(),
                "".to_string(),
                format!("\"{}\"", url.replace('"', "%22")),
            ],
        ));

        candidates.push((
            "powershell.exe".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                format!("Start-Process '{}'", url.replace('\'', "''")),
            ],
        ));

        candidates.push(("explorer.exe".to_string(), vec![url.to_string()]));
    }

    candidates.push(("xdg-open".to_string(), vec![url.to_string()]));
    candidates.push(("gio".to_string(), vec!["open".to_string(), url.to_string()]));

    let mut failures: Vec<String> = Vec::new();

    for (program, args) in candidates {
        match Command::new(&program)
            .args(args.iter())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => {
                logger::log(format!("Opened OAuth URL with {}", program));
                return Ok(());
            }
            Ok(status) => {
                failures.push(format!("{} exited with status {}", program, status));
            }
            Err(error) => {
                failures.push(format!("{} failed: {}", program, error));
            }
        }
    }

    Err(format!(
        "Failed to open external URL on Linux. Attempts: {}",
        failures.join(" | ")
    ))
}
