#!/bin/bash
# Start remote environment test server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default profile
PROFILE="standard"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile|-p)
            PROFILE="$2"
            shift 2
            ;;
        --all|-a)
            PROFILE="all"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --profile, -p PROFILE  Profile to use (standard, devpod, minimal, all)"
            echo "  --all, -a              Start all profiles"
            echo "  --help, -h             Show this help"
            echo ""
            echo "Profiles:"
            echo "  standard  - Standard SSH on port 2222 (maps to 22)"
            echo "  devpod    - DevPod-like on port 22022"
            echo "  minimal   - Minimal tools on port 2223"
            echo "  all       - Start all profiles"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "=== Remote Environment Test Server ==="
echo "Profile: $PROFILE"
echo ""

# Build and start
echo "Building container(s)..."
docker compose --profile "$PROFILE" build

echo ""
echo "Starting container(s)..."
docker compose --profile "$PROFILE" up -d

echo ""
echo "=== Connection Info ==="

case $PROFILE in
    standard)
        echo "Standard:  ssh -p 2222 testuser@localhost  (password: testuser)"
        ;;
    devpod)
        echo "DevPod:    ssh -p 22022 augment@localhost  (password: augment)"
        ;;
    minimal)
        echo "Minimal:   ssh -p 2223 minuser@localhost   (password: minuser)"
        ;;
    all)
        echo "Standard:  ssh -p 2222 testuser@localhost  (password: testuser)"
        echo "DevPod:    ssh -p 22022 augment@localhost  (password: augment)"
        echo "Minimal:   ssh -p 2223 minuser@localhost   (password: minuser)"
        ;;
esac

echo ""
echo "To run tests: npm run test:remote -- --profile $PROFILE"
echo "To stop:      ./stop-remote-env.sh"
