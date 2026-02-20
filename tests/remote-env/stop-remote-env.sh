#!/bin/bash
# Stop remote environment test server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Stopping remote environment test server..."

# Stop all profiles
docker compose --profile all down

echo "Done."
