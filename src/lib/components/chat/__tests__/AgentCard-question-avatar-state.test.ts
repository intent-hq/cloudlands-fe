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
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  hudActivated,
  hudDeactivated,
  hudQuestionCaptured,
  type HudCapturedQuestion,
} from '$store/renderer/slices/hud/hud-slice';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

// Distinct agent id per test: the configured store is a process singleton.
let testAgentSeq = 0;
let agentId = '';

const QUESTION_MESSAGE_ID = 'msg-question-1';

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

describe('AgentCard pending-question avatar state', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-question-${++testAgentSeq}`;
    appStore.dispatch(hudActivated());
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
    appStore.dispatch(hudDeactivated());
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
});
