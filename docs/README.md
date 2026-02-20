# Intent Documentation

## 📚 Core Documentation

### Architecture & Design
- **[AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)** - Agent system architecture and design
- **[COMPONENT_RESPONSIBILITIES.md](./COMPONENT_RESPONSIBILITIES.md)** - Component structure and responsibilities
- **[EVENT_SYSTEM.md](./EVENT_SYSTEM.md)** - Event system architecture

### Development
- **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)** - Getting started and development workflow
- **[TYPE_SYSTEM_GUIDE.md](./TYPE_SYSTEM_GUIDE.md)** - TypeScript and type safety
- **[IPC_DEBUG_GUIDE.md](./IPC_DEBUG_GUIDE.md)** - IPC debugging guide

### Technical Guides
- **[STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md)** - State management with Svelte 5 runes
- **[ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md)** - Error handling patterns
- **[TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md)** - Debugging and common issues

### Features
- **[line-attribution-dataflow.md](./line-attribution-dataflow.md)** - Line attribution system
- **[chat-session-forking.md](./chat-session-forking.md)** - Chat forking capabilities

## 🚀 Quick Start

### For New Developers
1. Start with [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
2. Review [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)
3. Understand [STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md)

### For AI Agents
1. Check `.augment/rules/` for agent-specific documentation
2. Review [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)
3. Use [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) for debugging

## System Components

### Frontend (Renderer Process)

- **UI Components** - Svelte 5 components with shadcn-svelte
- **State Management** - Unified state with reference counting
- **Services** - Business logic layer
- **IPC Bridge** - Communication with main process

### Backend (Main Process)

- **IPC Handlers** - Handle renderer requests
- **Backend Services** - Core business logic
- **External Integrations** - Git, file system, agents

### Agent System (v1.0.0)

- **ConsolidatedBackendService** - Single source of truth for all agent operations
- **AgentFactory** - Standardized creation with guaranteed user rules
- **StreamManager** - Efficient batch processing for streaming
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

## Additional Resources

### Agent Rules (in `.augment/rules/`)
- **error-tracking.md** - Error tracking system
- **testing-and-debugging.md** - Testing quick reference
- **type-safety.md** - Type system documentation
- **system.md** - System rules
- **user.md** - User preferences
- **merge-conflict.md** - Merge conflict handling

---

*Last Updated: January 2026*
*Version: 2.2.0*
