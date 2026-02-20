# Parallel Agent Runner - Quick Start Guide

## 🚀 Get Started in 2 Minutes

### 1. Install Dependencies
```bash
cd parallel-runner
npm install
```

### 2. Run Your First Wave
```bash
# Test with dry-run first
./run examples/simple-wave.yaml --dry-run

# Run for real
./run examples/simple-wave.yaml
```

### 3. Monitor Progress
Open another terminal:
```bash
./monitor
# Open browser to http://localhost:3456
```

## 📝 Create Your Own Configuration

Create `my-wave.yaml`:

```yaml
title: "My Parallel Tasks"
description: "Fix issues in my codebase"

packages:
  - id: "analyze"
    name: "Analyze Code"
    description: "Find all TypeScript errors"

  - id: "fix-errors"
    name: "Fix Errors"
    description: "Fix the TypeScript errors found"
    dependencies: ["analyze"]

  - id: "test"
    name: "Run Tests"
    description: "Verify all tests pass"
    dependencies: ["fix-errors"]

config:
  maxParallel: 2
  timeoutMinutes: 30
```

Run it:
```bash
./run my-wave.yaml
```

## 🎯 Common Use Cases

### TypeScript Error Fixes
```bash
./run examples/typescript-fixes.yaml
```

### Comprehensive Refactoring
```bash
./run examples/comprehensive-demo.yaml
```

### Custom Workflow
1. Copy an example
2. Modify packages and dependencies
3. Run with monitoring

## 🔧 Command-Line Options

### Execution Options
```bash
# Dry run - see plan without executing
./run config.yaml --dry-run

# Limit parallel execution
./run config.yaml --max-parallel 2

# Use different model
./run config.yaml --model claude-opus

# Disable auto-retry
./run config.yaml --no-retry

# Verbose logging
./run config.yaml --verbose
```

### Monitoring Options
```bash
# Monitor on different port
./monitor --port 8080

# Monitor specific run
./monitor --run logs/run-20241118-123456

# Export metrics
./monitor --export metrics.json
```

### Report Generation
```bash
# Generate report for latest run
./report --latest

# Compare runs
./report --compare logs/run-1 logs/run-2

# Export as HTML
./report --format html --output report.html
```

## 📊 Understanding the Dashboard

The monitoring dashboard shows:
- **Header**: Title, timer, status
- **Metrics**: Total/Running/Completed/Failed/Pending counts
- **Progress Bar**: Visual completion percentage
- **Waves**: Execution waves with package groupings
- **Package List**: Detailed status for each package

Status colors:
- 🔵 Blue = Running
- 🟢 Green = Completed
- 🔴 Red = Failed
- ⚪ Gray = Pending

## 🆘 Troubleshooting

### Agent Not Found
```bash
# Ensure auggie is installed and in PATH
which auggie
```

### Port Already in Use
```bash
# Use different port
./monitor --port 8081
```

### Configuration Errors
```bash
# Validate configuration
./run my-wave.yaml --dry-run
```

## 📚 Learn More

- [Configuration Guide](docs/configuration.md)
- [Monitoring Guide](docs/monitoring.md)
- [Troubleshooting Guide](docs/troubleshooting.md)
- [Examples](examples/)

## 💡 Tips

1. **Start Small**: Test with simple configurations first
2. **Use Dry Run**: Always dry-run new configurations
3. **Monitor Progress**: Keep dashboard open during execution
4. **Check Logs**: Review logs in `logs/` directory
5. **Iterate**: Refine your configuration based on results

Ready to parallelize your agent workflows! 🎉
