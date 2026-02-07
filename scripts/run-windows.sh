#!/bin/bash
# Run Windows build from WSL2
# This script builds (if needed) and launches the Windows executable

set -e

# Source cargo environment
source ~/.cargo/env

# Configuration
EXE_NAME="graphone.exe"
TARGET_TRIPLE="x86_64-pc-windows-msvc"
BUILD_DIR="src-tauri/target/${TARGET_TRIPLE}/release"
EXE_PATH="${BUILD_DIR}/${EXE_NAME}"
WIN_TEMP_DIR="/mnt/c/Windows/Temp"
WIN_APP_DIR="${WIN_TEMP_DIR}/graphone"
WIN_TEMP_EXE="${WIN_APP_DIR}/${EXE_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  Graphone Windows Launcher (WSL2)"
echo "=========================================="
echo ""
echo -e "${YELLOW}NOTE:${NC} Cross-compiled Windows apps may have compatibility issues."
echo "If you see 'TaskDialogIndirect' errors, the app was built but"
echo "may not run correctly. For production releases, use GitHub Actions"
echo "or build natively on Windows."
echo ""

# Check if NSIS is installed (optional, but needed for bundling)
if ! command -v makensis &> /dev/null; then
    echo -e "${YELLOW}WARNING: NSIS is not installed!${NC}"
    echo "To create Windows installers, install NSIS:"
    echo "  sudo apt install nsis"
    echo ""
    echo "Continuing with --no-bundle flag (will only build .exe, no installer)..."
    echo ""
    NO_BUNDLE="--no-bundle"
else
    NO_BUNDLE=""
fi

# Check if Windows build exists
if [ ! -f "$EXE_PATH" ]; then
    echo -e "${YELLOW}Windows build not found at:${NC}"
    echo "  $EXE_PATH"
    echo ""
    echo -e "${YELLOW}Building Windows version now...${NC}"
    echo "This may take a few minutes..."
    echo ""
    
    # Build Windows version using cargo-xwin
    # Use --no-bundle if NSIS is not installed
    if [ -n "$NO_BUNDLE" ]; then
        echo -e "${YELLOW}Building without bundling (NSIS not installed)...${NC}"
        cargo tauri build --target "$TARGET_TRIPLE" --runner cargo-xwin --no-bundle
    else
        cargo tauri build --target "$TARGET_TRIPLE" --runner cargo-xwin
    fi
    
    if [ ! -f "$EXE_PATH" ]; then
        echo -e "${RED}Build failed! Exiting.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Build completed successfully!${NC}"
    echo ""
else
    echo -e "${GREEN}Found Windows build:${NC}"
    echo "  $EXE_PATH"
    echo ""
fi

# Create app directory in Windows temp
echo "Creating app directory in Windows temp..."
mkdir -p "$WIN_APP_DIR"

# Copy the executable
echo "Copying executable..."
cp "$EXE_PATH" "$WIN_TEMP_EXE"
echo -e "${GREEN}Copied exe to:${NC} C:\\Windows\\Temp\\graphone\\${EXE_NAME}"

# Copy all DLL files if they exist
if ls "${BUILD_DIR}"/*.dll 1> /dev/null 2>&1; then
    echo "Copying DLL files..."
    cp "${BUILD_DIR}"/*.dll "$WIN_APP_DIR/"
    echo -e "${GREEN}Copied DLL files${NC}"
fi

# Also copy sidecar binary if it exists
SIDECAR_NAME="pi-agent-${TARGET_TRIPLE}.exe"
SIDECAR_SOURCE="src-tauri/binaries/${SIDECAR_NAME}"
SIDECAR_DEST="${WIN_APP_DIR}/${SIDECAR_NAME}"

if [ -f "$SIDECAR_SOURCE" ]; then
    echo "Copying sidecar binary..."
    cp "$SIDECAR_SOURCE" "$SIDECAR_DEST"
    echo -e "${GREEN}Copied sidecar:${NC} ${SIDECAR_NAME}"
else
    echo -e "${YELLOW}WARNING: Sidecar binary not found at:${NC}"
    echo "  ${SIDECAR_SOURCE}"
    echo "The app may not work correctly without the sidecar."
fi

echo ""

# Launch the application
echo -e "${GREEN}Starting Windows app...${NC}"
echo ""
echo "Note: If the app doesn't open, check:"
echo "  1. WebView2 Runtime is installed on Windows"
echo "  2. Windows Defender/antivirus isn't blocking it"
echo "  3. Run directly: C:\\Windows\\Temp\\graphone\\graphone.exe"
echo ""

# Convert WSL path to Windows path and launch via PowerShell
WIN_PATH=$(wslpath -w "$WIN_APP_DIR")
powershell.exe -Command "Start-Process -FilePath '$WIN_PATH\\graphone.exe' -WorkingDirectory '$WIN_PATH'"

echo -e "${GREEN}App launched!${NC}"
echo ""

if [ -n "$NO_BUNDLE" ]; then
    echo -e "${YELLOW}Note: To create Windows installers (.exe), install NSIS:${NC}"
    echo "  sudo apt install nsis"
    echo "  npm run build:windows"
else
    echo "Installers are available at:"
    echo "  src-tauri/target/${TARGET_TRIPLE}/release/bundle/"
fi
