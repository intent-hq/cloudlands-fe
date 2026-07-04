/**
 * Regression tests for the post-create initial-agent bootstrap
 * (fresh workspace → creation-dialog prompt must spawn the initial agent).
 *
 * The daemon ignores `initialAgent` on `workspace.create` (PROTOCOL §5.1) and
 * the agent-loading-saga that used to restore the pending agent on mount was
 * removed, so the workspace page must dispatch `activateInitialAgentRequested`
 * itself via `activatePendingInitialAgent`. These tests pin:
 *   - the stored pending config → UnifiedAgentConfig mapping (prompt becomes
 *     initialMessage; model/provider/specialist forwarded),
 *   - the dispatch when a prompt is present,
 *   - the empty-prompt no-op (a promptless workspace spawns nothing).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  activatePendingInitialAgent,
  buildInitialAgentActivationConfig,
} from '../initial-agent-config';
import { activateInitialAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

const WS = 'ws-bootstrap';
const AGENT = 'agent-bootstrap';

/** Pending config as CompactWorkspaceInitializer stores it (prompt, not initialMessage). */
const pendingConfig = {
  agentId: AGENT,
  name: 'Coordinator',
  model: 'claude-opus-4-7',
  specialist: 'coordinator',
  behaviorPrompt: 'You are the coordinator.',
  prompt: 'Initialize submodules',
  agentType: 'workspace',
  provider: 'auggie',
  metadata: { source: 'compact-initializer', isInitialAgent: true },
  isInitialAgent: true,
  isFirstWorkspaceAgent: true,
};

describe('buildInitialAgentActivationConfig', () => {
  it('maps the stored pending config to the UnifiedAgentConfig contract', () => {
    const config = buildInitialAgentActivationConfig(WS, AGENT, pendingConfig);

    expect(config).toMatchObject({
      workspaceId: WS,
      id: AGENT,
      name: 'Coordinator',
      model: 'claude-opus-4-7',
      provider: 'auggie',
      agentType: 'workspace',
      initialMessage: 'Initialize submodules',
      behaviorPrompt: 'You are the coordinator.',
      source: 'workspace-initializer',
    });
    expect(config.metadata).toMatchObject({
      isInitialAgent: true,
      isFirstWorkspaceAgent: true,
      specialist: 'coordinator',
    });
  });
});

describe('activatePendingInitialAgent', () => {
  it('dispatches activateInitialAgentRequested when a prompt is present', () => {
    const dispatch = vi.fn();

    const activated = activatePendingInitialAgent(WS, AGENT, pendingConfig, dispatch);

    expect(activated).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe(activateInitialAgentRequested.type);
    const [wsId, agentId, config] = action.payload;
    expect(wsId).toBe(WS);
    expect(agentId).toBe(AGENT);
    expect(config.initialMessage).toBe('Initialize submodules');
    expect(config.metadata.specialist).toBe('coordinator');
  });

  it('spawns nothing for an empty prompt (no dispatch)', () => {
    const dispatch = vi.fn();

    const emptyPrompt = { ...pendingConfig, prompt: undefined };
    const blankPrompt = { ...pendingConfig, prompt: '   ' };

    expect(activatePendingInitialAgent(WS, AGENT, emptyPrompt, dispatch)).toBe(false);
    expect(activatePendingInitialAgent(WS, AGENT, blankPrompt, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('still activates a promptless config that carries context references or images', () => {
    const dispatch = vi.fn();

    const withContext = {
      ...pendingConfig,
      prompt: undefined,
      contextReferences: [{ type: 'note', id: 'spec' }],
    };
    expect(activatePendingInitialAgent(WS, AGENT, withContext, dispatch)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('no-ops without an agent id', () => {
    const dispatch = vi.fn();
    expect(activatePendingInitialAgent(WS, undefined, pendingConfig, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
