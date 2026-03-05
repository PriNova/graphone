#[cfg(target_os = "linux")]
use flate2::read::GzDecoder;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::io::{self, Read};
#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::UNIX_EPOCH;
#[cfg(target_os = "linux")]
use tauri::{AppHandle, Manager};

#[cfg(target_os = "linux")]
use crate::logger;

#[cfg(target_os = "linux")]
const SIDECAR_GZIP_NAME: &str = "pi.gz";
#[cfg(target_os = "linux")]
const SIDECAR_BINARY_NAME: &str = "pi";

#[cfg(target_os = "linux")]
fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create directory {}: {}",
            destination.display(),
            error
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read directory {}: {}", source.display(), error))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to iterate directory {}: {}",
                source.display(),
                error
            )
        })?;

        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = entry.metadata().map_err(|error| {
            format!(
                "Failed to read metadata for {}: {}",
                source_path.display(),
                error
            )
        })?;

        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create directory {}: {}", parent.display(), error)
                })?;
            }

            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy runtime asset {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn resolve_compressed_sidecar_path(source_dir: &Path) -> Option<PathBuf> {
    let compressed = source_dir.join(SIDECAR_GZIP_NAME);
    if compressed.exists() {
        return Some(compressed);
    }

    None
}

#[cfg(target_os = "linux")]
fn resolve_linux_sidecar_source_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("sidecar").join("linux"));
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar/linux"));

    for candidate in candidates {
        if resolve_compressed_sidecar_path(&candidate).is_some() {
            return Ok(candidate);
        }
    }

    Err("Linux sidecar bundle not found in resource directories".to_string())
}

#[cfg(target_os = "linux")]
fn source_stamp(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to stat {}: {}", path.display(), error))?;

    let modified_secs = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    Ok(format!("{}:{}", metadata.len(), modified_secs))
}

#[cfg(target_os = "linux")]
fn validate_linux_sidecar_binary(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "Failed to open {} for validation: {}",
            path.display(),
            error
        )
    })?;

    let mut header = [0_u8; 4];
    file.read_exact(&mut header).map_err(|error| {
        format!(
            "Failed to read ELF header from {}: {}",
            path.display(),
            error
        )
    })?;

    if header == [0x7f, b'E', b'L', b'F'] {
        return Ok(());
    }

    Err(format!(
        "Linux sidecar binary {} is not a valid ELF executable. Rebuild without GRAPHONE_SKIP_SIDECAR_BUILD.",
        path.display()
    ))
}

#[cfg(target_os = "linux")]
pub(crate) fn prepare_linux_sidecar_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let source_dir = resolve_linux_sidecar_source_dir(app)?;
    let compressed_binary = resolve_compressed_sidecar_path(&source_dir)
        .ok_or_else(|| "Linux sidecar compressed binary not found".to_string())?;
    let source_stamp = source_stamp(&compressed_binary)?;

    let app_local_data_dir = app.path().app_local_data_dir().map_err(|error| {
        format!(
            "Failed to resolve app local data directory for linux sidecar: {}",
            error
        )
    })?;

    let runtime_dir = app_local_data_dir.join("sidecar").join("linux-runtime");
    let stamp_path = runtime_dir.join(".stamp");
    let extracted_binary = runtime_dir.join(SIDECAR_BINARY_NAME);

    let needs_refresh = match fs::read_to_string(&stamp_path) {
        Ok(current_stamp) => current_stamp.trim() != source_stamp || !extracted_binary.exists(),
        Err(_) => true,
    };

    if !needs_refresh {
        if let Err(error) = validate_linux_sidecar_binary(&extracted_binary) {
            logger::log(format!(
                "Linux sidecar runtime at {} failed validation ({}). Refreshing runtime.",
                extracted_binary.display(),
                error
            ));
        } else {
            return Ok(runtime_dir);
        }
    }

    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir).map_err(|error| {
            format!(
                "Failed to remove stale linux sidecar runtime {}: {}",
                runtime_dir.display(),
                error
            )
        })?;
    }

    fs::create_dir_all(&runtime_dir).map_err(|error| {
        format!(
            "Failed to create linux sidecar runtime {}: {}",
            runtime_dir.display(),
            error
        )
    })?;

    for entry in fs::read_dir(&source_dir)
        .map_err(|error| format!("Failed to read {}: {}", source_dir.display(), error))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to iterate source sidecar directory {}: {}",
                source_dir.display(),
                error
            )
        })?;

        let source_path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if name == SIDECAR_GZIP_NAME {
            continue;
        }

        let destination_path = runtime_dir.join(&*name);
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy linux sidecar asset {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }
    }

    let source_file = fs::File::open(&compressed_binary).map_err(|error| {
        format!(
            "Failed to open compressed linux sidecar {}: {}",
            compressed_binary.display(),
            error
        )
    })?;
    let mut decoder = GzDecoder::new(source_file);

    let mut output_file = fs::File::create(&extracted_binary).map_err(|error| {
        format!(
            "Failed to create extracted linux sidecar {}: {}",
            extracted_binary.display(),
            error
        )
    })?;

    io::copy(&mut decoder, &mut output_file).map_err(|error| {
        format!(
            "Failed to extract linux sidecar {}: {}",
            extracted_binary.display(),
            error
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&extracted_binary)
            .map_err(|error| {
                format!(
                    "Failed to read permissions for {}: {}",
                    extracted_binary.display(),
                    error
                )
            })?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&extracted_binary, permissions).map_err(|error| {
            format!(
                "Failed to set executable permissions on {}: {}",
                extracted_binary.display(),
                error
            )
        })?;
    }

    validate_linux_sidecar_binary(&extracted_binary)?;

    fs::write(&stamp_path, source_stamp).map_err(|error| {
        format!(
            "Failed to write linux sidecar stamp {}: {}",
            stamp_path.display(),
            error
        )
    })?;

    Ok(runtime_dir)
}
