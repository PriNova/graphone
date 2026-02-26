# Troubleshooting

Common issues and solutions for Graphone development and deployment.

---

## bun not found

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH in ~/.bashrc or ~/.zshrc
export PATH="$HOME/.bun/bin:$PATH"
```

---

## Sidecar build fails

```bash
# Reinstall dependencies (ensures npm SDK assets are present)
npm install

# Verify package exists
ls node_modules/@mariozechner/pi-coding-agent/dist/cli.js

# Rebuild host sidecar path
npm run build:linux
```

---

## Compile check fails with `resource path \`sidecar/linux\` doesn't exist`

This can happen if Linux sidecar resources were not staged (for example on older commits when using `GRAPHONE_SKIP_SIDECAR_BUILD=true`).

```bash
# Re-run Rust compile check (build.rs should stage sidecar/linux automatically)
GRAPHONE_SKIP_SIDECAR_BUILD=true cargo check --manifest-path src-tauri/Cargo.toml

# Verify staged resource exists
ls src-tauri/sidecar/linux/pi-agent.gz
```

If the file is still missing, ensure you're on a commit that includes the Linux sidecar resource staging fix and retry.

---

## Binary not found during Tauri build

Ensure the binary naming matches the target triple:

- Linux: `pi-agent-x86_64-unknown-linux-gnu`
- Windows: `pi-agent-x86_64-pc-windows-msvc.exe`

---

## Session initialization fails with `Failed to spawn sidecar: Exec format error (os error 8)`

This indicates the Linux sidecar binary being launched is invalid for the current platform (for example, stale placeholder content in extracted runtime cache).

```bash
# 1) Rebuild normally (do not skip sidecar build)
npm run build:linux

# 2) Clear extracted Linux runtime cache
rm -rf ~/.local/share/com.prinova.graphone/sidecar/linux-runtime

# 3) Start app again
npm run dev:linux
```

If you must run compile checks in CI with `GRAPHONE_SKIP_SIDECAR_BUILD=true`, that is fine, but production/dev Linux runs should use a real sidecar build.

---

## Windows build fails with "link.exe not found" or "could not open 'shell32.lib'"

This happens when `cargo-xwin` is not used. The npm scripts handle this automatically, but if running manually:

```bash
# Wrong - will fail:
npm run tauri build -- --target x86_64-pc-windows-msvc

# Correct - use cargo-xwin via --runner flag:
source ~/.cargo/env && cargo tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin

# Or use the npm script (recommended):
npm run build:windows
```

**Cause:** Cross-compiling for Windows requires Windows SDK libraries (kernel32.lib, shell32.lib, etc.) which `cargo-xwin` downloads and configures automatically.

---

## Windows build fails with `NotAttempted("llvm-rc")` / `tauri-winres` panic

If the build log shows a panic from `tauri-winres` with `NotAttempted("llvm-rc")`, the Windows resource compiler alias is missing from `PATH`.

Typical symptom:

- `thread 'main' panicked ... called Result::unwrap() on an Err value: NotAttempted("llvm-rc")`

On Ubuntu, `llvm-rc` is often installed as a versioned binary like `llvm-rc-18`.

```bash
# Check available binaries
command -v llvm-rc || true
ls /usr/bin/llvm-rc* 2>/dev/null

# Create stable alias used by tauri/embed-resource
mkdir -p ~/.local/bin
ln -sf /usr/bin/llvm-rc-18 ~/.local/bin/llvm-rc

# Ensure ~/.local/bin is on PATH
export PATH="$HOME/.local/bin:$PATH"
```

Then retry:

```bash
npm run build:windows:portable
```

Alternative (one-off override without symlink):

```bash
RC_x86_64_pc_windows_msvc=llvm-rc-18 npm run build:windows:portable
```

Temporary fallback (not recommended for release):

```bash
GRAPHONE_SKIP_WINDOWS_MANIFEST=1 npm run build:windows:portable
```

---

## Windows build fails with "makensis.exe: No such file or directory"

**This error is expected if NSIS is not installed.** The good news is that the `.exe` file is still built successfully! Only the installer creation fails.

**Quick Fix - Run without installer:**

```bash
# The exe is already built! Just run it:
npm run run:windows
```

**To install NSIS (for creating Windows installers):**

```bash
sudo apt install nsis
npm run build:windows  # Now creates both exe and installer
```

**Note:**

- MSI installers can only be created on Windows (requires WiX)
- NSIS installers (`-setup.exe`) can be created on Linux (requires `nsis` package)
- The standalone `.exe` works fine without any installer
- Use `npm run build:windows:exe` to build just the exe without bundling

---

## Windows app doesn't open / crashes immediately

**Most likely cause: Missing WebView2 Runtime**

Tauri apps require Microsoft Edge WebView2 Runtime to be installed on Windows.

**Check if WebView2 is installed:**

1. Open PowerShell on Windows
2. Run: `Get-ItemProperty -Path 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name 'pv' -ErrorAction SilentlyContinue`
3. If nothing is returned, WebView2 is not installed

**Install WebView2:**

- Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Or use the Evergreen Bootstrapper (recommended)

---

## "TaskDialogIndirect could not be located" Error

**RESOLVED:** This issue has been fixed by embedding a Windows application manifest.

The error occurred because the Windows executable needs an [application manifest](https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests) to enable Common Controls version 6+, which provides the `TaskDialogIndirect` API used by Tauri.

**Solution Applied:**

- Added `src-tauri/windows-app.manifest` with Common Controls v6 dependency
- Updated `build.rs` to use Tauri's native `WindowsAttributes.app_manifest()` API
- The manifest is now properly embedded during cross-compilation

**If you still encounter issues:**

- **Antivirus/Windows Defender**: The app might be blocked. Check Windows Defender history.
- **Missing sidecar**: Ensure `pi-agent-x86_64-pc-windows-msvc.exe` is in the same folder as `graphone.exe`
- **Run from CMD**: Open Command Prompt and run the exe to see detailed error messages

**Launch issues from Linux host interop:**

If you get "Windows cannot find..." errors when running `npm run run:windows`:

1. Manually navigate to `C:\Windows\Temp\graphone\` in Windows Explorer
2. Double-click `graphone.exe` to run it
3. Or open PowerShell and run: `C:\Windows\Temp\graphone\graphone.exe`

---

## Still having issues?

1. Check the [README.md](README.md) for setup and build instructions
2. Review [CONTRIBUTING.md](CONTRIBUTING.md) for repository conventions
3. Consult external resources:
   - **Tauri 2.0 Docs**: https://v2.tauri.app
   - **bun Documentation**: https://bun.sh/docs
   - **cargo-xwin**: https://github.com/rust-cross/cargo-xwin
