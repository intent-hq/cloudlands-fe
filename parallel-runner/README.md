# Parallel Agent Runner

A robust, production-ready system for running parallel agent workflows with automatic monitoring, error recovery, and comprehensive reporting.

## 🚀 Quick Start

```bash
# Run a simple parallel wave
./run examples/simple-wave.yaml

# Monitor progress in real-time
./monitor

# View results
./report
```

## 📁 Structure

```
parallel-runner/
├── run                      # Main entry point
├── monitor                  # Real-time monitoring dashboard
├── report                   # Generate reports from completed runs
├── lib/                     # Core implementation
│   ├── core/               # Core execution engine
│   ├── parser/             # YAML configuration parser
│   ├── orchestrator/       # Agent orchestration
│   ├── monitor/            # Monitoring components
│   └── utils/              # Shared utilities
├── examples/               # Example configurations
├── templates/              # Reusable prompt templates
├── docs/                   # Documentation
└── tests/                  # Test suite
```

## 🎯 Features

- **Parallel Execution**: Run multiple agents in parallel with configurable limits
- **Dependency Management**: Define dependencies between packages
- **Auto-Recovery**: Automatic retry on agent failures
- **Live Monitoring**: Real-time dashboard showing progress
- **Flexible Configuration**: YAML-based configuration with templates
- **Comprehensive Reporting**: Detailed reports with metrics and insights
- **Production Ready**: Robust error handling and logging

## 📝 Configuration

Create a YAML file defining your wave:

```yaml
title: 'Fix TypeScript Errors'
description: 'Fix all TypeScript compilation errors'

packages:
  - id: 'types'
    name: 'Fix Type Definitions'
    description: 'Fix all type definition errors'

  - id: 'imports'
    name: 'Fix Import Errors'
    description: 'Fix missing and incorrect imports'
    dependencies: ['types'] # Run after 'types' completes

# Configuration
config:
  max_parallel: 4
  timeout_minutes: 30
  auto_retry: true
  retry_attempts: 3
```

## 🔧 Advanced Usage

### Using Templates

```yaml
# Use predefined templates
templates:
  - 'typescript-fixes'
  - 'test-fixes'

# Or define custom prompts
prompts:
  - name: 'work'
    template: |
      Fix the following issues in {package_name}:
      {package_description}

      Rules:
      - Only modify files in src/
      - Run tests after making changes
```

### Monitoring Options

```bash
# Monitor with custom refresh rate
./monitor --refresh 2

# Monitor specific run
./monitor --run logs/run-20241118-123456

# Export metrics
./monitor --export metrics.json
```

### Generating Reports

```bash
# Generate HTML report
./report --format html

# Generate markdown report
./report --format markdown

# Compare multiple runs
./report --compare logs/run-1 logs/run-2
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --grep "parser"

# Run with coverage
npm run test:coverage
```

## 📚 Documentation

- [Configuration Guide](docs/configuration.md) - Detailed configuration options
- [Templates Guide](docs/templates.md) - Using and creating templates
- [Monitoring Guide](docs/monitoring.md) - Dashboard features and customization
- [API Reference](docs/api.md) - Programmatic usage
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT
