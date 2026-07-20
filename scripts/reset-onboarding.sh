#!/usr/bin/env bash
# Reset Intent app to trigger onboarding flow.
# Usage:
#   ./scripts/reset-onboarding.sh          # reset (backup & clear)
#   ./scripts/reset-onboarding.sh restore  # restore from backup
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "Error: this script only supports macOS (detected: $(uname))" >&2
  exit 1
fi

WORKSPACE_DIR="$HOME/intent/workspaces"
LEGACY_DIR="$HOME/.workspaces"
APP_SUPPORT="$HOME/Library/Application Support/intent"
BACKUP_ROOT="$HOME/intent/.onboarding-reset-backup"

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[0;90m%s\033[0m\n' "$*"; }

backup_move() {
  local src="$1" dest="$2"
  if [ -d "$src" ] || [ -f "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    mv "$src" "$dest"
    dim "  moved $src → $dest"
  fi
}

restore_move() {
  local src="$1" dest="$2"
  if [ ! -e "$src" ]; then return; fi
  mkdir -p "$(dirname "$dest")"
  if [ -d "$src" ] && [ -d "$dest" ]; then
    # Target dir exists (app may have recreated it) — move contents in
    for item in "$src"/* "$src"/.*; do
      [ -e "$item" ] || continue
      local base="$(basename "$item")"
      case "$base" in .|..) continue;; esac
      # If both are directories, remove the (app-recreated) target first
      if [ -d "$item" ] && [ -d "$dest/$base" ]; then
        rm -rf "$dest/$base"
      fi
      mv -f "$item" "$dest/"
    done
    rmdir "$src" 2>/dev/null || true
  else
    mv "$src" "$dest"
  fi
  dim "  restored $dest"
}

do_reset() {
  # Guard: don't overwrite existing backup
  if [ -d "$BACKUP_ROOT" ]; then
    red "Backup already exists at $BACKUP_ROOT"
    red "Run '$0 restore' first, or remove it manually."
    exit 1
  fi

  # Check app is not running (packaged or dev)
  if pgrep -f "Intent.app/Contents/MacOS/Intent" >/dev/null 2>&1 \
    || pgrep -f "Electron.*intent" >/dev/null 2>&1 \
    || pgrep -f "electron.*intent" >/dev/null 2>&1 \
    || pgrep -f "dev:electron" >/dev/null 2>&1; then
    red "Intent appears to be running. Quit it first."
    exit 1
  fi

  echo "Resetting Intent to trigger onboarding..."
  mkdir -p "$BACKUP_ROOT"

  # 1. Move workspaces
  backup_move "$WORKSPACE_DIR" "$BACKUP_ROOT/workspaces"
  backup_move "$LEGACY_DIR"    "$BACKUP_ROOT/.workspaces"

  # 2. Move electron localStorage (leveldb)
  backup_move "$APP_SUPPORT/Local Storage" "$BACKUP_ROOT/Local Storage"

  # 3. Move electron-store configs
  for f in config.json settings.json repo-registry.json; do
    backup_move "$APP_SUPPORT/$f" "$BACKUP_ROOT/$f"
  done

  # 4. Move session/index storage
  backup_move "$APP_SUPPORT/Session Storage" "$BACKUP_ROOT/Session Storage"
  backup_move "$APP_SUPPORT/IndexedDB"       "$BACKUP_ROOT/IndexedDB"

  green "✓ Reset complete. Backup at $BACKUP_ROOT"
  echo "  Start Intent to see onboarding flow."
  echo "  Run '$0 restore' to undo."
}

do_restore() {
  if [ ! -d "$BACKUP_ROOT" ]; then
    red "No backup found at $BACKUP_ROOT"
    exit 1
  fi

  if pgrep -f "Intent.app/Contents/MacOS/Intent" >/dev/null 2>&1 \
    || pgrep -f "Electron.*intent" >/dev/null 2>&1 \
    || pgrep -f "electron.*intent" >/dev/null 2>&1 \
    || pgrep -f "dev:electron" >/dev/null 2>&1; then
    red "Intent appears to be running. Quit it first."
    exit 1
  fi

  echo "Restoring from backup..."

  restore_move "$BACKUP_ROOT/workspaces"       "$WORKSPACE_DIR"
  restore_move "$BACKUP_ROOT/.workspaces"      "$LEGACY_DIR"
  restore_move "$BACKUP_ROOT/Local Storage"    "$APP_SUPPORT/Local Storage"
  restore_move "$BACKUP_ROOT/Session Storage"  "$APP_SUPPORT/Session Storage"
  restore_move "$BACKUP_ROOT/IndexedDB"        "$APP_SUPPORT/IndexedDB"

  for f in config.json settings.json repo-registry.json; do
    restore_move "$BACKUP_ROOT/$f" "$APP_SUPPORT/$f"
  done

  rmdir "$BACKUP_ROOT" 2>/dev/null || true
  green "✓ Restored. Start Intent normally."
}

case "${1:-reset}" in
  reset)   do_reset   ;;
  restore) do_restore ;;
  *)
    echo "Usage: $0 [reset|restore]"
    exit 1
    ;;
esac

