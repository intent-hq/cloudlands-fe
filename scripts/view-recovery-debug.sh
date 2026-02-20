#!/bin/bash
# View recovery debug files
# Usage: ./scripts/view-recovery-debug.sh [latest|all|clean]

DEBUG_DIR="$HOME/.workspaces/recovery-debug"

case "$1" in
  latest)
    # Show the most recent debug file
    LATEST=$(ls -t "$DEBUG_DIR"/*.json 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
      echo "=== Latest Recovery Debug File ==="
      echo "File: $LATEST"
      echo ""
      cat "$LATEST" | jq '.'
    else
      echo "No debug files found in $DEBUG_DIR"
    fi
    ;;

  all)
    # List all debug files with summary
    echo "=== All Recovery Debug Files ==="
    echo "Directory: $DEBUG_DIR"
    echo ""

    if [ ! -d "$DEBUG_DIR" ]; then
      echo "Debug directory does not exist"
      exit 0
    fi

    COUNT=$(ls -1 "$DEBUG_DIR"/*.json 2>/dev/null | wc -l)
    echo "Total files: $COUNT"
    echo ""

    for file in "$DEBUG_DIR"/*.json; do
      if [ -f "$file" ]; then
        echo "---"
        echo "File: $(basename "$file")"
        cat "$file" | jq -r '
          "Timestamp: \(.timestamp)",
          "Note ID: \(.noteId)",
          "Comment ID: \(.commentId)",
          "Success: \(.success)",
          "Method: \(.method // "N/A")",
          "Confidence: \(.confidence // "N/A")",
          "Reason: \(.reason // "N/A")"
        '
        echo ""
      fi
    done
    ;;

  clean)
    # Remove all debug files
    if [ -d "$DEBUG_DIR" ]; then
      COUNT=$(ls -1 "$DEBUG_DIR"/*.json 2>/dev/null | wc -l)
      rm -f "$DEBUG_DIR"/*.json
      echo "Removed $COUNT debug files from $DEBUG_DIR"
    else
      echo "Debug directory does not exist"
    fi
    ;;

  *)
    # Default: show help and list files
    echo "Recovery Debug File Viewer"
    echo ""
    echo "Usage: $0 [latest|all|clean]"
    echo ""
    echo "Commands:"
    echo "  latest  - Show the most recent debug file (formatted)"
    echo "  all     - List all debug files with summaries"
    echo "  clean   - Remove all debug files"
    echo ""
    echo "Debug directory: $DEBUG_DIR"

    if [ -d "$DEBUG_DIR" ]; then
      COUNT=$(ls -1 "$DEBUG_DIR"/*.json 2>/dev/null | wc -l)
      echo "Current files: $COUNT"
    else
      echo "Debug directory does not exist yet"
    fi
    ;;
esac
