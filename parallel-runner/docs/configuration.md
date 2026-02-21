# Configuration Guide

## Overview

The Parallel Agent Runner uses YAML configuration files to define execution workflows. This guide covers all configuration options and best practices.

## Basic Structure

```yaml
# Required fields
title: 'Your Wave Title'
description: 'What this wave accomplishes'

# Package definitions
packages:
  - id: 'unique-id'
    name: 'Human-readable name'
    description: 'What this package does'
    dependencies: ['other-package-id'] # Optional

# Optional configuration
config:
  maxParallel: 4
  timeoutMinutes: 30
  # ... more options
```

## Required Fields

### `title` (string, required)

The title of your parallel execution wave.

### `description` (string, required)

A description of what this wave accomplishes.

### `packages` (array, required)

An array of package definitions. Each package must have:

- `id`: Unique identifier for the package
- `name`: Human-readable name
- `description`: What the package does

## Optional Fields

### `config` (object)

Configuration options for execution:

```yaml
config:
  maxParallel: 4 # Max agents running simultaneously (default: 4)
  timeoutMinutes: 30 # Timeout per agent in minutes (default: 30)
  autoRetry: true # Automatically retry failed agents (default: true)
  retryAttempts: 3 # Number of retry attempts (default: 3)
  continueOnError: false # Continue if packages fail (default: false)
  runTests: false # Run tests during consolidation (default: false)
```

### `model` (string)

The AI model to use:

```yaml
model: 'claude-3-5-sonnet-20241022' # Default
```

### `dependencies` (array)

Define execution order by specifying dependencies:

```yaml
packages:
  - id: 'task1'
    name: 'First Task'

  - id: 'task2'
    name: 'Second Task'
    dependencies: ['task1'] # Runs after task1 completes
```

### `templates` (array)

Use predefined templates:

```yaml
templates:
  - 'typescript-fixes'
  - 'test-fixes'
```

### `prompts` (array)

Define custom prompts for packages:

```yaml
prompts:
  - name: 'work'
    template: |
      Instructions for the agent:
      Package: {package_name}
      Description: {package_description}

      Your specific instructions here...
```

### `variables` (object)

Define custom variables for substitution:

```yaml
variables:
  workspace: 'src/'
  model_version: 'latest'

packages:
  - id: 'task1'
    description: 'Work in {workspace} directory'
```

### `consolidation` (boolean)

Enable post-execution consolidation:

```yaml
consolidation: true # Run TypeScript check and tests after completion
```

## Variable Substitution

The following variables are available in prompts:

- `{package_id}` - Package ID
- `{package_name}` - Package name
- `{package_description}` - Package description
- `{title}` - Wave title
- `{description}` - Wave description
- `{timestamp}` - Current timestamp
- `{date}` - Current date
- Custom variables defined in `variables` section

## Execution Waves

Packages are automatically organized into waves based on dependencies:

```yaml
packages:
  - id: 'a' # Wave 1
  - id: 'b' # Wave 1
  - id: 'c'
    dependencies: ['a', 'b'] # Wave 2
  - id: 'd'
    dependencies: ['c'] # Wave 3
```

## Best Practices

1. **Keep packages focused**: Each package should accomplish one specific task
2. **Use meaningful IDs**: Use descriptive IDs like `fix-imports` instead of `task1`
3. **Set appropriate timeouts**: Adjust based on package complexity
4. **Use templates**: Leverage templates for common patterns
5. **Document dependencies**: Clearly specify why dependencies exist
6. **Enable consolidation**: Always verify the final state

## Example Configurations

### Simple Parallel Execution

```yaml
title: 'Simple Tasks'
description: 'Run three tasks in parallel'

packages:
  - id: 'task1'
    name: 'Task One'
    description: 'First task'
  - id: 'task2'
    name: 'Task Two'
    description: 'Second task'
  - id: 'task3'
    name: 'Task Three'
    description: 'Third task'
```

### Complex with Dependencies

```yaml
title: 'Complex Workflow'
description: 'Multi-stage workflow with dependencies'

packages:
  - id: 'setup'
    name: 'Setup'
    description: 'Initial setup'

  - id: 'process-a'
    name: 'Process A'
    description: 'Process type A'
    dependencies: ['setup']

  - id: 'process-b'
    name: 'Process B'
    description: 'Process type B'
    dependencies: ['setup']

  - id: 'merge'
    name: 'Merge Results'
    description: 'Merge A and B'
    dependencies: ['process-a', 'process-b']

  - id: 'validate'
    name: 'Validate'
    description: 'Final validation'
    dependencies: ['merge']

config:
  maxParallel: 2
  continueOnError: false
```
