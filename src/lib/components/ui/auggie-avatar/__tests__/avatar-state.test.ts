import { describe, expect, it } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import { getAvatarState, isAgentActivelyWorking } from '../avatar-state';

describe('avatar state helpers', () => {
  it('trusts explicit idle status over stale responding flags', () => {
    const input = {
      status: 'idle',
      isStreaming: false,
      isProcessing: false,
      isResponding: true,
    };

    expect(isAgentActivelyWorking(input)).toBe(false);
    expect(getAvatarState(input)).toBe('idle');
  });

  it('keeps streaming and processing flags authoritative over idle status', () => {
    expect(
      getAvatarState({ status: AgentStatus.Idle, isStreaming: true }),
    ).toBe('running');
    expect(
      getAvatarState({ status: 'idle', isProcessing: true }),
    ).toBe('running');
  });
});