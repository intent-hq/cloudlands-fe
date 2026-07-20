# MCP (Model Context Protocol) System

## Overview

The MCP system enables AI agents to interact with workspace resources through a standardized protocol. It provides process isolation, type safety, and real-time event synchronization.

## Architecture

```
┌─────────────┐     IPC      ┌─────────────┐
│   Renderer  │◄────────────►│  Main Process│
└─────────────┘               └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │   MCP Hub   │
                              └──────┬──────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
         ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
         │  Workspace  │     │    Notes    │     │   Git/FS    │
         │   Server    │     │   Server    │     │   Server    │
         └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
                │                    │                    │
         ┌──────▼──────────────────▼──────────────────▼──────┐
         │                   MCP Bridge                       │
         └──────┬──────────────────┬──────────────────┬──────┘
                │                  │                  │
         ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
         │  Workspace  │    │    Notes    │    │     Git     │
         │   Service   │    │   Service   │    │   Service   │
         └─────────────┘    └─────────────┘    └─────────────┘
```

## Quick Start

### Using MCP Tools from the Renderer

```typescript
// Call a tool
const result = await window.api.mcp.callTool({
  workspaceId: 'my-workspace',
  toolName: 'notes.create',
  arguments: {
    title: 'Meeting Notes',
    content: "# Today's Meeting\n\n- Item 1\n- Item 2",
    tags: ['meeting', 'important'],
  },
});

// List available tools
const tools = await window.api.mcp.listTools('my-workspace');

// Get MCP status
const status = await window.api.mcp.getStatus();
```

### Available Tools

| Tool                        | Description                | Status             |
| --------------------------- | -------------------------- | ------------------ |
| `workspace.get`             | Get workspace information  | ✅ Working         |
| `workspace.update`          | Update workspace title     | ✅ Working         |
| `workspace.listSessions`    | List agent sessions        | ⚠️ Stubbed         |
| `workspace.createSession`   | Create agent session       | ⚠️ Stubbed         |
| `notes.list`                | List all notes             | ✅ Working         |
| `notes.get`                 | Get a specific note        | ✅ Working         |
| `notes.create`              | Create a note              | ✅ Working         |
| `notes.update`              | Update note content        | ✅ Working         |
| `notes.addComment`          | Add comment to note        | ✅ Working         |
| `notes.listComments`        | List comments for a note   | ✅ Working         |
| `notes.suggestChange`       | Suggest a change to a note | ✅ Working         |
| `notes.updateCommentStatus` | Update comment status      | ✅ Working         |
| `notes.delete`              | Delete a note              | ✅ Working         |
| `git.status`                | Get git status             | ✅ Working         |
| `git.diff`                  | Get file diffs             | ✅ Working         |
| `git.commit`                | Commit changes             | ✅ Working         |
| `git.branch`                | Branch operations          | ✅ Working         |
| `fs.read`                   | Read files                 | ❌ Not implemented |
| `fs.write`                  | Write files                | ❌ Not implemented |
| `fs.applyPatch`             | Apply patches              | ❌ Not implemented |

## Development

### Adding a New MCP Server

1. Create a new server directory:

```bash
mkdir src/features/mcp/servers/myserver
```

2. Create the server implementation:

```typescript
// src/features/mcp/servers/myserver/index.ts
import { BaseMcpServer } from '../base-server';

export class MyServerMcpServer extends BaseMcpServer {
  protected async initialize(): Promise<void> {
    this.registerTool({
      name: 'myserver.action',
      description: 'Perform an action',
      inputSchema: MyActionSchema,
    });
  }

  protected async handleToolCall(toolName: string, params: any): Promise<any> {
    // Handle the tool call
    return { success: true };
  }
}
```

3. Add schemas for your tools:

```typescript
// src/features/mcp/types/schemas.ts
export const MyActionSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  // ... other parameters
});
```

4. Update the bridge to handle your tools:

```typescript
// src/features/mcp/bridge/mcp-bridge.ts
case 'myserver.action':
  response = await this.handleMyAction(params, context);
  break;
```

### Testing

Run the MCP system in development:

```bash
npm run dev
```

Test tool calls from the browser console:

```javascript
// Open developer tools in the Electron app
await window.api.mcp.callTool({
  workspaceId: 'test-workspace',
  toolName: 'workspace.get',
  arguments: {},
});
```

## Troubleshooting

### Common Issues

1. **Server fails to start**
   - Check logs in the console for spawn errors
   - Ensure TypeScript is compiled (`npm run build:main`)
   - Verify server file exists in `dist/features/mcp/servers/`

2. **Tool call fails**
   - Check that the workspace exists
   - Verify tool name is correct
   - Check bridge implementation for the tool

3. **Events not updating UI**
   - Ensure mainWindow is passed to setupMCPIPC
   - Check that events are being emitted from bridge
   - Verify renderer is listening for events

### Debug Logging

Enable debug logging by setting environment variable:

```bash
DEBUG=mcp:* npm run dev
```

## Implementation Status

### ✅ Complete

- Core hub architecture
- Process management with restart
- Health monitoring
- Bridge to services
- Basic tool implementations
- Event system
- IPC integration

### ⚠️ Partial/Stubbed

- Session management
- Note comments
- Version checking
- Idempotency store

### ❌ Not Implemented

- File system operations
- Git branch operations
- Advanced path validation
- Rate limiting
- Metrics collection

## Future Enhancements

1. **Additional Servers**
   - Spec server for specification management
   - Testing server for test execution
   - Search server for code search

2. **Production Hardening**
   - Comprehensive error recovery
   - Performance monitoring
   - Security auditing
   - Load testing

3. **Feature Completion**
   - Full session tracking
   - Comment threads on notes
   - Safe file operations
   - Optimistic concurrency control

## Contributing

When contributing to the MCP system:

1. Follow the existing patterns in `BaseMcpServer`
2. Add proper TypeScript types and Zod schemas
3. Emit appropriate events for UI updates
4. Handle errors gracefully
5. Add debug logging for troubleshooting
6. Update this README with new tools

## License

Part of the Intent project.
