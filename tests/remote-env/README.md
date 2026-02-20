# Remote Environment Testing Infrastructure

This directory contains mock remote environments for testing the Intent app
against various SSH-based remote development setups.

## Overview

The Intent app supports remote development via SSH. This test infrastructure
provides configurable mock servers to validate functionality across different
remote environment configurations.

## Environment Profiles

### Standard (default)
- SSH on port 22
- Standard user configuration
- Full system persistence

### DevPod
- SSH on port 22022 (non-standard)
- Shared `augment` user
- Persistent home, ephemeral system
- Boot scripts in `~/.config/pod-init.d/`

### Minimal
- Bare-bones environment
- Limited tools installed
- Tests graceful degradation

## Quick Start

```bash
# Start with default (standard) profile
./start-remote-env.sh

# Start with DevPod profile
./start-remote-env.sh --profile devpod

# Run tests against running environment
npm run test:remote

# Run tests for specific profile
npm run test:remote -- --profile devpod

# Stop the environment
./stop-remote-env.sh
```

## Files

- `Dockerfile` - Configurable Docker image for remote environments
- `docker-compose.yml` - Compose file with multiple profiles
- `start-remote-env.sh` - Start script with profile selection
- `stop-remote-env.sh` - Stop and cleanup script
- `remote-env.test.ts` - Core SSH/environment tests
- `remote-git.test.ts` - Git operations tests
- `workspaces-app-integration.test.ts` - Intent app integration tests
- `remote-env-config.ts` - Configuration and profile definitions
- `run-remote-tests.ts` - Test orchestrator script

## Test Categories

1. **Connection** - Various ports, auth methods, reconnection
2. **Environment Detection** - OS, tools, paths, users
3. **File Operations** - Read, write, permissions, encoding
4. **Git Operations** - Clone, status, commit, push, pull
5. **Terminal/Shell** - Interactive sessions, PTY handling
6. **Edge Cases** - Network issues, timeouts, large files
