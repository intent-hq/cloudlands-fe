# Troubleshooting Guide

**Version**: 2.0.0
**Last Updated**: November 19, 2025
**Status**: Post-Refactor Architecture

## Table of Contents

1. [Agent Creation Issues](#agent-creation-issues)
2. [Streaming Issues](#streaming-issues)
3. [Manager Issues](#manager-issues)
4. [Memory and Performance](#memory-and-performance)
5. [Test Issues](#test-issues)
6. [TypeScript Issues](#typescript-issues)
7. [Migration Issues](#migration-issues)

## Common Issues and Solutions

### Agent Creation Issues

#### Problem: User rules not being loaded

**Symptom**: Agent doesn't follow workspace-specific rules
**Cause**: Direct orchestrator call bypassing factory
**Solution**:

```typescript
// ❌ WRONG - Bypasses rules
const agent = await orchestrator.createAgent(workspace, config);

// ✅ CORRECT - Guarantees rules
import { agentFactory } from '@/features/agent/agent-factory';
const agent = await agentFactory.createAgent(workspace, config);
```

#### Problem: Agent creation fails silently

**Symptom**: No agent appears, no error message
**Check**:

1. Verify workspace has valid ID
2. Check browser console for errors
3. Ensure Auggie is installed and running
4. Check IPC communication

**Debug**:

```typescript
try {
  const agent = await agentFactory.createAgent(workspace, config);
  console.log('Agent created:', agent);
} catch (error) {
  console.error('Agent creation failed:', error);
  // Check error.code for specific issue
}
```

### Streaming Issues

#### Problem: Messages appear all at once instead of streaming

**Cause**: BatchProcessor queuing without flush
**Solution**: In development, messages are batched for efficiency

```typescript
// Force immediate processing (for debugging)
await streamManager.flushBatch();
```

#### Problem: Streaming stops unexpectedly

**Check**:

1. Agent process still running
2. No memory limits exceeded
3. Stream session not timed out

**Debug**:

```typescript
const metrics = consolidatedBackend.getHealthMetrics();
console.log('Active agents:', metrics.activeAgents);
console.log('Memory usage:', metrics.memoryUsage);
```

### Test Issues

#### Problem: Tests hanging indefinitely

**Cause**: Async batch processing not completing
**Solution**:

```typescript
// After any streaming operation in tests
await streamManager.flushBatch();

// Or use test utilities
import { waitForBatchProcessing } from '@/test-utils';
await waitForBatchProcessing();
```

#### Problem: "Cannot find module" errors in tests

**Cause**: Path aliases not configured
**Solution**: Check `vitest.config.ts`:

```typescript
export default {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      $lib: path.resolve(__dirname, './src/lib'),
    },
  },
};
```

### TypeScript Issues

#### Problem: Branded ID type errors

**Symptom**: "Type 'string' is not assignable to type 'AgentId'"
**Solution**:

```typescript
// ❌ WRONG
const agentId: AgentId = 'some-id';

// ✅ CORRECT - Get from factory/backend
const result = await agentFactory.createAgent(workspace, config);
const agentId = result.agentId; // Already branded
```

#### Problem: Missing error codes

**Symptom**: "Property 'X' does not exist on type 'AgentErrorCode'"
**Solution**: Add to error enum:

```typescript
// src/shared/types/errors.ts
export enum AgentErrorCode {
  // ... existing codes
  YOUR_NEW_ERROR = 'YOUR_NEW_ERROR',
}
```

### Performance Issues

#### Problem: High memory usage with multiple agents

**Check**:

1. Agents being properly cleaned up
2. Stream sessions ending correctly
3. Memory cleanup intervals running

**Solution**:

```typescript
// Manual cleanup
await consolidatedBackend.cleanupInactiveSessions();

// Check cleanup is scheduled
const health = consolidatedBackend.checkHealth();
console.log('Cleanup scheduled:', health.cleanupScheduled);
```

#### Problem: Slow agent responses

**Check**:

1. Network latency to Auggie
2. System prompt complexity
3. Number of concurrent agents

**Debug**:

```typescript
console.time('agent-response');
await consolidatedBackend.sendMessage(agentId, 'test');
console.timeEnd('agent-response');
```

### IPC Communication Issues

#### Problem: "IPC channel not found" errors

**Cause**: Handler not registered or wrong channel name
**Solution**: Verify handler registration:

```typescript
// main/handlers/agent.handlers.ts
ipcMain.handle('agent:create', async (event, data) => {
  return consolidatedBackend.createAgent(data.workspace, data.config);
});
```

#### Problem: IPC timeout errors

**Cause**: Long-running operations blocking main process
**Solution**: Use streaming or break into smaller operations

### Build Issues

#### Problem: Build fails with module errors

**Solution**:

```bash
# Clean and rebuild
rm -rf node_modules dist
pnpm install
npm run build
```

#### Problem: "Cannot find module electron" in production

**Cause**: Electron not bundled correctly
**Solution**: Check `electron-builder.yml` configuration

## Debugging Tools

### Browser DevTools

```javascript
// Enable verbose logging
localStorage.setItem('DEBUG', 'agent:*');

// Check agent state
console.log(agentState.sessions);
console.log(agentState.streamingSessions);
```

### Backend Logging

```typescript
// Enable debug mode
process.env.DEBUG = 'backend:*';

// Add custom logging
import { logger } from '@/utils/logger';
logger.debug('Agent operation', { agentId, operation });
```

### Health Monitoring

```typescript
// Regular health checks
setInterval(async () => {
  const health = await consolidatedBackend.getHealthMetrics();
  console.log('System health:', health);
}, 60000);
```

## Migration Issues

### Problem: Old service imports not found

**Symptom**: "Cannot find module './services/message-accumulator'"
**Solution**:

```typescript
// ❌ OLD
import { messageAccumulator } from './services/message-accumulator';

// ✅ NEW
import { messageManager } from '$features/agent/managers';
```

### Problem: IPC channel conflicts

**Symptom**: "Handler already registered"
**Solution**: Use only AGENT_CHANNELS from '$shared/ipc/channels'

### Problem: State not reactive

**Symptom**: UI not updating
**Solution**: Migrate to Svelte 5 runes ($state, $derived)

### Problem: Manager singleton issues

**Symptom**: Different manager instances
**Solution**: Always use getInstance() method

## Quick Debugging Commands

```bash
# Check TypeScript errors
npm run type-check

# Run tests
npm run test

# Check for memory leaks
npm run test:memory

# Monitor performance
npm run dev:debug

# Clean and rebuild
npm run clean && npm run build
```

## Error Code Reference

| Range     | Category       | Example                  |
| --------- | -------------- | ------------------------ |
| 1000-1999 | Agent Errors   | AGENT_NOT_FOUND (1001)   |
| 2000-2999 | Stream Errors  | STREAM_TIMEOUT (2002)    |
| 3000-3999 | Storage Errors | STORAGE_CORRUPTED (3004) |
| 4000-4999 | IPC Errors     | IPC_TIMEOUT (4001)       |

## Getting Help

1. Check this troubleshooting guide
2. Review [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for migration issues
3. See [AGENT_API_REFERENCE.md](./AGENT_API_REFERENCE.md) for API details
4. Check [AGENT_SYSTEM_EVERGREEN_ARCHITECTURE.md](./AGENT_SYSTEM_EVERGREEN_ARCHITECTURE.md)
5. Search existing issues in the repository
6. Ask in #agent-system channel with:
   - Error messages and codes
   - Steps to reproduce
   - System information
   - Relevant code snippets
   - What you've already tried

---

**Version**: 2.0.0 | **Updated**: November 19, 2025
