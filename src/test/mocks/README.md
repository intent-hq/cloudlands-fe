# Test Mocks

Comprehensive mock implementations for testing the agent system without external dependencies.

## Overview

This directory contains production-quality mock implementations of core services:

- **MockStreamManager** - Simulates streaming message accumulation
- **MockPersistenceService** - In-memory session and message storage
- **MockAgentService** - Agent lifecycle and message management
- **MockSessionRegistry** - Frontend-backend session mapping

## Quick Start

```typescript
import { createMockEnvironment, cleanupMockEnvironment } from '$test/mocks';

describe('My Test', () => {
  let env: ReturnType<typeof createMockEnvironment>;

  beforeEach(() => {
    env = createMockEnvironment();
  });

  afterEach(() => {
    cleanupMockEnvironment(env);
  });

  it('should work with mocks', async () => {
    // Use env.streaming, env.persistence, env.agentService, env.sessionRegistry
  });
});
```

## MockStreamManager

Simulates streaming message accumulation with event emission.

```typescript
const streamId = env.streaming.startStream('agent-1', 'session-1');
env.streaming.addChunk(streamId, 'Hello');
env.streaming.addChunk(streamId, ' World');
const message = await env.streaming.completeStream(streamId);
// message.content === "Hello World"
```

**Methods:**

- `startStream(agentId, sessionId): string` - Start a new stream
- `addChunk(streamId, text, delayMs?): void` - Add text chunk
- `addContentBlock(streamId, block): void` - Add content block
- `completeStream(streamId): Promise<AgentMessage>` - Complete stream
- `getStream(streamId): MockStreamSession | undefined` - Get stream state
- `getActiveStreams(): MockStreamSession[]` - Get active streams
- `clear(): void` - Clear all streams

**Events:**

- `stream:started` - Stream started
- `stream:chunk` - Chunk added
- `stream:content-block` - Content block added
- `stream:complete` - Stream completed

## MockPersistenceService

In-memory session and message storage with workspace scoping.

```typescript
const session = { id: "agent-1", sessionId: "session-1", ... };
await env.persistence.saveSession(session, "workspace-1");
const loaded = await env.persistence.loadSession("agent-1", "workspace-1");
```

**Methods:**

- `saveSession(session, workspaceId): Promise<void>`
- `loadSession(agentId, workspaceId): Promise<AgentSession | null>`
- `deleteSession(agentId, workspaceId): Promise<void>`
- `listSessions(workspaceId): Promise<AgentSession[]>`
- `saveMessage(message, sessionId): Promise<void>`
- `loadMessages(sessionId): Promise<AgentMessage[]>`
- `saveMetadata(key, data): Promise<void>`
- `loadMetadata(key): Promise<any>`
- `getSaveHistory()` - Get operation history
- `getLoadHistory()` - Get load history
- `clear(): void` - Clear all data

## MockAgentService

Agent lifecycle and message management.

```typescript
const agent = await env.agentService.createAgent({
  name: 'Test Agent',
  model: 'claude-opus',
});
await env.agentService.sendMessage(agent.id, 'Hello');
const messages = await env.agentService.getMessages(agent.id);
```

**Methods:**

- `createAgent(options?): Promise<AgentSession>`
- `getAgent(agentId): Promise<AgentSession | null>`
- `listAgents(workspaceId?): Promise<AgentSession[]>`
- `deleteAgent(agentId): Promise<void>`
- `sendMessage(agentId, content): Promise<AgentMessage>`
- `getMessages(agentId): Promise<AgentMessage[]>`
- `addMessage(agentId, message): Promise<void>`
- `getCallLog()` - Get method call history
- `clear(): void` - Clear all data

## MockSessionRegistry

Frontend-backend session mapping with status tracking.

```typescript
await env.sessionRegistry.registerSession('frontend-1', 'backend-1', 'workspace-1');
const backendId = await env.sessionRegistry.getBackendId('frontend-1');
```

**Methods:**

- `registerSession(frontendId, backendId, workspaceId, auggieProcessId?): Promise<void>`
- `getSession(frontendId): Promise<SessionMapping | null>`
- `getBackendId(frontendId): Promise<string | null>`
- `updateStatus(frontendId, status): Promise<void>`
- `listSessions(): Promise<SessionMapping[]>`
- `listSessionsForWorkspace(workspaceId): Promise<SessionMapping[]>`
- `deleteSession(frontendId): Promise<void>`
- `getCallLog()` - Get method call history
- `clear(): void` - Clear all data

## Integration Testing

Use `createMockEnvironment()` for complete integration tests:

```typescript
it('should handle complete workflow', async () => {
  const agent = await env.agentService.createAgent({ name: 'Agent' });
  await env.sessionRegistry.registerSession(agent.id, agent.sessionId, 'ws-1');

  const streamId = env.streaming.startStream(agent.id, agent.sessionId);
  env.streaming.addChunk(streamId, 'Response');
  const message = await env.streaming.completeStream(streamId);

  await env.persistence.saveMessage(message, agent.sessionId);
  const messages = await env.persistence.loadMessages(agent.sessionId);

  expect(messages).toHaveLength(1);
});
```

## Testing Patterns

### Verify Call History

```typescript
const log = env.agentService.getCallLog();
expect(log.some((l) => l.method === 'createAgent')).toBe(true);
```

### Test Error Scenarios

```typescript
const agent = await env.agentService.getAgent('non-existent');
expect(agent).toBeNull();
```

### Multi-Agent Scenarios

```typescript
const agent1 = await env.agentService.createAgent({ name: 'Agent 1' });
const agent2 = await env.agentService.createAgent({ name: 'Agent 2' });
const agents = await env.agentService.listAgents();
expect(agents).toHaveLength(2);
```

## Best Practices

1. **Always cleanup** - Use `cleanupMockEnvironment()` in afterEach
2. **Use factories** - Use `createMockEnvironment()` for consistency
3. **Check history** - Use call logs to verify method invocations
4. **Test edge cases** - Test with non-existent resources
5. **Verify state** - Check mock state after operations

## Files

- `streaming.mock.ts` - MockStreamManager implementation
- `persistence.mock.ts` - MockPersistenceService implementation
- `agent-service.mock.ts` - MockAgentService implementation
- `session-registry.mock.ts` - MockSessionRegistry implementation
- `index.ts` - Central exports and factories
- `__tests__/` - Comprehensive test suite (54 tests)
