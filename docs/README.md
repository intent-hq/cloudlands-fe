# Intent Documentation

This index lists active documentation in `docs/`; obsolete proposal, spike, and investigation docs have been removed.

## 📚 Complete Index

### Top-level docs
- **[AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)** - Agent system architecture and design
- **[agent-message-dedup-and-stream-sagas.md](./agent-message-dedup-and-stream-sagas.md)** - Agent message deduplication and saga-owned stream reconciliation architecture
- **[AUGGIE_USAGE_TRACKING_AUDIT.md](./AUGGIE_USAGE_TRACKING_AUDIT.md)** - Audit notes for Auggie usage tracking
- **[BROWSER_PANEL_SPEC.md](./BROWSER_PANEL_SPEC.md)** - Browser panel product and UX specification
- **[CDP_MCP_TOOLS.md](./CDP_MCP_TOOLS.md)** - Browser/CDP MCP tools reference
- **[COMPONENT_RESPONSIBILITIES.md](./COMPONENT_RESPONSIBILITIES.md)** - Component structure and responsibilities
- **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)** - Getting started and development workflow
- **[ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md)** - Error handling patterns and system design
- **[EVENT_SYSTEM.md](./EVENT_SYSTEM.md)** - Event system architecture
- **[IPC_DEBUG_GUIDE.md](./IPC_DEBUG_GUIDE.md)** - IPC debugging guide
- **[KEYBINDINGS.md](./KEYBINDINGS.md)** - Keyboard shortcuts and bindings reference
- **[MULTI_ACP_PROVIDER_SPEC.md](./MULTI_ACP_PROVIDER_SPEC.md)** - Multi-provider ACP specification
- **[RULES_SYSTEM.md](./RULES_SYSTEM.md)** - Rules and instruction system
- **[STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md)** - State management orientation and links to the Redux skills as the active architecture source
- **[TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md)** - Debugging and common issues
- **[TYPE_SYSTEM_GUIDE.md](./TYPE_SYSTEM_GUIDE.md)** - TypeScript and type safety
- **[chat-session-forking.md](./chat-session-forking.md)** - Chat forking capabilities
- **[code-review-ui.md](./code-review-ui.md)** - Code review UI notes and behavior
- **[comment-type-safety-migration.md](./comment-type-safety-migration.md)** - Status of the comment type-safety migration
- **[line-attribution-dataflow.md](./line-attribution-dataflow.md)** - Line attribution system
- **[panel-system-refactoring.md](./panel-system-refactoring.md)** - Panel system refactoring notes
- **[tasks-block-syntax.md](./tasks-block-syntax.md)** - Task block syntax reference
- **[workspaces-link-handler.md](./workspaces-link-handler.md)** - Workspace link handling behavior

### `proposals/`
- **[PANEL_TAB_UX_SPEC.md](./proposals/PANEL_TAB_UX_SPEC.md)** - Panel and tab system UX specification
- **[homepage-progress-cards.md](./proposals/homepage-progress-cards.md)** - Proposal for homepage progress cards

### `investigations/`
- **[svelte-tiptap-utilities-implementation.md](./investigations/svelte-tiptap-utilities-implementation.md)** - Summary of the shared TipTap utility implementation

### `real/`
- **[DEPLOYING.md](./real/DEPLOYING.md)** - Deployment notes and operational guidance

## 📚 Core Documentation

### Architecture & Design
- **[AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)** - Agent system architecture and design
- **[agent-message-dedup-and-stream-sagas.md](./agent-message-dedup-and-stream-sagas.md)** - Agent message deduplication and stream saga architecture
- **[COMPONENT_RESPONSIBILITIES.md](./COMPONENT_RESPONSIBILITIES.md)** - Component structure and responsibilities
- **[EVENT_SYSTEM.md](./EVENT_SYSTEM.md)** - Event system architecture

### Development
- **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)** - Getting started and development workflow
- **[TYPE_SYSTEM_GUIDE.md](./TYPE_SYSTEM_GUIDE.md)** - TypeScript and type safety
- **[IPC_DEBUG_GUIDE.md](./IPC_DEBUG_GUIDE.md)** - IPC debugging guide

