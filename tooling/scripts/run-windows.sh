#!/bin/bash
# Run Windows build from WSL2
# This script builds (if needed), stages a portable runtime folder, and launches graphone.exe on Windows.

set -euo pipefail

# Source cargo environment
source ~/.cargo/env

# Configuration
EXE_NAME="graphone.exe"
TARGET_TRIPLE="x86_64-pc-windows-msvc"
BUILD_DIR="src-tauri/target/${TARGET_TRIPLE}/release"
EXE_PATH="${BUILD_DIR}/${EXE_NAME}"
PORTABLE_DIR="${BUILD_DIR}/portable"
WIN_TEMP_DIR="/mnt/c/Windows/Temp"
WIN_APP_DIR="${WIN_TEMP_DIR}/graphone"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  Graphone Windows Launcher (WSL2)"
echo "=========================================="
echo ""

# Build only if missing (no bundle required for direct exe launch)
if [ ! -f "$EXE_PATH" ]; then
  echo -e "${YELLOW}Windows build not found at:${NC}"
  echo "  $EXE_PATH"
  echo ""
  echo -e "${YELLOW}Building Windows .exe now...${NC}"
  echo "This may take a few minutes..."
  echo ""

  cargo tauri build --target "$TARGET_TRIPLE" --runner cargo-xwin --no-bundle

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

# Stage portable runtime (graphone + sidecar + sidecar assets)
echo "Staging portable runtime..."
bash tooling/scripts/stage-windows-portable.sh "$TARGET_TRIPLE"

if [ ! -f "${PORTABLE_DIR}/graphone.exe" ]; then
  echo -e "${RED}Portable runtime staging failed (graphone.exe missing).${NC}"
  exit 1
fi

if [ ! -f "${PORTABLE_DIR}/pi-agent.exe" ]; then
  echo -e "${RED}Portable runtime staging failed (pi-agent.exe missing).${NC}"
  exit 1
fi

# Copy portable folder to Windows temp
echo "Copying portable runtime to Windows temp..."
mkdir -p "$WIN_APP_DIR"
rm -rf "${WIN_APP_DIR:?}"/*
cp -R "${PORTABLE_DIR}"/. "$WIN_APP_DIR/"

echo -e "${GREEN}Copied app to:${NC} C:\\Windows\\Temp\\graphone"
echo ""

# Launch the application
echo -e "${GREEN}Starting Windows app...${NC}"
echo ""
echo "If the app doesn't open, check:"
echo "  1. WebView2 Runtime is installed on Windows"
echo "  2. Windows Defender/antivirus isn't blocking it"
echo "  3. Run directly: C:\\Windows\\Temp\\graphone\\graphone.exe"
echo ""

WIN_PATH=$(wslpath -w "$WIN_APP_DIR")
powershell.exe -Command "Start-Process -FilePath '$WIN_PATH\\graphone.exe' -WorkingDirectory '$WIN_PATH'"

echo -e "${GREEN}App launched!${NC}"
