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
WIN_TEMP_EXE="${WIN_TEMP_DIR}/${EXE_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  Graphone Windows Launcher (WSL2)"
echo "=========================================="

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

# Copy to Windows temp for execution
echo "Copying to Windows temp directory..."
cp "$EXE_PATH" "$WIN_TEMP_EXE"
echo -e "${GREEN}Copied to:${NC} C:\\Windows\\Temp\\${EXE_NAME}"
echo ""

# Also copy sidecar binary if it exists
SIDECAR_NAME="pi-agent-${TARGET_TRIPLE}.exe"
SIDECAR_SOURCE="src-tauri/binaries/${SIDECAR_NAME}"
SIDECAR_DEST="${WIN_TEMP_DIR}/${SIDECAR_NAME}"

if [ -f "$SIDECAR_SOURCE" ]; then
    echo "Copying sidecar binary..."
    cp "$SIDECAR_SOURCE" "$SIDECAR_DEST"
    echo -e "${GREEN}Copied sidecar:${NC} ${SIDECAR_NAME}"
    echo ""
else
    echo -e "${YELLOW}WARNING: Sidecar binary not found at:${NC}"
    echo "  ${SIDECAR_SOURCE}"
    echo "The app may not work correctly without the sidecar."
    echo ""
fi

# Launch the application
echo -e "${GREEN}Starting Windows app...${NC}"
echo ""
cmd.exe /c start "" "C:\\Windows\\Temp\\${EXE_NAME}"

echo -e "${GREEN}App launched!${NC}"
echo ""
echo "Note: The app is running from C:\\Windows\\Temp\\"

if [ -n "$NO_BUNDLE" ]; then
    echo ""
    echo -e "${YELLOW}Note: To create Windows installers (.exe), install NSIS:${NC}"
    echo "  sudo apt install nsis"
    echo "  npm run build:windows"
else
    echo "Installers are available at:"
    echo "  src-tauri/target/${TARGET_TRIPLE}/release/bundle/"
fi
