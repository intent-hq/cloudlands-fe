/**
 * Provenance System Tests
 *
 * Tests for ProvenanceContextManager and AttributionEngine
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  ProvenanceContextManager,
  resetProvenanceContextManager,
} from '../provenance-context-manager';
describe('ProvenanceContextManager', () => {
  let manager: ProvenanceContextManager;

  beforeEach(() => {
    resetProvenanceContextManager();
    manager = new ProvenanceContextManager({ debug: false });
  });

  afterEach(() => {
    manager.clear();
  });

  it('should push and pop contexts correctly', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const contextId = manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
    });

    expect(manager.getCurrentContext()).toBeDefined();
    expect(manager.getCurrentContext()?.agent?.id).toBe('agent-1');

    manager.popContext();
    expect(manager.getCurrentContext()).toBeUndefined();
  });

  it('should handle nested contexts', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx1 = manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Agent 1',
      messageId: 'msg-1',
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx2 = manager.createAgentContext({
      agentId: 'agent-2',
      agentName: 'Agent 2',
      messageId: 'msg-2',
    });

    expect(manager.getStackDepth()).toBe(2);
    expect(manager.getCurrentContext()?.agent?.id).toBe('agent-2');

    manager.popContext();
    expect(manager.getCurrentContext()?.agent?.id).toBe('agent-1');

    manager.popContext();
    expect(manager.getCurrentContext()).toBeUndefined();
  });

  it('should retrieve context by ID', () => {
    const contextId = manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
    });

    const context = manager.getContext(contextId);
    expect(context).toBeDefined();
    expect(context?.agent?.id).toBe('agent-1');
  });

  it('should validate context stack', () => {
    const validation = manager.validate();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
