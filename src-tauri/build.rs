use flate2::write::GzEncoder;
use flate2::Compression;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

fn env_flag(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

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

fn copy_path(src: &Path, dst: &Path) -> io::Result<()> {
    if src.is_dir() {
        copy_dir_all(src, dst)
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
        Ok(())
    }
}

fn gzip_file(source: &Path, destination: &Path) {
    let input = fs::File::open(source).unwrap_or_else(|error| {
        panic!(
            "Failed to open sidecar binary for compression {}: {}",
            source.display(),
            error
        )
    });

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!(
                "Failed to create sidecar resource directory {}: {}",
                parent.display(),
                error
            )
        });
    }

    let output = fs::File::create(destination).unwrap_or_else(|error| {
        panic!(
            "Failed to create compressed sidecar {}: {}",
            destination.display(),
            error
        )
    });

    let mut encoder = GzEncoder::new(output, Compression::best());
    let mut reader = io::BufReader::new(input);
    io::copy(&mut reader, &mut encoder).unwrap_or_else(|error| {
        panic!(
            "Failed to compress sidecar binary {} to {}: {}",
            source.display(),
            destination.display(),
            error
        )
    });

    encoder.finish().unwrap_or_else(|error| {
        panic!(
            "Failed to finalize compressed sidecar {}: {}",
            destination.display(),
            error
        )
    });
}

fn stage_linux_sidecar_resource_bundle(
    manifest_dir: &Path,
    binaries_dir: &Path,
    sidecar_binary: &Path,
    target_os: &str,
) {
    if target_os != "linux" {
        return;
    }

    let bundle_dir = manifest_dir.join("sidecar").join("linux");
    remove_path_if_exists(&bundle_dir);
    fs::create_dir_all(&bundle_dir).unwrap_or_else(|error| {
        panic!(
            "Failed to create linux sidecar bundle directory {}: {}",
            bundle_dir.display(),
            error
        )
    });

    let binary_file_name = sidecar_binary
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");

    for entry in fs::read_dir(binaries_dir).unwrap_or_else(|error| {
        panic!(
            "Failed to read sidecar binaries directory {}: {}",
            binaries_dir.display(),
            error
        )
    }) {
        let entry = entry.unwrap_or_else(|error| {
            panic!(
                "Failed to iterate sidecar binaries directory {}: {}",
                binaries_dir.display(),
                error
            )
        });

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if file_name == binary_file_name || file_name.starts_with("pi-agent-") {
            continue;
        }

        let source_path = entry.path();
        let destination_path = bundle_dir.join(&*file_name);

        copy_path(&source_path, &destination_path).unwrap_or_else(|error| {
            panic!(
                "Failed to copy sidecar runtime asset from {} to {}: {}",
                source_path.display(),
                destination_path.display(),
                error
            )
        });
    }

    let compressed_binary = bundle_dir.join("pi-agent.gz");
    gzip_file(sidecar_binary, &compressed_binary);

    println!(
        "cargo:warning=Staged linux sidecar resources at {}",
        bundle_dir.display()
    );
}

#[derive(Debug, Clone, Copy)]
enum SidecarSourceKind {
    GraphoneHost,
    NpmDependency,
}

#[derive(Debug, Clone)]
struct SidecarSource {
    kind: SidecarSourceKind,
    package_root: PathBuf,
}

impl SidecarSource {
    fn label(&self) -> &'static str {
        match self.kind {
            SidecarSourceKind::GraphoneHost => "graphone local host",
            SidecarSourceKind::NpmDependency => "npm dependency",
        }
    }
}

fn run_command(command: &str, args: &[String], cwd: &Path, step: &str) {
    let status = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .status()
        .unwrap_or_else(|error| {
            panic!(
                "Failed to {}: {} {:?} (cwd: {})\nError: {}",
                step,
                command,
                args,
                cwd.display(),
                error
            )
        });

    if !status.success() {
        panic!(
            "Command failed while {}: {} {:?} (cwd: {})",
            step,
            command,
            args,
            cwd.display()
        );
    }
}

fn ensure_bun_installed() {
    let bun_check = Command::new("bun").arg("--version").status();

    if bun_check.is_err() || !bun_check.unwrap().success() {
        panic!("bun is not installed. Please install bun: https://bun.sh/docs/installation");
    }
}

