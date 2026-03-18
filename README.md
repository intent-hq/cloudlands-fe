# 🚀 Intent by Augment

> **Intent** - A desktop application for managing development workspaces with integrated AI agents, SSH capabilities, and comprehensive project management tools. Built with Electron, SvelteKit, and TypeScript.

## 🎯 Current Status

**Version**: 1.0.0
**Architecture**: Consolidated backend with guaranteed user rules loading
**State**: Production Ready
**Build**: ✅ Passing (0 TypeScript errors)
**Tests**: ✅ 1,295 tests passing (94.5% pass rate)
**Code Quality**: ✅ Clean, maintainable, well-structured
**Performance**: Optimized with direct streaming and smart caching
**Agent System**: ✅ Fully refactored with single source of truth

### Clean Architecture (v1.0.0)

The codebase follows clean architecture principles with consolidated backend:

- ✅ **Consolidated Backend** - Single source of truth for all agent operations
- ✅ **Agent Factory Pattern** - Guaranteed user rules loading for all agents
- ✅ **Direct Streaming** - Immediate character-by-character streaming with session cleanup
- ✅ **Repository Pattern** - Complete separation of data access from business logic
- ✅ **Event Bus** - Properly distributes events to UI components
- ✅ **Structured Logging** - Centralized logging with context
- ✅ **Runtime Validation** - Zod schemas and branded IDs prevent corruption
- ✅ **Error Recovery** - Automatic recovery with health monitoring

## 📚 Documentation

### Quick Start

- **[DEVELOPER_GUIDE](./docs/DEVELOPER_GUIDE.md)** - Getting started and development workflow
- **[Documentation Index](./docs/README.md)** - Complete documentation map

### Architecture & Design

- **[AGENT_ARCHITECTURE](./docs/AGENT_ARCHITECTURE.md)** - Agent system architecture and design
- **[COMPONENT_RESPONSIBILITIES](./docs/COMPONENT_RESPONSIBILITIES.md)** - Component structure and ownership
- **[EVENT_SYSTEM](./docs/EVENT_SYSTEM.md)** - Unified event system architecture
- **[STATE_MANAGEMENT](./docs/STATE_MANAGEMENT.md)** - State management architecture and Redux migration notes

Per [`docs/STATE_MANAGEMENT.md`](./docs/STATE_MANAGEMENT.md), Redux in `src/lib/store/` is the canonical home for shared or durable app state. Existing `.store.svelte.ts` modules remain transitional adapters during the migration.

### Technical Guides

- **[TYPE_SYSTEM_GUIDE](./docs/TYPE_SYSTEM_GUIDE.md)** - TypeScript and type safety
- **[ERROR_HANDLING_SYSTEM](./docs/ERROR_HANDLING_SYSTEM.md)** - Error handling patterns
- **[TROUBLESHOOTING_GUIDE](./docs/TROUBLESHOOTING_GUIDE.md)** - Common issues and solutions
- **[IPC_DEBUG_GUIDE](./docs/IPC_DEBUG_GUIDE.md)** - IPC debugging guide

## 📖 Overview

**Intent by Augment** is a desktop application designed for developers who work across multiple projects and need seamless integration with AI assistants. It combines workspace management, code editing, SSH remote development, and AI-powered chat in a single, unified interface.

Whether you're collaborating with AI agents, managing remote servers, or organizing complex development projects, Intent provides the tools you need to stay productive and organized.

### Key Use Cases

- 🤖 **AI-Assisted Development**: Chat with multiple AI providers (OpenAI, Anthropic, Augment CLI) directly within your workspace
- 🌍 **Remote Development**: Connect to remote servers via SSH, execute commands, and sync files seamlessly
- 📝 **Project Organization**: Manage multiple workspaces with rich metadata, notes, and file organization
- 💻 **Code Editing**: Built-in code editor with syntax highlighting for 20+ languages
- 🔄 **Git Integration**: View diffs, manage changes, and track project history
- 📊 **Real-time Streaming**: Live streaming of AI responses and command output

## ✨ Features

### Core Capabilities

