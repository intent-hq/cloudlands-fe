import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
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

  describe('session-derived question state', () => {
    const questionMessage: AgentMessage = {
      id: 'msg-q1',
      role: 'assistant',
      timestamp: '2026-08-17T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'resource',
          resource: {
            uri: 'intent-question://tar-1',
            name: 'Auth method',
            mimeType: QUESTION_RESOURCE_MIME_TYPE,
            text: JSON.stringify({
              attachmentId: 'tar-1',
              header: 'Auth method',
              question: 'Which auth method?',
              options: [{ label: 'OAuth' }, { label: 'API key' }],
              multiSelect: false,
            }),
          },
        } as unknown as AgentMessage['contentBlocks'][number],
      ],
    };

    function blockedSession(metadata: Record<string, unknown>): AgentSession {
      return {
        id: 'agent-1',
        backendSessionId: null,
        workspaceId: 'workspace-1',
        name: 'Agent',
        status: AgentStatus.Idle,
        isResponding: false,
        isStreaming: false,
        isProcessing: false,
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'sandbox broken',
        messages: [questionMessage],
        metadata,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      } as never;
    }

    it('returns question for a pending marker even when a blocker is pending', () => {
      expect(
        getAvatarStateForSession(blockedSession({ pendingQuestionsMessageId: 'msg-q1' })),
      ).toBe('question');
    });

    it('returns attention-blocker once the pending question is dismissed', () => {
      expect(
        getAvatarStateForSession(
          blockedSession({
            pendingQuestionsMessageId: 'msg-q1',
            dismissedQuestionsMessageId: 'msg-q1',
          }),
        ),
      ).toBe('attention-blocker');
    });

    it('returns attention-blocker once the marker is cleared', () => {
      expect(getAvatarStateForSession(blockedSession({ pendingQuestionsMessageId: '' }))).toBe(
        'attention-blocker',
      );
    });
  });
});
