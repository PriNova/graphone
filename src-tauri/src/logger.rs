use std::env;
use std::fs::{create_dir_all, remove_file, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_FILE: OnceLock<Option<Mutex<File>>> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn timestamp() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}.{}", duration.as_secs(), duration.subsec_millis()),
        Err(_) => "0.000".to_string(),
    }
}

fn can_write_in_dir(dir: &Path) -> bool {
    let probe_name = format!(
        ".graphone-log-write-test-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let probe_path = dir.join(probe_name);

    match OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe_path)
    {
        Ok(mut file) => {
            let _ = file.write_all(b"");
            let _ = remove_file(&probe_path);
            true
        }
        Err(_) => false,
    }
}

fn get_windows_local_appdata_log_path() -> Option<PathBuf> {
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        return Some(
            PathBuf::from(local_app_data)
                .join("graphone")
                .join("logs")
                .join("graphone.log"),
        );
    }

    if let Ok(user_profile) = env::var("USERPROFILE") {
        return Some(
            PathBuf::from(user_profile)
                .join("AppData")
                .join("Local")
                .join("graphone")
                .join("logs")
                .join("graphone.log"),
        );
    }

    None
}

fn get_portable_log_path() -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let exe_path = env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;

    // Detect our staged portable layout (graphone.exe + pi-agent.exe in same dir)
    if !exe_dir.join("pi-agent.exe").exists() {
        return None;
    }

    if !can_write_in_dir(exe_dir) {
        return None;
    }

    Some(exe_dir.join("graphone.log"))
}

fn resolve_log_path() -> PathBuf {
    if let Ok(path) = env::var("GRAPHONE_LOG_PATH") {
        return PathBuf::from(path);
    }

    if let Some(portable_path) = get_portable_log_path() {
        return portable_path;
    }

    if cfg!(target_os = "windows") {
        if let Some(path) = get_windows_local_appdata_log_path() {
            return path;
        }
    }

    env::temp_dir().join("graphone.log")
}

fn init_log_file() -> Option<Mutex<File>> {
    let path = log_path();

    if let Some(parent) = path.parent() {
        create_dir_all(parent).ok()?;
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()?;

    Some(Mutex::new(file))
}

pub fn log_path() -> PathBuf {
    LOG_PATH.get_or_init(resolve_log_path).clone()
}

pub fn init() {
    let _ = LOG_FILE.get_or_init(init_log_file);
    log(format!("Logger initialized at {}", log_path().display()));
}

pub fn log(message: impl AsRef<str>) {
    let message = message.as_ref();

    #[cfg(debug_assertions)]
    eprintln!("{}", message);

    if let Some(file_mutex) = LOG_FILE.get_or_init(init_log_file).as_ref() {
        if let Ok(mut file) = file_mutex.lock() {
            let _ = writeln!(file, "[{}] {}", timestamp(), message);
        }
    }
}