fn ensure_source_is_ready(source: &SidecarSource) {
    let dist_cli = source.package_root.join("dist").join("cli.js");

    match source.kind {
        SidecarSourceKind::GraphoneHost => {
            let source_cli = source.package_root.join("src").join("cli.ts");

            if !source_cli.exists() {
                panic!(
                    "Graphone host source entrypoint not found at {}",
                    source_cli.display()
                );
            }
        }
        SidecarSourceKind::NpmDependency => {
            if !dist_cli.exists() {
                panic!(
                    "Expected dist/cli.js in npm package at {}. Run 'npm install' again.",
                    dist_cli.display()
                );
            }
        }
    }
}

fn resolve_compiled_binary_path(output_stem: &Path, target_os: &str) -> PathBuf {
    let output_exe = output_stem.with_extension("exe");

    if target_os == "windows" {
        if output_exe.exists() {
            return output_exe;
        }
        if output_stem.exists() {
            return output_stem.to_path_buf();
        }
    } else {
        if output_stem.exists() {
            return output_stem.to_path_buf();
        }
        if output_exe.exists() {
            return output_exe;
        }
    }

    panic!(
        "Compiled sidecar binary not found. Checked {} and {}",
        output_stem.display(),
        output_exe.display()
    );
}

fn compile_sidecar_binary(
    source: &SidecarSource,
    target_os: &str,
    target_triple: &str,
    is_cross_compiling_windows: bool,
    compile_dir: &Path,
    external_koffi: bool,
) -> PathBuf {
    fs::create_dir_all(compile_dir).expect("Failed to create temporary sidecar compile directory");

    let output_stem = compile_dir.join("pi");

    let mut args = vec![
        "build".to_string(),
        "--compile".to_string(),
        "--production".to_string(),
        "--minify".to_string(),
        "--define".to_string(),
        "DEBUG=false".to_string(),
        "--no-compile-autoload-dotenv".to_string(),
        "--no-compile-autoload-bunfig".to_string(),
    ];

    let explicit_target = env::var("GRAPHONE_PI_AGENT_BUN_TARGET").ok();

    let compile_target = explicit_target.or_else(|| {
        if target_triple == "x86_64-unknown-linux-gnu" {
            Some("bun-linux-x64-baseline".to_string())
        } else if target_triple == "x86_64-pc-windows-msvc" {
            Some("bun-windows-x64-baseline".to_string())
        } else if is_cross_compiling_windows {
            Some("bun-windows-x64".to_string())
        } else {
            None
        }
    });

    if let Some(target) = compile_target {
        args.push(format!("--target={}", target));
    }

    if external_koffi {
        args.push("--external".to_string());
        args.push("koffi".to_string());
    }

    let entrypoint = match source.kind {
        SidecarSourceKind::GraphoneHost => "./src/cli.ts",
        SidecarSourceKind::NpmDependency => "./dist/cli.js",
    };

    args.push(entrypoint.to_string());
    args.push("--outfile".to_string());
    args.push(output_stem.to_string_lossy().to_string());

    run_command(
        "bun",
        &args,
        &source.package_root,
        "compile pi-agent binary with bun",
    );

    resolve_compiled_binary_path(&output_stem, target_os)
}

fn format_candidates(candidates: &[PathBuf]) -> String {
    candidates
        .iter()
        .map(|candidate| format!("- {}", candidate.display()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn remove_path_if_exists(path: &Path) {
    if !path.exists() {
        return;
    }

    if path.is_dir() {
        fs::remove_dir_all(path).unwrap_or_else(|error| {
            panic!("Failed to remove directory {}: {}", path.display(), error)
        });
    } else {
        fs::remove_file(path)
            .unwrap_or_else(|error| panic!("Failed to remove file {}: {}", path.display(), error));
    }
}

fn copy_required_file(candidates: &[PathBuf], destination: &Path, label: &str) {
    let source = candidates
        .iter()
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| {
            panic!(
                "Missing required {}. Checked:\n{}",
                label,
                format_candidates(candidates)
            )
        });

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!("Failed to create directory {}: {}", parent.display(), error)
        });
    }

    fs::copy(source, destination).unwrap_or_else(|error| {
        panic!(
            "Failed to copy {} from {} to {}: {}",
            label,
            source.display(),
            destination.display(),
            error
        )
    });
}