### Technical Guides
- **[STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md)** - State management orientation; active Redux architecture rules live in the skills under `../.agents/skills/ag-redux-toolkit/`
- **[ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md)** - Error handling patterns
- **[TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md)** - Debugging and common issues

### Features
- **[line-attribution-dataflow.md](./line-attribution-dataflow.md)** - Line attribution system
- **[chat-session-forking.md](./chat-session-forking.md)** - Chat forking capabilities

## 🚀 Quick Start

### For New Developers
1. Start with [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
2. Review [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)
3. Review [STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md), then follow the Redux skills for current implementation rules

- **[Agents.md](../Agents.md)** - Quick reference for AI agents working in this codebase

## System Components

### Frontend (Renderer Process)

- **UI Components** - Svelte 5 components with shadcn-svelte
- **State Management** - Redux for shared state; `.store.svelte.ts` modules are deprecated migration targets, and Store-first Redux rules live in the skills
- **Services** - Business logic layer
- **IPC Bridge** - Communication with main process

### Backend (Main Process)

- **IPC Handlers** - Handle renderer requests
- **Backend Services** - Core business logic
- **External Integrations** - Git, file system, agents

### Agent System

- **ConsolidatedBackendService** - Single source of truth for all agent operations
- **AgentFactory** - Standardized creation with guaranteed user rules
- **StreamManager** - Direct streaming with session management and cleanup
- **Stream lifecycle + Redux sagas** - Thin stream adapters dispatch raw actions; sagas own shared-state reconciliation and side-effect orchestration
- **ACP Protocol** - Agent Communication Protocol with Auggie
- **Session Management** - Agent lifecycle with automatic cleanup
- **Tool Execution** - Standardized tool interface

## Key Features

### Workspace Management

- Creation and configuration
- Git integration
- File tracking and change detection
- Activity logging

### Agent Integration

- Multiple provider support (currently ACP/Auggie)
- Streaming responses
- Tool execution
- Session persistence

### Performance Optimizations

- Reference counting for memory management
- Virtual scrolling for large lists
- Debounced operations
- Lazy loading

## Architecture Decisions

### Why Svelte 5?

- Modern reactive system with runes
- Excellent performance
- Clean component syntax
- Built-in state management

### Why Electron?

- Desktop application requirements
- File system access
- Native integrations
- Cross-platform support

### Why ACP for Agents?

- Standardized protocol
- Tool execution support
- Streaming capabilities
- Extensible design

## Troubleshooting

### Common Issues

**Port 5177 already in use**

- Another instance may be running
- Check with `lsof -i :5177` and kill if needed

**Agent not responding**

- Ensure Auggie is installed
- Check agent logs in DevTools console
- Verify ACP configuration

**File changes not detected**

- Git polling may be delayed (5-10 seconds)
- Check git status manually
- Verify workspace path is correct

**Memory usage increasing**

- Check for disposed state instances
- Review cleanup intervals
- Monitor with Chrome DevTools Performance tab

## Future Improvements

### Planned Features

- [x] Automated testing suite (2500+ tests)
- [ ] Performance monitoring dashboard
- [ ] Enhanced agent capabilities
- [ ] Multi-workspace view
- [ ] Collaborative features

### Technical Debt

- [ ] Migrate remaining console.log to Logger
- [ ] Add comprehensive error boundaries
- [ ] Implement service worker for offline support
- [ ] Add telemetry and analytics

## Resources

### External Documentation

- [Svelte 5 Documentation](https://svelte.dev/docs)
- [SvelteKit Documentation](https://kit.svelte.dev/docs)
- [Electron Documentation](https://www.electronjs.org/docs)
- [shadcn-svelte Components](https://www.shadcn-svelte.com/)

### Internal Tools

- Logger utility for structured logging
- IPC bridge for renderer-main communication
- Global save queue for debounced persistence
- Performance monitor for optimization

## Contact

For questions or issues:

1. Check this documentation
2. Review existing code and comments
3. Ask in the development chat
4. Create an issue with detailed description

---

*Last Updated: March 2026*
*Version: 2.2.0*
