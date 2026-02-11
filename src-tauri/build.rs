use std::process::Command;
use std::path::Path;
use std::env;
use std::fs;

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn build_sidecar() {
    // Get target information
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_triple = env::var("TARGET").unwrap();
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    
    // Only build sidecar for desktop platforms
    // Skip for mobile builds
    if target_os == "android" || target_os == "ios" {
        println!("cargo:warning=Skipping pi-agent build for mobile target");
        return;
    }
    
    // Path to pi-mono coding-agent package
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
    // For cross-compilation, we need to invoke bun directly with the correct --target flag
    // as bun's --compile supports cross-compilation but npm script doesn't pass target info
    let is_cross_compiling_windows = target_os == "windows" && env::consts::OS != "windows";
    
    if is_cross_compiling_windows {
        println!("cargo:warning=Cross-compiling for Windows from non-Windows host");
        println!("cargo:warning=Using bun with --target=bun-windows-x64 for cross-compilation");
        
        // First run the TypeScript build
        let status = Command::new("npm")
            .args(&["run", "build"])
            .current_dir(&pi_mono_path)
            .status()
            .expect("Failed to execute npm run build for pi-agent");
        
        if !status.success() {
            panic!("Failed to build pi-agent TypeScript");
        }
        
        // Then compile with bun for Windows target
        let status = Command::new("bun")
            .args(&["build", "--compile", "--target=bun-windows-x64", "./dist/cli.js", "--outfile", "dist/pi"])
            .current_dir(&pi_mono_path)
            .status()
            .expect("Failed to execute bun build --compile for Windows target");
        
        if !status.success() {
            panic!("Failed to cross-compile pi-agent binary for Windows");
        }
        
        // Copy assets manually (normally done by copy-binary-assets npm script)
        let status = Command::new("npm")
            .args(&["run", "copy-binary-assets"])
            .current_dir(&pi_mono_path)
            .status()
            .expect("Failed to copy binary assets");
        
        if !status.success() {
            panic!("Failed to copy binary assets");
        }
    } else {
        // Native compilation - use npm script as before
        let status = Command::new("npm")
            .args(&["run", "build:binary"])
            .current_dir(&pi_mono_path)
            .status()
            .expect("Failed to execute npm run build:binary for pi-agent");
        
        if !status.success() {
            panic!("Failed to build pi-agent binary");
        }
    }
    
    let dist_path = pi_mono_path.join("dist");
    
    // Determine source binary path
    // For Windows cross-compilation, bun automatically adds .exe extension
    let source_binary_name = if is_cross_compiling_windows { "pi.exe" } else { "pi" };
    let source_binary = dist_path.join(source_binary_name);
    
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
    
    // Copy supporting assets that the binary needs at runtime
    println!("cargo:warning=Copying pi-agent assets...");
    
    // Copy package.json
    fs::copy(dist_path.join("package.json"), dest_dir.join("package.json"))
        .expect("Failed to copy package.json");
    
    // Copy README.md and CHANGELOG.md
    fs::copy(dist_path.join("README.md"), dest_dir.join("README.md"))
        .expect("Failed to copy README.md");
    fs::copy(dist_path.join("CHANGELOG.md"), dest_dir.join("CHANGELOG.md"))
        .expect("Failed to copy CHANGELOG.md");
    
    // Copy theme directory
    if dist_path.join("theme").exists() {
        copy_dir_all(dist_path.join("theme"), dest_dir.join("theme"))
            .expect("Failed to copy theme directory");
    }
    
    // Copy export-html directory
    if dist_path.join("export-html").exists() {
        copy_dir_all(dist_path.join("export-html"), dest_dir.join("export-html"))
            .expect("Failed to copy export-html directory");
    }
    
    // Copy docs directory
    if dist_path.join("docs").exists() {
        copy_dir_all(dist_path.join("docs"), dest_dir.join("docs"))
            .expect("Failed to copy docs directory");
    }
    
    // Copy examples directory
    if dist_path.join("examples").exists() {
        copy_dir_all(dist_path.join("examples"), dest_dir.join("examples"))
            .expect("Failed to copy examples directory");
    }
    
    // Copy photon wasm file
    if dist_path.join("photon_rs_bg.wasm").exists() {
        fs::copy(dist_path.join("photon_rs_bg.wasm"), dest_dir.join("photon_rs_bg.wasm"))
            .expect("Failed to copy photon_rs_bg.wasm");
    }
    
    // Also copy assets to target/debug/ for development mode
    // When running via `cargo run` or `tauri dev`, the sidecar is executed from target/debug/
    let target_dir = Path::new(&manifest_dir)
        .join("target")
        .join(if target_os == "windows" { "debug" } else { "debug" });
    
    if target_dir.exists() {
        println!("cargo:warning=Copying assets to target/debug/ for development...");
        
        // Copy package.json
        let _ = fs::copy(dist_path.join("package.json"), target_dir.join("package.json"));
        // Copy README.md and CHANGELOG.md
        let _ = fs::copy(dist_path.join("README.md"), target_dir.join("README.md"));
        let _ = fs::copy(dist_path.join("CHANGELOG.md"), target_dir.join("CHANGELOG.md"));
        // Copy theme directory
        if dist_path.join("theme").exists() {
            let _ = copy_dir_all(dist_path.join("theme"), target_dir.join("theme"));
        }
        // Copy export-html directory
        if dist_path.join("export-html").exists() {
            let _ = copy_dir_all(dist_path.join("export-html"), target_dir.join("export-html"));
        }
        // Copy docs directory
        if dist_path.join("docs").exists() {
            let _ = copy_dir_all(dist_path.join("docs"), target_dir.join("docs"));
        }
        // Copy examples directory
        if dist_path.join("examples").exists() {
            let _ = copy_dir_all(dist_path.join("examples"), target_dir.join("examples"));
        }
        // Copy photon wasm file
        let _ = fs::copy(dist_path.join("photon_rs_bg.wasm"), target_dir.join("photon_rs_bg.wasm"));
    }
    
    println!("cargo:warning=pi-agent built successfully at {:?}", dest_binary);
    
    // Rerun if pi-mono source changes
    println!("cargo:rerun-if-changed={}/src", pi_mono_path.display());
    println!("cargo:rerun-if-changed={}/package.json", pi_mono_path.display());
}

fn main() {
    // Tell Cargo to rerun this script if build.rs itself changes
    println!("cargo:rerun-if-changed=build.rs");
    
    // Get target information
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    
    // Build sidecar FIRST before calling tauri_build
    // Tauri's build system checks for externalBin resources at build time
    build_sidecar();
    
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
}
