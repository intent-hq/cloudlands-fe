# Monitoring Guide

## Overview

The Parallel Agent Runner includes a real-time web-based monitoring dashboard that provides live updates on execution progress, metrics, and package status.

## Starting the Monitor

### During Execution

The monitor starts automatically when you run a wave:

```bash
./run my-wave.yaml
# Monitor starts at http://localhost:3456
```

To disable automatic monitoring:

```bash
./run my-wave.yaml --no-monitor
```

### Standalone Monitor

Start the monitor independently to view past or ongoing runs:

```bash
# Monitor the latest run
./monitor

# Monitor a specific run
./monitor --run logs/run-20241118-123456

# Use a different port
./monitor --port 8080
```

## Dashboard Features

### Header Section
- **Title**: The wave title from configuration
- **Timer**: Live elapsed time counter

### Metrics Panel
Real-time metrics showing:
- **Total**: Total number of packages
- **Running**: Currently executing packages
- **Completed**: Successfully completed packages
- **Failed**: Failed packages
- **Pending**: Packages waiting to execute

### Progress Bar
Visual representation of overall completion percentage.

### Waves View
Shows execution waves with:
- Wave number
- Packages in each wave
- Wave status (pending/running/completed)

### Package List
Detailed view of all packages:
- Package name and ID
- Current status with color coding
- Wave assignment

## Status Colors

- **Blue**: Running
- **Green**: Completed
- **Red**: Failed
- **Gray**: Pending

## WebSocket Connection

The dashboard uses WebSocket for real-time updates:
- Initial `state` snapshot on connect
- Incremental `package_update` and `wave_update` messages
- Live updates without page refresh
- A 30-second ping/pong keepalive between the browser and server

## Keyboard Shortcuts

There are currently **no keyboard shortcuts implemented** in `parallel-runner/lib/monitor/monitor.js`. The monitor UI is mouse/browser-driven.

## Export Options

Export metrics for analysis from the standalone `./monitor` CLI:

```bash
# Export to JSON
./monitor --export metrics.json

# Continuous export (writes every 2 seconds by default)
./monitor --export metrics.json --refresh 2
```

`--export` writes `monitor.getMetrics()` to the specified file as pretty-printed JSON on a repeating interval. `--refresh` controls that export interval and defaults to `2` seconds. It does **not** change how often the dashboard UI redraws, which is driven by WebSocket updates plus the local 1-second timer.

## Customization

### Port Configuration

Set a custom port via environment variable:

```bash
export MONITOR_PORT=8080
./monitor
```

### Refresh Rate

Adjust the export polling interval used with `--export`:

```bash
./monitor --export metrics.json --refresh 1  # Write metrics every second
```

## Troubleshooting

### Monitor Won't Start

1. Check if port is already in use:
   ```bash
   lsof -i :3456
   ```

2. Try a different port:
   ```bash
   ./monitor --port 8081
   ```

### No Data Showing

1. Verify run directory exists:
   ```bash
   ls -la logs/
   ```

2. Check for state file:
   ```bash
   cat logs/run-*/state.json
   ```

### WebSocket Connection Failed

1. Check firewall settings
2. Verify WebSocket support in browser
3. Try a different browser

## Advanced Usage

### Multiple Monitors

Run multiple monitors for different runs:

```bash
# Terminal 1
./monitor --run logs/run-1 --port 3456

# Terminal 2
./monitor --run logs/run-2 --port 3457
```

### Remote Monitoring

To access the monitor from another machine:

1. Make the monitor port reachable from the remote machine.
2. Optionally set up an SSH tunnel:
   ```bash
   ssh -L 3456:localhost:3456 user@remote-host
   ```

### Integration with CI/CD

The monitor can be integrated into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run Parallel Agents
  run: |
    ./run my-wave.yaml &
    sleep 5
    curl http://localhost:3456/api/metrics
```

## API Endpoints

The monitor exposes REST API endpoints:

### GET /api/state
Returns complete execution state

### GET /api/packages
Returns all package information

### GET /api/metrics
Returns current metrics

Example:
```bash
curl http://localhost:3456/api/metrics | jq
```

## Best Practices

1. **Keep monitor running**: Leave it open during execution for real-time updates
2. **Use appropriate refresh rates**: Lower rates for long-running tasks
3. **Export metrics**: Save metrics for post-execution analysis
4. **Monitor resource usage**: Watch system resources during parallel execution
5. **Set up alerts**: Use the API to create custom alerts
