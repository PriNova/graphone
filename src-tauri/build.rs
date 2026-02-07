use std::process::Command;
use std::path::Path;
use std::env;
use std::fs;

fn main() {
    // Tell Cargo to rerun this script if build.rs itself changes
    println!("cargo:rerun-if-changed=build.rs");
    
    // Get target information
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_triple = env::var("TARGET").unwrap();
    
    // Run tauri_build with Windows manifest if building for Windows
    if target_os == "windows" {
        let manifest = include_str!("windows-app.manifest");
        let windows = tauri_build::WindowsAttributes::new()
            .app_manifest(manifest);
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(windows)
        ).expect("failed to run tauri build");
    } else {
        tauri_build::build();
    }
    
    // Only build sidecar for desktop platforms
    // Skip for mobile builds
    if target_os == "android" || target_os == "ios" {
        println!("cargo:warning=Skipping pi-agent build for mobile target");
        return;
    }
    
    // Path to pi-mono coding-agent package
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let pi_mono_path = Path::new(&manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("pi-mono")
        .join("packages")
        .join("coding-agent");
    
    if !pi_mono_path.exists() {
        println!("cargo:warning=pi-mono not found at {:?}", pi_mono_path);
        println!("cargo:warning=Please clone pi-mono at the same level as graphone: ../pi-mono");
        return;
    }
    
    println!("cargo:warning=Building pi-agent binary for target: {}", target_triple);
    
    // Check if bun is available
    let bun_check = Command::new("which")
        .arg("bun")
        .status();
    
    if bun_check.is_err() || !bun_check.unwrap().success() {
        panic!("bun is not installed. Please install bun: https://bun.sh/docs/installation");
    }
    
    // Run npm install in pi-mono if needed
    if !pi_mono_path.join("node_modules").exists() {
        println!("cargo:warning=Installing dependencies for pi-mono...");
        let status = Command::new("npm")
            .args(&["install"])
            .current_dir(&pi_mono_path)
            .status()
            .expect("Failed to run npm install in pi-mono");
        
        if !status.success() {
            panic!("Failed to install pi-mono dependencies");
        }
    }
    
    // Build the binary using npm run build:binary
    let status = Command::new("npm")
        .args(&["run", "build:binary"])
        .current_dir(&pi_mono_path)
        .status()
        .expect("Failed to execute npm run build:binary for pi-agent");
    
    if !status.success() {
        panic!("Failed to build pi-agent binary");
    }
    
    // Determine source binary path
    let source_binary = pi_mono_path
        .join("dist")
        .join("pi");
    
    if !source_binary.exists() {
        panic!("Built binary not found at {:?}", source_binary);
    }
    
    // Determine destination path - Tauri expects binaries in src-tauri/binaries/
    // relative to the Cargo.toml (CARGO_MANIFEST_DIR)
    let dest_dir = Path::new(&manifest_dir)
        .join("binaries");
    
    fs::create_dir_all(&dest_dir).expect("Failed to create binaries directory");
    
    // Tauri sidecar naming: pi-agent-<target-triple>
    // Add .exe extension for Windows
    let dest_binary_name = if target_os == "windows" {
        format!("pi-agent-{}.exe", target_triple)
    } else {
        format!("pi-agent-{}", target_triple)
    };
    
    let dest_binary = dest_dir.join(&dest_binary_name);
    
    // Copy the binary
    fs::copy(&source_binary, &dest_binary)
        .expect(&format!("Failed to copy binary from {:?} to {:?}", source_binary, dest_binary));
    
    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest_binary).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest_binary, perms).unwrap();
    }
    
    println!("cargo:warning=pi-agent built successfully at {:?}", dest_binary);
    
    // Rerun if pi-mono source changes
    println!("cargo:rerun-if-changed={}/src", pi_mono_path.display());
    println!("cargo:rerun-if-changed={}/package.json", pi_mono_path.display());
}