fn copy_required_dir(candidates: &[PathBuf], destination: &Path, label: &str) {
    let source = candidates
        .iter()
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| {
            panic!(
                "Missing required {} directory. Checked:\n{}",
                label,
                format_candidates(candidates)
            )
        });

    remove_path_if_exists(destination);

    copy_dir_all(source, destination).unwrap_or_else(|error| {
        panic!(
            "Failed to copy {} directory from {} to {}: {}",
            label,
            source.display(),
            destination.display(),
            error
        )
    });
}

fn find_dependency_file(start: &Path, relative_path: &str) -> Option<PathBuf> {
    let mut current = Some(start);

    while let Some(dir) = current {
        let candidate = dir.join("node_modules").join(relative_path);
        if candidate.exists() {
            return Some(candidate);
        }
        current = dir.parent();
    }

    None
}

fn resolve_koffi_triplet(target_os: &str, target_triple: &str) -> Option<&'static str> {
    if target_os == "windows" && target_triple.starts_with("x86_64-") {
        return Some("win32_x64");
    }

    if target_os == "linux" && target_triple.starts_with("x86_64-") {
        return Some("linux_x64");
    }

    None
}

fn copy_external_koffi_runtime(
    project_root: &Path,
    destination: &Path,
    target_os: &str,
    target_triple: &str,
) {
    let koffi_root = project_root.join("node_modules").join("koffi");
    if !koffi_root.exists() {
        panic!(
            "koffi package not found at {}. Run 'npm install'.",
            koffi_root.display()
        );
    }

    let triplet = resolve_koffi_triplet(target_os, target_triple).unwrap_or_else(|| {
        panic!(
            "No koffi runtime triplet mapping for target {} ({})",
            target_triple, target_os
        )
    });

    let destination_root = destination.join("node_modules").join("koffi");
    let destination_triplet_root = destination_root.join("build").join("koffi").join(triplet);

    remove_path_if_exists(&destination_triplet_root);

    copy_required_file(
        &[koffi_root.join("package.json")],
        &destination_root.join("package.json"),
        "koffi package.json",
    );

    copy_required_file(
        &[koffi_root.join("index.js")],
        &destination_root.join("index.js"),
        "koffi index.js",
    );

    copy_required_file(
        &[koffi_root
            .join("build")
            .join("koffi")
            .join(triplet)
            .join("koffi.node")],
        &destination_triplet_root.join("koffi.node"),
        "koffi native module",
    );
}

fn copy_runtime_assets(
    source: &SidecarSource,
    project_root: &Path,
    destination: &Path,
    target_os: &str,
    target_triple: &str,
    external_koffi: bool,
) {
    let dist_path = source.package_root.join("dist");

    fs::create_dir_all(destination).unwrap_or_else(|error| {
        panic!(
            "Failed to create destination directory {}: {}",
            destination.display(),
            error
        )
    });

    copy_required_file(
        &[
            source.package_root.join("package.json"),
            dist_path.join("package.json"),
        ],
        &destination.join("package.json"),
        "package.json",
    );

    copy_required_file(
        &[
            source.package_root.join("README.md"),
            dist_path.join("README.md"),
        ],
        &destination.join("README.md"),
        "README.md",
    );

    copy_required_file(
        &[
            source.package_root.join("CHANGELOG.md"),
            dist_path.join("CHANGELOG.md"),
        ],
        &destination.join("CHANGELOG.md"),
        "CHANGELOG.md",
    );

    copy_required_dir(
        &[
            dist_path.join("theme"),
            dist_path.join("modes").join("interactive").join("theme"),
        ],
        &destination.join("theme"),
        "theme",
    );

    copy_required_dir(
        &[
            dist_path.join("export-html"),
            dist_path.join("core").join("export-html"),
        ],
        &destination.join("export-html"),
        "export-html",
    );

    copy_required_dir(
        &[dist_path.join("docs"), source.package_root.join("docs")],
        &destination.join("docs"),
        "docs",
    );

    copy_required_dir(
        &[
            dist_path.join("examples"),
            source.package_root.join("examples"),
        ],
        &destination.join("examples"),
        "examples",
    );

    let mut wasm_candidates = vec![
        dist_path.join("photon_rs_bg.wasm"),
        source
            .package_root
            .join("node_modules")
            .join("@silvia-odwyer")
            .join("photon-node")
            .join("photon_rs_bg.wasm"),
        project_root
            .join("node_modules")
            .join("@silvia-odwyer")
            .join("photon-node")
            .join("photon_rs_bg.wasm"),
    ];

    if let Some(found) = find_dependency_file(
        &source.package_root,
        "@silvia-odwyer/photon-node/photon_rs_bg.wasm",
    ) {
        wasm_candidates.push(found);
    }

    copy_required_file(
        &wasm_candidates,
        &destination.join("photon_rs_bg.wasm"),
        "photon_rs_bg.wasm",
    );

    if external_koffi {
        copy_external_koffi_runtime(project_root, destination, target_os, target_triple);
    }
}

