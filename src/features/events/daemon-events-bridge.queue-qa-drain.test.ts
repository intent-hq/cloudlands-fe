/**
 * Regression: a queued Q&A answer must not reopen the wizard while it drains.
 *
 * The daemon's drain ordering contract (PROTOCOL §6.5, intent-hq/intentd#1783)
 * emits, per drained `question_answers` entry: `agent:queue:processing` → the
 * user-row `agent:message` → the marker-clearing `agent:updated`
 * (`pendingQuestionsMessageId: ""`) → the shrunk `agent:queue:updated`. Wire
 * order is not FE state-application order unless the marker clear is applied
 * synchronously: the queue snapshot replaces the store queue at once, the
 * lean `agent:message` carries no content (the transcript row arrives on the
 * independent `chat.subscribe` delta), and the `agent.get` refresh behind
 * `agent:updated` is async. With the queued answer gone, the marker still set
 * and no answer row, the wizard reopened for one interval — and a stale
 * `agent.get` response could re-set the marker afterwards.
 *
 * Runs the production bridge against the real store with every daemon request
 * withheld (the `agent.get` responses are released by hand).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentSession } from '$shared/types';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

const { pendingGets } = vi.hoisted(() => ({
  pendingGets: [] as Array<(result: unknown) => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
  backendRequest: (method: string) =>
    new Promise((resolve) => {
      if (method === 'agent.get') pendingGets.push(resolve);
    }),
}));

import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  clearAllSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { routeDaemonEventsNotification } from './daemon-events-bridge.client';
import { ensureAgentSession } from '$features/agent/agent-read-service';
import { deriveWizardPendingQuestions } from '$lib/components/chat/questions/wizard-gate';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';

const WS = 'ws-queue-qa-drain';

const question: AgentMessage = {
  id: 'question-1',
  role: 'assistant',
  timestamp: '2026-09-11T00:00:00Z',
  contentBlocks: [
    {
      type: 'resource',
      resource: {
        uri: 'intent-question://tar-abc123def456',
        name: 'Choice',
        mimeType: QUESTION_RESOURCE_MIME_TYPE,
        text: JSON.stringify({
          attachmentId: 'tar-abc123def456',
          header: 'Choice',
          question: 'Which?',
          options: [
            { label: 'A', description: 'A' },
            { label: 'B', description: 'B' },
          ],
          multiSelect: false,
        }),
      },
    },
  ],
};

const taggedEntry = {
  id: 'queue-1',
  content: 'A',
  queuedAt: '2026-09-11T00:00:00Z',
  position: 0,
  messageMetadata: { type: 'question_answers', answeredQuestionsMessageId: question.id },
};

function seedAskingAgent(agentId: string): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: WS,
        backendSessionId: 'backend-1',
        status: 'active',
        isResponding: true,
        isStreaming: true,
        createdAt: '2026-09-11T00:00:00Z',
        updatedAt: '2026-09-11T00:00:00Z',
        metadata: { pendingQuestionsMessageId: question.id },
        messages: [question],
      } as unknown as AgentSession,
    ]),
  );
}

let sequence = 0;
function emit(agentId: string, type: string, data: Record<string, unknown>): void {
  routeDaemonEventsNotification('events.event', {
    event: {
      id: `event-${++sequence}`,
      workspaceId: WS,
      type,
      timestamp: '2026-09-11T00:00:01Z',
      actor: { type: 'agent', id: agentId },
      data,
    },
  });
}

function agentLite(agentId: string, pendingQuestionsMessageId: string): Record<string, unknown> {
  return {
    id: agentId,
    workspaceId: WS,
    name: 'QA agent',
    status: 'active',
    metadata: { pendingQuestionsMessageId },
    messageCount: 1,
  };
}

const pending = (agentId: string) =>
  deriveWizardPendingQuestions(appStore.state, agentId, [question]);
const storedMarker = (agentId: string) =>
  appStore.state.agentSessions?.byAgentId[agentId]?.metadata?.pendingQuestionsMessageId;

describe('queued question answers across the daemon drain sequence', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    appStore.dispatch(clearAllSessions());
    pendingGets.length = 0;
  });
  afterAll(() => appStore.dispose());

  it('keeps the wizard closed through the ordered drain when the chat delta and agent.get lag', () => {
    const agentId = 'agent-qa-drain';
    seedAskingAgent(agentId);
    expect(pending(agentId)?.messageId).toBe(question.id);

    emit(agentId, 'agent:queue:updated', { agentId, queue: [taggedEntry] });
    expect(pending(agentId)).toBeNull();

    emit(agentId, 'agent:queue:processing', {
      agentId,
      messageId: 'queue-1',
      content: 'A',
      turnId: 'turn-1',
    });
    emit(agentId, 'agent:message', {
      agentId,
      messageId: 'answer-1',
      role: 'user',
      turnId: 'turn-1',
      queuedMessageId: 'queue-1',
    });
    expect(pending(agentId)).toBeNull();

    emit(agentId, 'agent:updated', { agentId, pendingQuestionsMessageId: '' });
    expect(storedMarker(agentId)).toBe('');
    expect(pending(agentId)).toBeNull();

    emit(agentId, 'agent:queue:updated', { agentId, queue: [] });
    expect(pending(agentId)).toBeNull();
  });

  it('lets a stale in-flight agent.get response settle without re-arming the cleared marker', async () => {
    const agentId = 'agent-qa-stale-get';
    seedAskingAgent(agentId);

    const staleRead = ensureAgentSession(agentId);
    expect(pendingGets).toHaveLength(1);

    emit(agentId, 'agent:queue:updated', { agentId, queue: [taggedEntry] });
    emit(agentId, 'agent:updated', { agentId, pendingQuestionsMessageId: '' });
    emit(agentId, 'agent:queue:updated', { agentId, queue: [] });
    expect(pending(agentId)).toBeNull();

    pendingGets[0]!(agentLite(agentId, question.id));
    await staleRead;
    await vi.waitFor(() => expect(pendingGets).toHaveLength(2));
    expect(storedMarker(agentId)).toBe('');
    expect(pending(agentId)).toBeNull();

    pendingGets[1]!(agentLite(agentId, ''));
    await vi.waitFor(() => expect(storedMarker(agentId)).toBe(''));
    expect(pending(agentId)).toBeNull();
  });

  it('shows the question set again when the queued answer is removed without a marker clear', () => {
    const agentId = 'agent-qa-removed';
    seedAskingAgent(agentId);

    emit(agentId, 'agent:queue:updated', { agentId, queue: [taggedEntry] });
    expect(pending(agentId)).toBeNull();

    emit(agentId, 'agent:queue:updated', { agentId, queue: [] });
    expect(storedMarker(agentId)).toBe(question.id);
    expect(pending(agentId)?.messageId).toBe(question.id);
  });

  it('applies a later marker set from agent:updated for a newer question message', () => {
    const agentId = 'agent-qa-newer';
    seedAskingAgent(agentId);

    emit(agentId, 'agent:updated', { agentId, pendingQuestionsMessageId: '' });
    expect(pending(agentId)).toBeNull();

    emit(agentId, 'agent:updated', { agentId, modelId: 'other-model' });
    expect(storedMarker(agentId)).toBe('');

    emit(agentId, 'agent:updated', { agentId, pendingQuestionsMessageId: question.id });
    expect(pending(agentId)?.messageId).toBe(question.id);
  });
});
