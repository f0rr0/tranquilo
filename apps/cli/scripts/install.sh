#!/usr/bin/env sh
set -eu

DEFAULT_BASE_URL="https://tranquilo-ai.vercel.app/releases/latest"
BASE_URL="${TRANQUILO_INSTALL_BASE:-$DEFAULT_BASE_URL}"
BIN_DIR="${TRANQUILO_BIN_DIR:-$HOME/.local/bin}"
PR_MAC_ONLY="${TRANQUILO_PR_MAC_ONLY:-0}"
AGENT_TARGET="${TRANQUILO_INSTALL_AGENT_TARGET:-auto}"
SKIP_AGENT_INSTALL="${TRANQUILO_SKIP_AGENT_INSTALL:-0}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
  Darwin)
    os="darwin"
    binary="tranquilo"
    DEFAULT_PACKAGE_ROOT="$HOME/Library/Application Support/tranquilo/package"
    ;;
  Linux)
    os="linux"
    binary="tranquilo"
    DEFAULT_PACKAGE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/tranquilo/package"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    os="win32"
    binary="tranquilo.exe"
    DEFAULT_PACKAGE_ROOT="$HOME/AppData/Local/Tranquilo/package"
    ;;
  *) echo "Unsupported OS: $uname_s" >&2; exit 1 ;;
esac
PACKAGE_ROOT="${TRANQUILO_PACKAGE_ROOT:-$DEFAULT_PACKAGE_ROOT}"

if [ "$PR_MAC_ONLY" = "1" ] && [ "$os" != "darwin" ]; then
  echo "PR preview installs only support macOS. Use a main release for Linux or Windows." >&2
  exit 1
fi

case "$uname_m" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $uname_m" >&2; exit 1 ;;
esac

if [ "$os" = "win32" ]; then
  archive="tranquilo-win32-${arch}.zip"
else
  archive="tranquilo-${os}-${arch}.tar.gz"
fi
url="${BASE_URL}/${archive}"
checksum_url="${BASE_URL}/checksums.txt"

mkdir -p "$BIN_DIR"
echo "Downloading $url"
curl -fsSL "$url" -o "$TMP_DIR/$archive"

curl -fsSL "$checksum_url" -o "$TMP_DIR/checksums.txt"
expected="$(grep "  $archive\$" "$TMP_DIR/checksums.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then
  echo "Checksum entry missing for $archive" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TMP_DIR/$archive" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$TMP_DIR/$archive" | awk '{print $1}')"
fi
if [ "$expected" != "$actual" ]; then
  echo "Checksum mismatch for $archive" >&2
  exit 1
fi

if [ "$os" = "win32" ]; then
  if ! command -v unzip >/dev/null 2>&1; then
    echo "Windows bash install requires unzip. Install unzip and rerun this command." >&2
    exit 1
  fi
  unzip -q "$TMP_DIR/$archive" -d "$TMP_DIR"
else
  tar -xzf "$TMP_DIR/$archive" -C "$TMP_DIR"
fi
if command -v install >/dev/null 2>&1; then
  install -m 0755 "$TMP_DIR/$binary" "$BIN_DIR/$binary"
else
  cp "$TMP_DIR/$binary" "$BIN_DIR/$binary"
  chmod 0755 "$BIN_DIR/$binary"
fi
mkdir -p "$PACKAGE_ROOT"
rm -rf "$PACKAGE_ROOT/assets" "$PACKAGE_ROOT/mcpb"
cp -R "$TMP_DIR/assets" "$PACKAGE_ROOT/assets"
cp -R "$TMP_DIR/mcpb" "$PACKAGE_ROOT/mcpb"

installed="$BIN_DIR/$binary"
echo "Installed tranquilo to $installed"
if ! command -v tranquilo >/dev/null 2>&1 && ! command -v tranquilo.exe >/dev/null 2>&1; then
  echo "Add $BIN_DIR to PATH to use tranquilo from any shell."
fi

"$installed" doctor || true
if [ "$SKIP_AGENT_INSTALL" != "1" ]; then
  echo "Configuring AI integrations ($AGENT_TARGET)"
  TRANQUILO_PACKAGE_ROOT="$PACKAGE_ROOT" TRANQUILO_MCP_COMMAND="$installed" "$installed" install-agent "$AGENT_TARGET" || {
    echo "AI integration setup was skipped or failed. You can retry with: $installed install-agent auto" >&2
  }
fi
