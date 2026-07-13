#!/bin/bash
# ssh-askpass-intent.sh - Native OS password dialog for SSH passphrase prompts
#
# Used as SSH_ASKPASS to collect passphrases via a GUI dialog instead of terminal.
# SSH passes the prompt text as the first argument.
#
# Usage:
#   SSH_ASKPASS=/path/to/ssh-askpass-intent.sh ssh-add ~/.ssh/id_ed25519

set -e

PROMPT="${1:-Enter passphrase:}"

# Detect platform and show native password dialog
case "$(uname -s)" in
  Darwin)
    # macOS: use osascript with hidden answer dialog
    # Sanitize prompt for AppleScript: escape backslashes and double quotes
    SAFE_PROMPT=$(printf '%s' "$PROMPT" | sed 's/\\/\\\\/g; s/"/\\"/g')
    PASSPHRASE=$(osascript -e "
      set dialogResult to display dialog \"$SAFE_PROMPT\" with title \"Intent — SSH\" default answer \"\" with hidden answer buttons {\"Cancel\", \"OK\"} default button \"OK\"
      return text returned of dialogResult
    " 2>/dev/null) || exit 1
    printf '%s' "$PASSPHRASE"
    ;;

  Linux)
    # Linux: try zenity, then kdialog, then ssh-askpass
    if command -v zenity >/dev/null 2>&1; then
      PASSPHRASE=$(zenity --password --title="Intent — SSH" --text="$PROMPT" 2>/dev/null) || exit 1
      printf '%s' "$PASSPHRASE"
    elif command -v kdialog >/dev/null 2>&1; then
      PASSPHRASE=$(kdialog --password "$PROMPT" --title "Intent — SSH" 2>/dev/null) || exit 1
      printf '%s' "$PASSPHRASE"
    elif command -v ssh-askpass >/dev/null 2>&1; then
      # Fall back to system ssh-askpass if available
      exec ssh-askpass "$PROMPT"
    else
      echo "Error: No GUI dialog tool found (zenity, kdialog, or ssh-askpass)" >&2
      exit 1
    fi
    ;;

  MINGW*|MSYS*|CYGWIN*)
    # Windows: use PowerShell input dialog
    # Pass prompt via environment variable to avoid quoting issues with single quotes
    export SSH_ASKPASS_PROMPT="$PROMPT"
    PASSPHRASE=$(powershell.exe -NoProfile -Command "
      Add-Type -AssemblyName Microsoft.VisualBasic
      \$result = [Microsoft.VisualBasic.Interaction]::InputBox(\$env:SSH_ASKPASS_PROMPT, 'Intent - SSH', '')
      if (\$result -eq '') { exit 1 }
      [Console]::Write(\$result)
    " 2>/dev/null) || exit 1
    printf '%s' "$PASSPHRASE"
    ;;

  *)
    echo "Error: Unsupported platform '$(uname -s)'" >&2
    exit 1
    ;;
esac

