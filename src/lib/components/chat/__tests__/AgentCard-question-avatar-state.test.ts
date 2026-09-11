/**
 * @vitest-environment jsdom
 *
 * AgentCard — pending-question avatar state on the expanded Agents panel row.
 *
 * Renders the REAL component against the REAL configured store: seeds an
 * agent session plus a captured HUD question (`hud.questionsByAgentId`) and
 * asserts the panel-row avatar derives the `question` state exactly like the
 * mini dock / panel header, that a dismissed question
 * (`metadata.dismissedQuestionsMessageId`) clears it, and that the existing
 * failed/completed precedence still wins over a pending question.
 *
 * Also guards the action surface: a running agent whose avatar shows the
 * `question` state must still offer "Stop" in its context menu, since action
 * availability is keyed on the canonical runtime state rather than on the
 * display precedence.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { stopAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  hudActivated,
  hudDeactivated,
  hudQuestionCaptured,
  type HudCapturedQuestion,
} from '$store/renderer/slices/hud/hud-slice';
import {
  pendingQuestionRecoveryCleared,
  pendingQuestionRecoveryRequested,
  pendingQuestionRecoverySettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { QUESTION_RESOURCE_MIME_TYPE, type Question } from '$shared/types/question-resource';

// Distinct agent id per test: the configured store is a process singleton.
let testAgentSeq = 0;
let agentId = '';

const QUESTION_MESSAGE_ID = 'msg-question-1';

// PROTOCOL §7.1 question resource payload, as the daemon emits it.
const WIRE_QUESTION: Question = {
  attachmentId: 'tar-abc123def456',
  header: 'Auth method',
  question: 'Which authentication method should the new endpoint use?',
  options: [
    { label: 'OAuth', description: 'Standard OAuth 2.0 flow' },
    { label: 'API key', description: 'Static key in header' },
  ],
  multiSelect: false,
};

function questionBlock(): ContentBlock {
  return {
    type: 'resource',
    resource: {
      uri: `intent-question://${WIRE_QUESTION.attachmentId}`,
      name: WIRE_QUESTION.header,
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: JSON.stringify(WIRE_QUESTION),
    },
  } as unknown as ContentBlock;
}

function questionMessage(id = QUESTION_MESSAGE_ID): AgentMessage {
  return {
    id,
    role: 'assistant',
    contentBlocks: [questionBlock()],
    timestamp: '2026-08-01T00:00:01.000Z',
  } as AgentMessage;
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Questioning Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function makeCapturedQuestion(overrides: Partial<HudCapturedQuestion> = {}): HudCapturedQuestion {
  return {
    workspaceId: 'ws-1',
    agentId,
    messageId: QUESTION_MESSAGE_ID,
    header: 'Need a decision',
    question: 'Which option should I take?',
    ts: '2026-08-01T00:00:01.000Z',
    ...overrides,
  };
}

async function findAvatarState(): Promise<string | null> {
  const card = await screen.findByTestId('agent-list-item');
  const avatar = card.querySelector('[data-agent-avatar-with-state]');
  expect(avatar).not.toBeNull();
  return avatar!.getAttribute('data-avatar-state');
}

async function openContextMenu(): Promise<void> {
  const card = await screen.findByTestId('agent-list-item');
  const row = card.querySelector<HTMLElement>('[data-agent-panel-row], button');
  expect(row).not.toBeNull();
  await fireEvent.contextMenu(row!);
  await screen.findByRole('menu');
}

function queryStopItem(): HTMLElement | null {
  return screen.queryByRole('menuitem', { name: 'Stop' });
}

describe('AgentCard pending-question avatar state', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-question-${++testAgentSeq}`;
    appStore.dispatch(hudActivated());
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(removeSession(agentId));
    appStore.dispatch(pendingQuestionRecoveryCleared(agentId));
    appStore.dispatch(hudDeactivated());
    vi.restoreAllMocks();
  });

  it('renders the question state when a captured question is pending', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));
    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    render(AgentCard, { props: { agentId, panelRow: true } });

    expect(await findAvatarState()).toBe('question');
  });

  it('does not render the question state when the question was dismissed', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ metadata: { dismissedQuestionsMessageId: QUESTION_MESSAGE_ID } }),
      ]),
    );
    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    render(AgentCard, { props: { agentId, panelRow: true } });

    expect(await findAvatarState()).not.toBe('question');
  });

  it('renders the question state from the daemon marker and transcript without a HUD capture', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({
          status: AgentStatus.Idle,
          messages: [questionMessage()],
          metadata: { pendingQuestionsMessageId: QUESTION_MESSAGE_ID },
        }),
      ]),
    );

    render(AgentCard, { props: { agentId, panelRow: true } });

    expect(await findAvatarState()).toBe('question');
  });

  it('flips to the question state when an out-of-tail marked question is recovered', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({
          status: AgentStatus.Idle,
          messages: [],
          metadata: { pendingQuestionsMessageId: QUESTION_MESSAGE_ID },
        }),
      ]),
    );

    render(AgentCard, { props: { agentId, panelRow: true } });
    expect(await findAvatarState()).not.toBe('question');

    appStore.dispatch(pendingQuestionRecoveryRequested(agentId, QUESTION_MESSAGE_ID));
    appStore.dispatch(
      pendingQuestionRecoverySettled(agentId, QUESTION_MESSAGE_ID, 'found', [WIRE_QUESTION]),
    );

    await expect.poll(findAvatarState).toBe('question');
  });

  it('does not render the question state when no question is pending', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    render(AgentCard, { props: { agentId, panelRow: true } });

    expect(await findAvatarState()).not.toBe('question');
  });

  it('updates the row when a question is captured after render', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    render(AgentCard, { props: { agentId, panelRow: true } });
    expect(await findAvatarState()).not.toBe('question');

    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    await expect.poll(findAvatarState).toBe('question');
  });

  it('keeps failed precedence over a pending question', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ status: AgentStatus.Error })]));
    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    render(AgentCard, { props: { agentId, panelRow: true } });

    expect(await findAvatarState()).toBe('failed');
  });

  it('keeps completed precedence over a pending question on a settled agent', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ status: AgentStatus.RuntimeIdle })]));
    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    render(AgentCard, { props: { agentId, panelRow: true, isCompleted: true } });

    expect(await findAvatarState()).toBe('completed');
  });

  it('lets a pending question win over a running agent', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ status: AgentStatus.Active })]));

    render(AgentCard, { props: { agentId, panelRow: true } });
    expect(await findAvatarState()).toBe('running');

    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    await expect.poll(findAvatarState).toBe('question');
  });

  it.each([
    ['blocker', 'attention-blocker'],
    ['discussion', 'attention-discussion'],
  ] as const)(
    'lets a pending %s request win over a running agent on the panel row',
    async (kind, expected) => {
      appStore.dispatch(
        bulkUpsertSessions([
          makeSession({
            status: AgentStatus.Active,
            isResponding: true,
            attentionRequestKind: kind,
            attentionRequestReason: 'needs a decision',
          }),
        ]),
      );

      render(AgentCard, { props: { agentId, panelRow: true } });

      expect(await findAvatarState()).toBe(expected);
    },
  );

  it('keeps Stop available for a running agent whose avatar shows the question state', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    appStore.dispatch(bulkUpsertSessions([makeSession({ status: AgentStatus.Active })]));
    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    render(AgentCard, { props: { agentId, panelRow: true } });
    expect(await findAvatarState()).toBe('question');

    await openContextMenu();
    const stop = queryStopItem();
    expect(stop).not.toBeNull();

    await fireEvent.click(stop!);

    const stopActions = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === stopAgentSessionRequested.type);
    expect(stopActions).toHaveLength(1);
    expect(stopActions[0].payload).toEqual(['ws-1', agentId]);
  });

  it('does not offer Stop for an idle agent with a pending question', async () => {
    appStore.dispatch(bulkUpsertSessions([makeSession({ status: AgentStatus.Idle })]));
    appStore.dispatch(hudQuestionCaptured(makeCapturedQuestion()));

    render(AgentCard, { props: { agentId, panelRow: true } });
    expect(await findAvatarState()).toBe('question');

    await openContextMenu();
    expect(queryStopItem()).toBeNull();
  });
});
