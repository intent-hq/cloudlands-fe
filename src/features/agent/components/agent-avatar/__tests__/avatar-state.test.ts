import { describe, expect, it } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import { getAvatarState, getAvatarStateForSession, isAgentActivelyWorking } from '../avatar-state';

describe('avatar state helpers', () => {
  it('keeps daemon responding evidence active over stale lifecycle text', () => {
    const input = {
      status: 'idle',
      isStreaming: false,
      isProcessing: false,
      isResponding: true,
    };

    expect(isAgentActivelyWorking(input)).toBe(true);
    expect(getAvatarState(input)).toBe('running');
  });

  it('keeps streaming and processing flags authoritative over idle status', () => {
    expect(getAvatarState({ status: AgentStatus.Idle, isStreaming: true })).toBe('running');
    expect(getAvatarState({ status: 'idle', isProcessing: true })).toBe('running');
  });

  it.each([
    ['responding', { status: AgentStatus.Active, isResponding: true }, 'running'],
    [
      'in-flight tool',
      {
        status: AgentStatus.Waiting,
        isResponding: false,
        isWaitingOnTool: true,
        turnInFlight: true,
      },
      'running',
    ],
    [
      'tool with transient response flags dropped',
      { status: AgentStatus.Waiting, isWaitingOnTool: true },
      'running',
    ],
    ['blocked wait', { status: AgentStatus.Waiting }, 'waiting'],
    [
      'active orchestration peer wait',
      { status: AgentStatus.Active, isResponding: true, isWaitingForOtherAgents: true },
      'running',
    ],
    ['settled peer wait', { status: AgentStatus.Idle, isWaitingForOtherAgents: true }, 'waiting'],
    ['stale Waiting status', { status: AgentStatus.Waiting, isResponding: true }, 'running'],
  ] as const)('maps %s through the canonical session derivation', (_name, fields, expected) => {
    expect(
      getAvatarStateForSession({
        id: 'agent-1',
        backendSessionId: null,
        workspaceId: 'workspace-1',
        name: 'Agent',
        messages: [],
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
        ...fields,
      } as never),
    ).toBe(expected);
  });

  it('preserves explicit terminal state before a session is hydrated', () => {
    expect(getAvatarStateForSession(null, { isCompleted: true })).toBe('completed');
    expect(getAvatarStateForSession(undefined, { isFailed: true })).toBe('failed');
  });
});
