import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  callbacks: new Map<string, { onContentBlocks?: (blocks: any[]) => void }>(),
  getAccumulated: vi.fn(),
  startAccumulation: vi.fn(),
  addContentBlock: vi.fn(),
}));

vi.mock('$features/mcp/main/mcp/stream-session-registry', () => ({
  testStreamManager: {
    getSession: mocks.getSession,
    callbacks: mocks.callbacks,
  },
}));

vi.mock('../../../../../store/main/slices/message-accumulator/message-accumulator-api', () => ({
  getAccumulated: mocks.getAccumulated,
  startAccumulation: mocks.startAccumulation,
  addContentBlock: mocks.addContentBlock,
}));

import { emitProposalToChat } from '../ws-app-proposal-content';

describe('emitProposalToChat', () => {
  const proposal: Proposal = {
    kind: 'settings-change',
    payload: { changes: [{ path: 'theme.preference', value: 'dark' }] },
    preview: { title: 'Change theme' },
    applyToolCallId: 'apply-tool-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callbacks.clear();
    mocks.getAccumulated.mockReturnValue({ sessionId: 'agent-1' });
  });

  it('builds a proposal block and emits it to the accumulator and callback', () => {
    const onContentBlocks = vi.fn();
    mocks.getSession.mockReturnValue({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      frontendSessionId: 'frontend-1',
    });
    mocks.callbacks.set('agent-1', { onContentBlocks });

    emitProposalToChat('workspace-1', 'agent-1', proposal);

    const expectedBlock = {
      type: 'proposal',
      kind: proposal.kind,
      payload: proposal.payload,
      preview: proposal.preview,
      applyToolCallId: proposal.applyToolCallId,
      proposal,
    };
    expect(mocks.addContentBlock).toHaveBeenCalledWith('agent-1', expectedBlock);
    expect(onContentBlocks).toHaveBeenCalledWith([expectedBlock]);
  });

  it('returns ok when the proposal block emits successfully', () => {
    mocks.getSession.mockReturnValue({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      frontendSessionId: 'frontend-1',
    });
    mocks.callbacks.set('agent-1', { onContentBlocks: vi.fn() });

    expect(emitProposalToChat('workspace-1', 'agent-1', proposal)).toEqual({ ok: true });
  });

  it('returns ok when no active session exists', () => {
    mocks.getSession.mockReturnValue(undefined);

    expect(emitProposalToChat('workspace-1', 'agent-1', proposal)).toEqual({ ok: true });
  });

  it('returns a failure result when the accumulator throws', () => {
    mocks.getSession.mockReturnValue({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      frontendSessionId: 'frontend-1',
    });
    mocks.addContentBlock.mockImplementation(() => {
      throw new Error('accumulator boom');
    });

    const result = emitProposalToChat('workspace-1', 'agent-1', proposal);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('accumulator boom');
  });

  it('returns a failure result when the stream callback throws', () => {
    mocks.getSession.mockReturnValue({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      frontendSessionId: 'frontend-1',
    });
    mocks.callbacks.set('agent-1', {
      onContentBlocks: () => {
        throw new Error('callback boom');
      },
    });

    const result = emitProposalToChat('workspace-1', 'agent-1', proposal);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('callback boom');
  });

  it('starts accumulation when the active session has no accumulator yet', () => {
    mocks.getSession.mockReturnValue({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      frontendSessionId: 'frontend-1',
    });
    mocks.getAccumulated.mockReturnValue(undefined);

    emitProposalToChat('workspace-1', 'agent-1', proposal);

    expect(mocks.startAccumulation).toHaveBeenCalledWith('agent-1', {
      sessionId: 'session-1',
      agentId: 'agent-1',
      frontendSessionId: 'frontend-1',
    });
    expect(mocks.addContentBlock).toHaveBeenCalled();
  });

  it('is a no-op when no active session exists', () => {
    mocks.getSession.mockReturnValue(undefined);

    emitProposalToChat('workspace-1', 'agent-1', proposal);

    expect(mocks.startAccumulation).not.toHaveBeenCalled();
    expect(mocks.addContentBlock).not.toHaveBeenCalled();
  });
});