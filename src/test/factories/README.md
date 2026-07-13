# Test Factories

Comprehensive test data creation utilities for consistent and maintainable test setup.

## Overview

The test factories provide:

- **Factory Functions**: Simple functions to create test entities with sensible defaults
- **Builder Patterns**: Fluent APIs for creating complex test scenarios
- **Scenario Factories**: Pre-configured test scenarios for common use cases
- **ID/Name Generators**: Utilities for creating test identifiers and names

## Quick Start

### Basic Factory Functions

```typescript
import { createTestAgent, createTestMessage } from '$test/factories';

// Create a test agent with defaults
const agent = createTestAgent();

// Create with overrides
const customAgent = createTestAgent({
  name: 'My Agent',
  status: AgentStatus.Error,
});

// Create a test message
const message = createTestMessage({
  role: 'assistant',
  content: 'Hello!',
});
```

### Builder Patterns

```typescript
import { AgentBuilder, MessageBuilder } from '$test/factories';

// Build complex agents
const agent = new AgentBuilder()
  .withName('Complex Agent')
  .withMessages(5)
  .asInitialAgent()
  .streaming()
  .build();

// Build complex messages
const message = new MessageBuilder()
  .withRole('assistant')
  .withContentBlocks(2)
  .withMetadata({ model: 'gpt-4' })
  .build();
```

### Scenario Factories

```typescript
import {
  createAgentWithConversation,
  createErrorAgent,
  createStreamingAgent,
} from '$test/factories';

// Pre-configured scenarios
const agent = createAgentWithConversation(10); // 10 messages
const errorAgent = createErrorAgent();
const streamingAgent = createStreamingAgent();
```

## API Reference

### Agent Factory Functions

- `createTestAgent(overrides?)` - Create a test agent
- `createTestMessage(overrides?)` - Create a test message
- `createTestContentBlock(overrides?)` - Create a text content block
- `createTestToolUseBlock(overrides?)` - Create a tool use block
- `createTestToolResultBlock(overrides?)` - Create a tool result block

### Builders

- `AgentBuilder` - Fluent builder for agents
- `MessageBuilder` - Fluent builder for messages

### Scenario Factories

- `createAgentWithConversation(count)` - Agent with message history
- `createErrorAgent()` - Agent in error state
- `createStreamingAgent()` - Agent currently streaming
- `createInitialAgent()` - Initial workspace agent
- `createBackgroundAgent()` - Background agent
- `createPendingAgent()` - Pending agent
- `createMultipleAgents(count)` - Multiple agents

### ID/Name Generators

- `createTestWorkspaceId()` - Generate workspace ID
- `createTestAgentId()` - Generate agent ID
- `createTestSessionId()` - Generate session ID
- `createTestMessageId()` - Generate message ID
- `createTestThreadId()` - Generate thread ID
- `createTestWorkspaceName()` - Generate workspace name
- `createTestFilePath()` - Generate file path
- `createTestDirectoryPath()` - Generate directory path

## Best Practices

1. **Use factories for consistency** - Always use factories instead of manually creating test data
2. **Override only what you need** - Use defaults and override specific properties
3. **Use builders for complex scenarios** - Chain builder methods for readability
4. **Use scenario factories for common patterns** - Reduces boilerplate
5. **Keep tests focused** - Create minimal test data needed for each test

## Testing

All factories are thoroughly tested:

```bash
npm run test:run -- src/test/factories/__tests__
```

Tests verify:

- Default values are correct
- Overrides work properly
- Unique IDs are generated
- Builder chaining works
- Scenario factories produce expected states