fn sidecar_destination_binary_path(
    manifest_dir: &Path,
    target_os: &str,
    target_triple: &str,
) -> PathBuf {
    let dest_dir = manifest_dir.join("binaries");
    let dest_binary_name = if target_os == "windows" {
        format!("pi-agent-{}.exe", target_triple)
    } else {
        format!("pi-agent-{}", target_triple)
    };

    dest_dir.join(dest_binary_name)
}

fn ensure_sidecar_placeholder_binary(manifest_dir: &Path, target_os: &str, target_triple: &str) {
    let dest_binary = sidecar_destination_binary_path(manifest_dir, target_os, target_triple);

    if dest_binary.exists() {
        return;
    }

    if let Some(parent) = dest_binary.parent() {
        fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!(
                "Failed to create binaries directory {}: {}",
                parent.display(),
                error
            )
        });
    }

    let placeholder_bytes: &[u8] = if target_os == "windows" {
        b"graphone ci placeholder sidecar binary"
    } else {
        b"#!/bin/sh\necho \"Graphone sidecar build was skipped (GRAPHONE_SKIP_SIDECAR_BUILD).\" >&2\nexit 1\n"
    };

    fs::write(&dest_binary, placeholder_bytes).unwrap_or_else(|error| {
        panic!(
            "Failed to create placeholder sidecar binary at {}: {}",
            dest_binary.display(),
            error
        )
    });

    #[cfg(unix)]
    if target_os != "windows" {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest_binary).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest_binary, perms).unwrap();
    }

    println!(
        "cargo:warning=Created placeholder pi-agent binary at {}",
        dest_binary.display()
    );
}

fn ensure_linux_sidecar_bundle_for_skip_build(
    manifest_dir: &Path,
    target_os: &str,
    target_triple: &str,
) {
    if target_os != "linux" {
        return;
    }

    let sidecar_binary = sidecar_destination_binary_path(manifest_dir, target_os, target_triple);
    let binaries_dir = sidecar_binary
        .parent()
        .expect("sidecar destination should always have a parent directory");

    stage_linux_sidecar_resource_bundle(manifest_dir, binaries_dir, &sidecar_binary, target_os);
}

