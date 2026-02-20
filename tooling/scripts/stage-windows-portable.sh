#!/bin/bash
# Stage a portable Windows runtime folder with graphone + pi-agent sidecar assets.
# Usage: bash tooling/scripts/stage-windows-portable.sh [target-triple] [profile]

set -euo pipefail

TARGET_TRIPLE="${1:-x86_64-pc-windows-msvc}"
PROFILE="${2:-release}"
BUILD_DIR="src-tauri/target/${TARGET_TRIPLE}/${PROFILE}"
BINARIES_DIR="src-tauri/binaries"
PORTABLE_DIR="${BUILD_DIR}/portable"

GRAPHONE_EXE="${BUILD_DIR}/graphone.exe"
GRAPHONE_PDB="${BUILD_DIR}/graphone.pdb"
SIDECAR_SUFFIXED="${BINARIES_DIR}/pi-agent-${TARGET_TRIPLE}.exe"
SIDECAR_FALLBACK="${BUILD_DIR}/pi-agent.exe"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ "$PROFILE" != "release" ] && [ "$PROFILE" != "debug" ]; then
  echo -e "${RED}Invalid profile: ${PROFILE}${NC}"
  echo "Profile must be one of: release, debug"
  exit 1
fi

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -e "$src" ]; then
    cp -R "$src" "$dst"
  fi
}

echo "=========================================="
echo "  Stage Windows Portable Runtime"
echo "=========================================="
echo "Target: ${TARGET_TRIPLE}"
echo "Profile: ${PROFILE}"
echo ""

if [ ! -f "$GRAPHONE_EXE" ]; then
  echo -e "${RED}Missing ${GRAPHONE_EXE}${NC}"
  if [ "$PROFILE" = "debug" ]; then
    echo "Run: npm run build:windows:debug:exe"
  else
    echo "Run: npm run build:windows:exe"
  fi
  exit 1
fi

if [ ! -f "${BINARIES_DIR}/package.json" ]; then
  echo -e "${RED}Missing ${BINARIES_DIR}/package.json${NC}"
  if [ "$PROFILE" = "debug" ]; then
    echo "The sidecar runtime assets were not staged. Rebuild with: npm run build:windows:debug:exe"
  else
    echo "The sidecar runtime assets were not staged. Rebuild with: npm run build:windows:exe"
  fi
  exit 1
fi

SIDECAR_SOURCE=""
if [ -f "$SIDECAR_SUFFIXED" ]; then
  SIDECAR_SOURCE="$SIDECAR_SUFFIXED"
elif [ -f "$SIDECAR_FALLBACK" ]; then
  SIDECAR_SOURCE="$SIDECAR_FALLBACK"
else
  echo -e "${RED}Sidecar binary not found${NC}"
  echo "Expected one of:"
  echo "  ${SIDECAR_SUFFIXED}"
  echo "  ${SIDECAR_FALLBACK}"
  exit 1
fi

rm -rf "$PORTABLE_DIR"
mkdir -p "$PORTABLE_DIR"

# Main app
cp "$GRAPHONE_EXE" "$PORTABLE_DIR/graphone.exe"
copy_if_exists "$GRAPHONE_PDB" "$PORTABLE_DIR/"

# Sidecar binary normalized to runtime name expected by Tauri shell sidecar("pi-agent")
cp "$SIDECAR_SOURCE" "$PORTABLE_DIR/pi-agent.exe"

# Sidecar runtime files (required + helpful assets)
copy_if_exists "${BINARIES_DIR}/package.json" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/README.md" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/CHANGELOG.md" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/photon_rs_bg.wasm" "$PORTABLE_DIR/"

copy_if_exists "${BINARIES_DIR}/theme" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/export-html" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/docs" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/examples" "$PORTABLE_DIR/"
copy_if_exists "${BINARIES_DIR}/node_modules" "$PORTABLE_DIR/"

# Any runtime DLLs produced for graphone
shopt -s nullglob
for dll in "${BUILD_DIR}"/*.dll; do
  cp "$dll" "$PORTABLE_DIR/"
done
shopt -u nullglob

echo -e "${GREEN}Portable runtime staged at:${NC} ${PORTABLE_DIR}"
echo "Copy this folder to Windows and run graphone.exe from inside it."
