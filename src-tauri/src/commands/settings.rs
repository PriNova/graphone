use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::logger;

#[derive(Debug, Clone, Serialize)]
pub struct EnabledModelsResponse {
    /// Effective enabledModels patterns as stored in the selected settings file.
    ///
    /// Semantics (matching pi): an empty list means "no scoping" (all models enabled).
    pub patterns: Vec<String>,
    /// Whether the enabledModels key exists in the selected settings file.
    pub defined: bool,
    /// Where the effective setting came from: "project", "global", or "none".
    pub source: String,
}

fn home_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".pi").join("settings.json"))
}

fn agent_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".pi").join("agent").join("settings.json"))
}

fn project_settings_path(project_dir: Option<&str>) -> Option<PathBuf> {
    project_dir.map(|dir| PathBuf::from(dir).join(".pi").join("settings.json"))
}

fn read_enabled_models_from_settings(path: &Path) -> (bool, Vec<String>) {
    if !path.exists() {
        return (false, Vec::new());
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            logger::log(format!(
                "Failed to read settings file {}: {}",
                path.display(),
                e
            ));
            return (false, Vec::new());
        }
    };

    let settings = match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(v) => v,
        Err(e) => {
            logger::log(format!(
                "Failed to parse settings file {} as JSON: {}",
                path.display(),
                e
            ));
            return (false, Vec::new());
        }
    };

    let Some(obj) = settings.as_object() else {
        return (false, Vec::new());
    };

    let Some(enabled_models) = obj.get("enabledModels") else {
        return (false, Vec::new());
    };

    if enabled_models.is_null() {
        // Explicit null means "defined, but no scoping".
        return (true, Vec::new());
    }

    let Some(arr) = enabled_models.as_array() else {
        logger::log(format!(
            "enabledModels in {} is not an array; ignoring",
            path.display()
        ));
        return (false, Vec::new());
    };

    let patterns = arr
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect::<Vec<String>>();

    (true, patterns)
}

fn write_enabled_models_to_settings(path: &Path, patterns: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create settings directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    let mut root: serde_json::Value = if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        root = serde_json::json!({});
    }

    let arr = patterns
        .iter()
        .map(|s| serde_json::Value::String(s.clone()))
        .collect::<Vec<_>>();

    root["enabledModels"] = serde_json::Value::Array(arr);

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(path, format!("{}\n", serialized))
        .map_err(|e| format!("Failed to write settings file {}: {}", path.display(), e))?;

    Ok(())
}

fn load_enabled_models(project_dir: Option<&str>) -> EnabledModelsResponse {
    let project_path = project_settings_path(project_dir);
    if let Some(project_path) = project_path.as_ref() {
        let (defined, patterns) = read_enabled_models_from_settings(project_path);
        if defined {
            return EnabledModelsResponse {
                patterns,
                defined,
                source: "project".to_string(),
            };
        }
    }

    let home_path = home_settings_path();
    if let Some(home_path) = home_path.as_ref() {
        let (defined, patterns) = read_enabled_models_from_settings(home_path);
        if defined {
            return EnabledModelsResponse {
                patterns,
                defined,
                source: "global".to_string(),
            };
        }
    }

    let agent_path = agent_settings_path();
    if let Some(agent_path) = agent_path.as_ref() {
        let (defined, patterns) = read_enabled_models_from_settings(agent_path);
        if defined {
            return EnabledModelsResponse {
                patterns,
                defined,
                source: "global".to_string(),
            };
        }
    }

    EnabledModelsResponse {
        patterns: Vec::new(),
        defined: false,
        source: "none".to_string(),
    }
}

/// Get enabledModels patterns from pi settings.
///
/// Precedence: project settings (`<projectDir>/.pi/settings.json`) override home settings (`~/.pi/settings.json`), which override agent settings (`~/.pi/agent/settings.json`).
pub fn get_enabled_models(project_dir: Option<String>) -> EnabledModelsResponse {
    load_enabled_models(project_dir.as_deref())
}

/// Persist enabledModels patterns to a pi settings file.
///
/// - patterns: the enabledModels array to write. Empty means "no scoping" (all models enabled).
/// - scope: "auto" (default), "project", or "global".
pub fn set_enabled_models(
    patterns: Vec<String>,
    scope: Option<String>,
    project_dir: Option<String>,
) -> Result<EnabledModelsResponse, String> {
    let scope = scope.unwrap_or_else(|| "auto".to_string());

    let project_path = project_settings_path(project_dir.as_deref());
    let home_path = home_settings_path();
    let agent_path = agent_settings_path();

    let target_path: PathBuf = match scope.as_str() {
        "project" => {
            project_path.ok_or_else(|| "Failed to determine project settings path".to_string())?
        }
        "global" => {
            agent_path.ok_or_else(|| "Failed to determine global settings path".to_string())?
        }
        "auto" => {
            if let Some(p) = project_path.as_ref() {
                if p.exists() {
                    p.clone()
                } else if let Some(home) = home_path.as_ref() {
                    if home.exists() {
                        home.clone()
                    } else {
                        agent_path
                            .clone()
                            .ok_or_else(|| "Failed to determine global settings path".to_string())?
                    }
                } else {
                    agent_path
                        .clone()
                        .ok_or_else(|| "Failed to determine global settings path".to_string())?
                }
            } else if let Some(home) = home_path.as_ref() {
                if home.exists() {
                    home.clone()
                } else {
                    agent_path
                        .clone()
                        .ok_or_else(|| "Failed to determine global settings path".to_string())?
                }
            } else {
                agent_path
                    .clone()
                    .ok_or_else(|| "Failed to determine global settings path".to_string())?
            }
        }
        other => {
            return Err(format!(
                "Invalid scope '{}'. Expected 'auto', 'project', or 'global'",
                other
            ));
        }
    };

    write_enabled_models_to_settings(&target_path, &patterns)?;

    Ok(load_enabled_models(project_dir.as_deref()))
}