fn build_sidecar() {
    println!("cargo:rerun-if-env-changed=GRAPHONE_PI_AGENT_BUN_TARGET");
    println!("cargo:rerun-if-env-changed=GRAPHONE_PI_AGENT_EXTERNAL_KOFFI");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_triple = env::var("TARGET").unwrap();
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());

    if env_flag("GRAPHONE_SKIP_SIDECAR_BUILD") {
        println!(
            "cargo:warning=Skipping pi-agent build because GRAPHONE_SKIP_SIDECAR_BUILD is set"
        );
        ensure_sidecar_placeholder_binary(&manifest_dir, &target_os, &target_triple);
        ensure_linux_sidecar_bundle_for_skip_build(&manifest_dir, &target_os, &target_triple);
        return;
    }

    let project_root = manifest_dir
        .parent()
        .expect("src-tauri must have a project root parent")
        .to_path_buf();

    if target_os == "android" || target_os == "ios" {
        println!("cargo:warning=Skipping pi-agent build for mobile target");
        return;
    }

    let npm_package_path = project_root
        .join("node_modules")
        .join("@mariozechner")
        .join("pi-coding-agent");

    if !npm_package_path.exists() {
        panic!(
            "Host backend requires @mariozechner/pi-coding-agent at {}. Run 'npm install'.",
            npm_package_path.display()
        );
    }

    let graphone_host_path = project_root.join("services").join("agent-host");

    let source = SidecarSource {
        kind: SidecarSourceKind::GraphoneHost,
        package_root: graphone_host_path.clone(),
    };

    let runtime_assets_source = SidecarSource {
        kind: SidecarSourceKind::NpmDependency,
        package_root: npm_package_path.clone(),
    };

    println!(
        "cargo:warning=Building pi-agent binary for target {} from {}: {}",
        target_triple,
        source.label(),
        source.package_root.display()
    );

    ensure_bun_installed();
    ensure_source_is_ready(&source);

    let external_koffi = env::var("GRAPHONE_PI_AGENT_EXTERNAL_KOFFI")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(true);

    if external_koffi {
        println!("cargo:warning=Compiling pi-agent with externalized koffi runtime assets");
    } else {
        println!("cargo:warning=Compiling pi-agent with bundled koffi runtime");
    }

    let is_cross_compiling_windows = target_os == "windows" && env::consts::OS != "windows";

    if is_cross_compiling_windows {
        println!("cargo:warning=Cross-compiling sidecar for Windows with explicit Bun target");
    }

    let compile_dir = manifest_dir
        .join("target")
        .join("pi-agent-build")
        .join(&target_triple);

    let source_binary = compile_sidecar_binary(
        &source,
        &target_os,
        &target_triple,
        is_cross_compiling_windows,
        &compile_dir,
        external_koffi,
    );

    let dest_binary = sidecar_destination_binary_path(&manifest_dir, &target_os, &target_triple);
    let dest_dir = dest_binary
        .parent()
        .expect("sidecar destination should always have a parent directory")
        .to_path_buf();
    fs::create_dir_all(&dest_dir).expect("Failed to create binaries directory");

    fs::copy(&source_binary, &dest_binary).unwrap_or_else(|error| {
        panic!(
            "Failed to copy sidecar binary from {} to {}: {}",
            source_binary.display(),
            dest_binary.display(),
            error
        )
    });

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest_binary).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest_binary, perms).unwrap();
    }

    println!("cargo:warning=Copying pi-agent runtime assets...");
    copy_runtime_assets(
        &runtime_assets_source,
        &project_root,
        &dest_dir,
        &target_os,
        &target_triple,
        external_koffi,
    );

    stage_linux_sidecar_resource_bundle(&manifest_dir, &dest_dir, &dest_binary, &target_os);

    let target_debug_dir = manifest_dir.join("target").join("debug");
    if target_debug_dir.exists() {
        println!("cargo:warning=Copying runtime assets to target/debug for development...");
        copy_runtime_assets(
            &runtime_assets_source,
            &project_root,
            &target_debug_dir,
            &target_os,
            &target_triple,
            external_koffi,
        );
    }

    let target_release_dir = manifest_dir.join("target").join("release");
    if target_release_dir.exists() {
        println!("cargo:warning=Copying runtime assets to target/release...");
        copy_runtime_assets(
            &runtime_assets_source,
            &project_root,
            &target_release_dir,
            &target_os,
            &target_triple,
            external_koffi,
        );
    }

    println!(
        "cargo:warning=pi-agent built successfully at {}",
        dest_binary.display()
    );

    println!(
        "cargo:rerun-if-changed={}",
        project_root.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        project_root.join("package-lock.json").display()
    );

    println!(
        "cargo:rerun-if-changed={}",
        graphone_host_path.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        graphone_host_path.join("src").display()
    );

    println!(
        "cargo:rerun-if-changed={}",
        npm_package_path.join("dist").join("cli.js").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        npm_package_path.join("package.json").display()
    );
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=GRAPHONE_SKIP_SIDECAR_BUILD");
    println!("cargo:rerun-if-env-changed=GRAPHONE_SKIP_WINDOWS_MANIFEST");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();

    build_sidecar();

    if target_os == "windows" {
        if env_flag("GRAPHONE_SKIP_WINDOWS_MANIFEST") {
            println!(
                "cargo:warning=Skipping embedded Windows manifest because GRAPHONE_SKIP_WINDOWS_MANIFEST is set"
            );
            tauri_build::build();
        } else {
            let manifest = include_str!("windows-app.manifest");
            let windows = tauri_build::WindowsAttributes::new().app_manifest(manifest);
            tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
                .expect("failed to run tauri build");
        }
    } else {
        tauri_build::build();
    }
}
