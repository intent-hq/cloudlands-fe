# Developer Guide

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Git
- Auggie CLI (for agent functionality)

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev:cdp

# The app will be available at http://localhost:5177
```

### Development Commands

```bash
pnpm dev:cdp      # Start with Chrome DevTools Protocol
pnpm dev          # Start normal development server
pnpm build        # Build for production
pnpm preview      # Preview production build
npm run check     # Type checking (should show 0 errors)
pnpm lint         # Run ESLint
pnpm format       # Format with Prettier

# Testing
npx vitest run    # Run all tests (2500+ tests)
npx vitest        # Run tests in watch mode
```

## Project Structure

```
/
├── src/
│   ├── features/         # Feature modules
│   │   ├── agent/       # Agent management
│   │   ├── workspace/   # Workspace logic
│   │   ├── git/         # Git integration
│   │   ├── events/      # Event system
│   │   └── ...
│   ├── lib/
│   │   ├── components/  # UI components
│   │   │   ├── ui/     # Base UI components
│   │   │   └── ...     # Feature components
│   │   └── utils/      # Utility functions
│   ├── routes/         # SvelteKit routes
│   │   ├── +layout.svelte
│   │   ├── +page.svelte
│   │   └── workspace/
│   │       └── [id]/
│   └── shared/         # Shared types & constants
├── src/main/          # Electron main process
│   ├── index.ts       # Entry point — app lifecycle, IPC registration, event wiring
│   ├── state.ts       # Shared mutable state (mainWindow getter/setter)
│   ├── window.ts      # Window creation, session persistence, window helpers
│   └── utils/         # Pure utility functions
└── docs/              # Documentation
```

## Key Concepts

### 1. Agent System Architecture (v1.0.0)

The agent system uses a consolidated backend architecture:

```typescript
// ALWAYS use agentFactory for creation (guarantees user rules)
import { agentFactory } from '@/features/agent/agent-factory';
const agent = await agentFactory.createAgent(workspace, config);

// ConsolidatedBackendService handles all operations
import { consolidatedBackend } from '@/features/agent/services/consolidated-backend.service';
await consolidatedBackend.sendMessage(agentId, content);
```

**Critical Rule**: NEVER create agents directly via orchestrator. Always use `agentFactory.createAgent()`.

### 2. Workspace Management

Workspaces are the core organizational unit:

```typescript
interface Workspace {
  id: string;
  name: string;
  repositoryPath: string;
  branch: string;
  status: WorkspaceStatus;
  // ... other fields
}
```

### 3. State Management with Svelte 5

Using the new runes system for agent state:

```typescript
// Agent state management (agent-state.svelte.ts)
class AgentState {
  sessions = $state<Map<AgentId, AgentSession>>(new Map());
  streamingSessions = $state<Map<AgentId, StreamingState>>(new Map());

  // Derived values
  activeAgents = $derived(Array.from(this.sessions.values()));

  // Effects for auto-save
  $effect(() => {
    if (this.isDirty) {
      this.saveToStorage();
    }
  });
}
```

### 4. IPC Communication

Communication between renderer and main process uses typed channels:

```typescript
// Renderer side (via IPC client for agents)
import { ipcClient } from '@/features/agent/ipc-client';
const agent = await ipcClient.createAgent(workspace, config);

// Standard IPC for other operations
import { invoke } from '$lib/electron-bridge';
const result = await invoke('workspace:create', {
  name: 'My Workspace',
  path: '/path/to/repo',
});

// Main process handler (consolidated backend for agents)
ipcMain.handle('agent:create', async (event, data) => {
  return await consolidatedBackend.createAgent(data.workspace, data.config);
});

// Main process handler (standard operations)
ipcMain.handle('workspace:create', async (event, data) => {
  // Handle workspace creation
  return { success: true, workspace };
});
```

### 4. Agent Integration

Agents use the ACP (Agent Communication Protocol) with auggie:

```typescript
// Create an agent with specific model
const agent = await agentService.createAgent(workspace, {
  name: 'My Agent',
  model: 'haiku4.5', // Specify the model (e.g., haiku4.5, sonnet4.5, opus4.1)
  instruction: 'You are a helpful coding assistant',
  systemPrompt: 'Focus on clean, maintainable code',
  initialMessage: 'Help me refactor this function', // Optional initial message
});

// Send a message
await agentService.sendMessage(agent.id, 'Hello, agent!', workspace);
```

**Available Models:**

- `haiku4.5` - Claude Haiku 4.5 (fast, efficient)
- `sonnet4.5` - Claude Sonnet 4.5 (balanced)
- `opus4.1` - Claude Opus 4.1 (most capable)
- `gemini25-pro` - Gemini 2.5 Pro
- And more - check `auggie --help` for full list

## Best Practices

### 1. Memory Management

- Always dispose of resources in `onDestroy` or cleanup functions
- Use reference counting for shared state
- Implement cleanup intervals for long-running processes

### 2. Performance

- Use virtual scrolling for large lists
- Debounce user input and search operations
- Implement lazy loading for heavy components
- Use `untrack()` to prevent effect loops

### 3. Error Handling

- Always wrap async operations in try-catch
- Use the Logger class instead of console.log
- Provide user-friendly error messages
- Implement retry logic for network operations

### 4. Code Style

- Use TypeScript strict mode
- Follow the existing component structure
- Keep components focused and single-purpose
- Extract complex logic into services or utilities

## Testing

The app has comprehensive automated testing with 2400+ tests:

```bash
# Run all tests (completes in ~40 seconds)
npm run test:unit

# Run tests in watch mode (for development)
npm run test:unit:watch

# Run specific test file
npm run test:unit -- src/features/agent/__tests__/agent.test.ts

# Run tests matching a pattern
npm run test:unit -- --grep "agent creation"
```

### Test Structure

Tests are organized alongside their source files in `__tests__` directories:

```
src/features/agent/
├── agent.service.ts
├── __tests__/
│   ├── agent.test.ts
│   ├── session-resume-integration.test.ts
│   └── ...
```

### Writing Tests

Use Vitest with the following patterns:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MyFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', () => {
    expect(result).toBe(expected);
  });
});
```

### Manual Testing Checklist

For features not covered by automated tests:

- [ ] UI responsiveness and accessibility
- [ ] Memory leaks and performance
- [ ] Cross-platform behavior

## Debugging

### Chrome DevTools

The app runs with Chrome DevTools Protocol enabled:

- Open DevTools: Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows/Linux)
- Use the Console, Network, and Performance tabs
- Set breakpoints in source files

### Logging

Use the Logger class for structured logging:

```typescript
import { Logger } from '$shared/logger';

const logger = new Logger('MyComponent');
logger.info('Operation started', { data });
logger.error('Operation failed', error);
```

## Contributing

1. Create a feature branch from `main`
2. Make your changes following the code style
3. Test thoroughly
4. Submit a pull request with clear description