- **🚀 Workspace Management**: Create and manage multiple development workspaces with rich metadata and organization
- **🤖 Universal AI Agent Support**: Integrate with OpenAI, Anthropic, Augment CLI, and custom AI providers
- **🔐 SSH & Remote Development**: Connect to remote servers, execute commands, and sync files with SFTP
- **📝 Rich Code Editor**: Built-in editor powered by CodeMirror with syntax highlighting for 20+ languages
- **📓 Notes System**: Markdown-based note taking with TipTap editor, tags, and full-text search
- **🔄 Git Integration**: View diffs, manage changes, and track project history
- **📊 Activity Log**: Comprehensive tracking of all workspace activities with actor attribution
- **🎨 Theme Support**: Light/dark mode with system preference detection
- **⚡ Real-time Streaming**: Live streaming of AI responses and command output
- **🔧 Tool Execution**: Standardized interface for agent capabilities and tool calls
- **💾 Persistent Storage**: All data saved locally with electron-store
- **🖥️ Terminal Integration**: xterm-based terminal for command execution and SSH sessions

## 🤖 AI Provider Support

### SSH Capabilities

- Secure connection management with multiple authentication methods (password, key-based)
- Real-time command execution with streaming output
- SFTP-based file synchronization
- Port forwarding for remote services
- Session persistence and automatic reconnection
- Terminal emulation with xterm for interactive sessions

## 🏗️ Architecture

The application follows clean architecture principles with a layered approach:

```
UI (Renderer) → IPC Handlers → Protocol Adapter → Services → Repositories → File System
                                                    ↓
                                               Event Bus → Auto-broadcast to all listeners
```

### Key Architectural Components

- **Repository Pattern**: Separates data access from business logic
  - `WorkspaceRepository`, `NotesRepository`, `CommentsRepository`, `ActivityLogRepository`
  - FileSystem and InMemory implementations for testing

- **Service Layer**: Pure business logic
  - `WorkspaceService`, `NotesService`, `ActivityLogService`
  - Uses repositories for data access
  - Emits events via Event Bus

- **Activity Log System**: Unified event tracking
  - Tracks 40+ activity types across all workspace operations
  - Actor attribution (User, Agent, System, External)
  - Content-based deduplication with time windows
  - Session management for grouping related activities
  - Auto-save with dirty flag tracking

- **Protocol Adapter**: Unified entry point for all protocols
  - Routes requests to appropriate services
  - Used by IPC handlers and STDIO MCP server

- **Event Bus**: Automatic event broadcasting
  - Auto-broadcasts to all renderer windows
  - Auto-broadcasts to STDIO connections
  - Centralized event management

- **Validation**: Runtime type checking with Zod schemas
- **Structured Logging**: Centralized logging with context
- **Centralized Configuration**: All paths and constants in one place

### Workspace File Structure

```
~/.workspaces/
  {workspace-id}/
    .workspace/                    # Hidden metadata folder
      workspace.json               # Workspace metadata
      notes/                       # Notes
        spec.json
        spec.comments.json
      agents/                      # Agent sessions and conversations
        {agent-id}.json            # Individual agent conversation history
      diffs/                       # Diffs
      cache/                       # Cache
    {repo}__{title}/               # Git worktree (human-readable)
      src/                         # Actual code
```

## 📋 Prerequisites

- **Node.js** 18+ and npm/pnpm
- **Git** for version control
- **macOS**, **Windows**, or **Linux**
- **Optional**: Augment CLI (`auggie`) for Augment integration
- **Optional**: API keys for AI providers (OpenAI, Anthropic)

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/augmentcode/intent.git
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure AI Providers (Optional)

