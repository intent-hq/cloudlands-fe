# Agent Client Protocol (ACP) Implementation

This is the official Agent Client Protocol (ACP) implementation following the specification from https://agentclientprotocol.com.

## Implementation Status

- ✅ **Core Protocol**: Complete JSON-RPC 2.0 implementation
- ✅ **Session Management**: Full lifecycle support
- ✅ **File System Handlers**: Read/write with security checks
- ✅ **Terminal Handlers**: Command execution support
- ✅ **Protocol Adapter Integration**: Fully integrated
- ✅ **ACP Provider**: Complete implementation for agent connections
- 🚧 **Testing**: Pending real agent testing
- 🚧 **Client Implementation**: TODO

## Overview

The Agent Client Protocol (ACP) standardizes communication between code editors/IDEs and coding agents. It uses JSON-RPC 2.0 over stdio for communication.

## Key Features

This implementation:

1. **Follows Official Spec**: Implements the exact methods and types from agentclientprotocol.com
2. **JSON-RPC 2.0**: Uses proper JSON-RPC 2.0 message format
3. **Session Lifecycle**: Implements the correct flow: initialize → authenticate → session/new → session/prompt
4. **Standard Methods**: Uses the official method names and signatures

## Architecture

```
acp-official/
├── README.md                 # This file
├── index.ts                  # Main exports
├── types/                    # TypeScript types matching ACP schema
│   ├── base.ts              # Base types (Role, SessionId, etc.)
│   ├── content.ts           # Content types (ContentBlock, etc.)
│   └── protocol.ts          # Protocol messages
├── server/                   # ACP Server implementation
│   ├── acp-server.ts        # Main server class
│   ├── session-manager.ts   # Session management
│   └── handlers/            # Method handlers
│       ├── file-system.ts
│       └── terminal.ts
├── client/                   # ACP Client implementation (TODO)
│   ├── acp-client.ts        # Main client class
│   └── stdio-transport.ts   # STDIO transport layer
└── __tests__/               # Tests (TODO)
```

## Protocol Flow

### 1. Initialization Phase

```typescript
// Client → Agent
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "Intent",
      "version": "1.0.0"
    }
  },
  "id": 1
}

// Agent → Client
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "Augment Agent",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": true,
      "fileSystem": true,
      "terminal": true
    }
  },
  "id": 1
}
```

### 2. Session Setup

```typescript
// Client → Agent
{
  "jsonrpc": "2.0",
  "method": "session/new",
  "params": {
    "metadata": {
      "workspaceId": "abc-123",
      "workspacePath": "/path/to/workspace"
    }
  },
  "id": 2
}

// Agent → Client
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "sess_xyz789"
  },
  "id": 2
}
```

### 3. Prompt Turn

```typescript
// Client → Agent
{
  "jsonrpc": "2.0",
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_xyz789",
    "prompt": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Please implement the login feature"
          }
        ]
      }
    ]
  },
  "id": 3
}

// Agent → Client (streaming updates)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_xyz789",
    "sessionUpdate": {
      "type": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "I'll help you implement..."
      }
    }
  }
}
```

## Implementation Status

- [x] Core Types
  - [x] Base types
  - [x] Content types
  - [x] Protocol messages
- [x] Server Implementation
  - [x] JSON-RPC handler
  - [x] Session manager
  - [x] Method handlers
    - [x] initialize
    - [x] authenticate
    - [x] session/new
    - [x] session/prompt
    - [x] session/load
    - [x] session/set_mode
    - [x] session/cancel
    - [x] File system methods
    - [x] Terminal methods
- [ ] Client Implementation
  - [ ] STDIO transport
  - [ ] Method calls
  - [ ] Event handling
- [ ] Integration
  - [x] Remove old ACP implementation
  - [ ] Update protocol adapter
  - [ ] Update agent service
- [ ] Testing
  - [ ] Unit tests
  - [ ] Integration tests
  - [ ] E2E tests

## References

- [Official ACP Specification](https://agentclientprotocol.com)
- [Protocol Overview](https://agentclientprotocol.com/protocol/overview)
- [Schema Documentation](https://agentclientprotocol.com/protocol/schema)
