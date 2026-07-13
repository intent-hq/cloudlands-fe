# End-to-End (E2E) Tests

Comprehensive end-to-end testing suite for the Intent Electron application.

## Overview

This E2E test suite provides complete coverage of user workflows, multi-agent scenarios, error recovery, and performance testing. Tests are built using Playwright and designed to run against the actual Electron application.

## Test Suites

### 1. Complete User Workflows (`complete-user-workflows.e2e.ts`)

Tests full user journeys through the application:

- Workspace creation and management
- Agent creation and interaction
- Message sending and streaming
- Persistence and recovery
- Navigation between workspaces
- Workspace deletion

### 2. Multi-Agent Scenarios (`multi-agent-scenarios.e2e.ts`)

Tests complex multi-agent interactions:

- Concurrent agent creation
- Parallel message processing
- Agent coordination with shared context
- Switching between agents during streaming
- Resource management with many agents

### 3. Error Recovery (`error-recovery.e2e.ts`)

Tests application resilience and error handling:

- Agent process crash recovery
- Network disconnection handling
- Invalid input validation
- Corrupted state recovery
- Memory pressure management
- Rapid operation stress testing

### 4. Performance Under Load (`performance-load.e2e.ts`)

Tests performance characteristics:

- Agent creation performance with 50+ agents
- Message volume handling (100+ messages)
- Scroll performance with long conversations
- Concurrent operations efficiency
- Memory usage monitoring
- Performance metrics tracking
- File operations under load

### 5. UI Rendering (`agent-ui-rendering.e2e.ts`)

Tests UI rendering and streaming:

- Progressive message streaming
- Tool call visualization
- Flicker-free rendering
- Message persistence after refresh
- Scroll position maintenance
- IPC communication flow

## Running Tests

### Quick Start

```bash
# Install Playwright (first time only)
npm run test:e2e:install

# Run all E2E tests
npm run test:e2e

# Run with build
npm run test:e2e:build
```

### Individual Test Suites

```bash
# Complete workflows
npm run test:e2e:workflows

# Multi-agent scenarios
npm run test:e2e:multi-agent

# Error recovery
npm run test:e2e:error

# Performance tests
npm run test:e2e:performance

# UI rendering tests
npm run test:e2e:ui
```

### Debug Mode

```bash
# Run in debug mode with headed browser
npm run test:e2e:debug

# Debug specific suite
tsx e2e/run-e2e-tests.ts --suite multi-agent --debug --headed
```

### Advanced Options

```bash
# Run with custom options
tsx e2e/run-e2e-tests.ts [options]

Options:
  -s, --suite <name>    Test suite to run
  -b, --build           Build app before testing
  -c, --cleanup         Clean up test data (default: true)
  -d, --debug           Debug mode with slow motion
  -h, --headed          Show browser window
  -w, --workers <n>     Parallel workers (default: 1)
  -r, --retries <n>     Test retries (default: 1)
  -t, --timeout <ms>    Test timeout (default: 120000)
  -g, --grep <pattern>  Run tests matching pattern
```

## Test Helpers

The `test-helpers.ts` file provides utilities for:

- Launching the Electron app
- Creating workspaces and agents
- Sending messages
- Performance measurement
- Network simulation
- Error simulation
- Screenshot capture

Example usage:

```typescript
import { launchApp, createTestWorkspace, sendMessage } from './test-helpers';

test('example test', async () => {
  const { app, page } = await launchApp();
  await createTestWorkspace(page, 'Test', '/path/to/workspace');
  await sendMessage(page, 'Hello, world!');
  // ... test assertions
  await app.close();
});
```

## Performance Thresholds

Default performance thresholds:

- Agent creation: < 2 seconds
- Message response: < 1 second to start streaming
- Workspace load: < 5 seconds
- Max memory: < 500MB
- Max CPU: < 80%

## CI/CD Integration

Tests are configured to run in CI environments:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm ci

- name: Build application
  run: npm run build

- name: Install Playwright
  run: npx playwright install chromium

- name: Run E2E tests
  run: npm run test:e2e:ci
  env:
    CI: true
```

## Test Reports

Test results are generated in multiple formats:

- HTML report: `e2e-reports/html/index.html`
- JSON results: `e2e-reports/results.json`
- JUnit XML: `e2e-reports/junit.xml`
- Screenshots: `e2e-reports/screenshots/`
- Test artifacts: `e2e-reports/test-results/`

View HTML report:

```bash
open e2e-reports/html/index.html
```

## Troubleshooting

### Common Issues

1. **Electron not found**

   ```bash
   npm install
   npm run rebuild:electron
   ```

2. **Tests timing out**
   - Increase timeout: `--timeout 180000`
   - Check if app is building correctly: `npm run build`

3. **Permission errors**
   - Ensure test directories are writable
   - Run with appropriate permissions

4. **Memory issues**
   - Reduce parallel workers: `--workers 1`
   - Run suites individually

5. **Flaky tests**
   - Increase retries: `--retries 2`
   - Add wait conditions in tests

## Best Practices

1. **Test Isolation**
   - Each test should be independent
   - Clean up resources after tests
   - Use unique workspace names

2. **Assertions**
   - Use specific selectors with `data-testid`
   - Add appropriate timeouts
   - Verify both positive and negative cases

3. **Performance**
   - Monitor test execution time
   - Use parallel execution wisely
   - Cache build artifacts in CI

4. **Debugging**
   - Use `--debug` flag for slow motion
   - Take screenshots on failure
   - Check test reports for details

## Contributing

When adding new E2E tests:

1. Choose appropriate test suite file
2. Use test helpers for common operations
3. Follow existing patterns and conventions
4. Add data-testid attributes to UI elements
5. Document complex test scenarios
6. Ensure tests are reliable and not flaky

## Test Coverage Goals

- **User Workflows**: 100% of critical paths
- **Error Scenarios**: All major error conditions
- **Performance**: Key performance indicators
- **Multi-Agent**: Concurrent operation limits
- **UI Rendering**: Streaming and real-time updates

## Metrics and Monitoring

The test suite tracks:

- Test execution time
- Memory usage patterns
- CPU utilization
- Network request counts
- Error recovery times
- Performance degradation

Results are available in the test summary report generated after each run.