- **OpenAI**: Add your API key in Settings > AI Providers
- **Anthropic**: Add your API key in Settings > AI Providers
- **Augment CLI**: Install from [augmentcode.com](https://augmentcode.com)

## 🏗️ Architecture

The application follows a **Clean Architecture** pattern with feature-based organization:

```
src/
├── features/        # Feature modules (self-contained)
│   ├── agent/      # Unified agent system
│   ├── git/        # Git operations with caching
│   ├── mcp/        # Model Context Protocol
│   ├── notes/      # Notes management
│   └── workspace/  # Workspace management
├── lib/            # UI components & utilities
├── shared/         # Centralized types & utilities
└── routes/         # SvelteKit pages
```

### Key Architectural Decisions

- **Feature Isolation**: Each feature is completely self-contained
- **Single Source of Truth**: All types in `shared/types.ts`
- **Result Pattern**: Error handling via `Result<T, E>` type
- **Performance First**: Smart caching for expensive operations
- **Clean Separation**: Business logic in features, UI in lib

For detailed architecture documentation, see [docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md) and [docs/COMPONENT_RESPONSIBILITIES.md](docs/COMPONENT_RESPONSIBILITIES.md).

## 💻 Development

### Run in Development Mode

```bash
pnpm dev
```

This command will:

1. Build TypeScript files for main and preload processes
2. Start the Vite dev server for the renderer process (SvelteKit)
3. Launch Electron with hot-reload enabled
4. Open developer tools automatically

### Available Development Commands

```bash
pnpm dev:renderer      # Start Vite dev server only
pnpm dev:electron      # Start Electron only
pnpm build:main        # Build main process
pnpm build:preload     # Build preload scripts
pnpm check             # Run Svelte type checking
pnpm lint              # Run ESLint
pnpm format            # Format code with Prettier
```

## 🧪 Testing

### Run Tests

```bash
# Run all tests in watch mode
pnpm test

# Run all tests once
pnpm test -- --run

# Run specific test file
pnpm test -- test/agent-store.test.ts

# Run with coverage
pnpm test -- --coverage
```

For detailed testing documentation, see [test/README.md](test/README.md).

### Test Organization

- **Unit Tests**: Test individual components and services in isolation
- **Integration Tests**: Verify multiple components work together
- **IPC Contract Tests**: Ensure IPC communication works correctly

Current test coverage includes:

- ✅ Agent Store (19 tests)
- ✅ API Client - Agents (16 tests)
- ✅ MCP Tools
- ✅ Workspace Notes
- ✅ Collaboration Features

````

## 🏗️ Building

### Build for Production

```bash
# Build for current platform
pnpm dist

# Build for specific platforms
pnpm dist:mac          # macOS
pnpm dist:win          # Windows
pnpm dist:linux        # Linux
````

Built applications will be in the `dist-electron` directory.

## 📁 Project Structure

```
intent/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Main entry point
│   │   ├── ipc.ts               # IPC handlers
│   │   ├── mcp-stdio-server.ts  # MCP server integration
│   │   └── services/            # Backend services
│   │       ├── workspace-manager.ts
│   │       ├── agent-manager.ts
│   │       ├── ssh-manager.ts
│   │       └── augment-cli.ts
│   ├── preload/                 # Preload scripts
│   │   └── index.ts             # Context bridge API
│   ├── routes/                  # SvelteKit routes
│   │   ├── +layout.svelte       # Main layout
│   │   ├── +page.svelte         # Home/workspaces page
│   │   ├── workspace/           # Workspace routes
│   │   ├── settings/            # Settings page
│   │   └── agent/               # Agent chat routes
│   ├── lib/                     # Shared components & utilities
│   │   ├── components/          # Svelte components
│   │   ├── services/            # Client-side services
│   │   ├── stores/              # Svelte stores
│   │   ├── types/               # TypeScript types
│   │   └── utils/               # Utility functions
│   └── app.html                 # HTML template
├── package.json
├── tsconfig.json                # TypeScript config
├── vite.config.ts               # Vite configuration
├── svelte.config.js             # SvelteKit configuration
└── tailwind.config.js           # Tailwind CSS configuration
```

## 🔧 Configuration

### Settings

Access settings through the UI or modify directly:

- **API Token**: `~/.augment/token`
- **Workspace Data**: `~/.workspaces/`
- **App Settings**: Stored via electron-store

### Environment Variables

- `NODE_ENV`: Set to `production` for production builds
- `DEBUG`: Enable debug logging

## 🐛 Troubleshooting

### Auggie CLI Not Found

Ensure `auggie` is installed and in your PATH:

```bash
which auggie
```

### No API Token

Create or update your Augment token:

```bash
echo "your-token-here" > ~/.augment/token
```

### Build Errors

Clear caches and rebuild:

```bash
rm -rf node_modules dist dist-electron
pnpm install
pnpm build:main
pnpm dev
```

## 📚 Additional Documentation

### Feature Documentation

- [Line Attribution Dataflow](docs/line-attribution-dataflow.md) - Line attribution system
- [Chat Session Forking](docs/chat-session-forking.md) - Chat forking capabilities
- [Rules System](docs/RULES_SYSTEM.md) - Agent rules and specializations

### Reference

- [Browser Panel Spec](docs/BROWSER_PANEL_SPEC.md) - Browser panel integration
- [CDP MCP Tools](docs/CDP_MCP_TOOLS.md) - Chrome DevTools Protocol tools
