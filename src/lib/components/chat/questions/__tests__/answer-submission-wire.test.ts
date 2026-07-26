/**
 * Agent Q&A answer-submission wire tests (spec "Wire contract"):
 *
 * 1. Exact `agent.sendMessage` request shape — completing the wizard sends
 *    ONE plain-text user message of flattened `Q:`/`A:` pairs (multi-select
 *    comma-joined, free-form `(Other) `-prefixed, skips as `(skipped)`) with
 *    NO messageMetadata, driven through the REAL store + chat-send
 *    middleware + agent-stream-lifecycle with only the BackendTransport seam
 *    mocked (PROTOCOL.md §5.5 payloads).
 * 2. PROTOCOL-shaped transcripts drive the wizard transitions: pending
 *    before the answer message exists, superseded (wizard closed, composer
 *    restored) once it does — including session-restore rehydration in both
 *    states. Questions are wizard-only: they never render in the transcript.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { backendRequestMock } = vi.hoisted(() => ({
  backendRequestMock: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: backendRequestMock,
  backendSubscribe: vi.fn(async () => ({})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
  BackendError: class BackendError extends Error {},
}));

import { fireEvent, render, screen } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  clearAllSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import QuestionWizard from '../QuestionWizard.svelte';
import { flattenAnswersToMessage, type QuestionAnswer } from '../answer-message';
import { derivePendingQuestions } from '../pending-questions';
import { QUESTION_RESOURCE_MIME_TYPE, type Question } from '$shared/types/question-resource';
import { AgentStatus } from '$shared/types';
import type { AgentMessage, AgentSession, ContentBlock, Workspace } from '$shared/types';

const WS = 'c6df5dce-f8c6-44fe-8a2d-227a8815f2af';
const AGENT = 'agent-373f33d3-0a26-4b8b-9ecf-f114bfa47df4';

const SINGLE: Question = {
  attachmentId: 'tar-aaa111bbb222',
  header: 'Token storage',
  question: 'Where should refresh tokens persist?',
  options: [
    { label: 'OS keychain', description: 'Keytar via safeStorage.' },
    { label: 'Encrypted file', description: 'AES-256 blob.' },
  ],
  multiSelect: false,
};

const MULTI: Question = {
  attachmentId: 'tar-ccc333ddd444',
  header: 'Scope',
  question: 'Which surfaces should the new auth flow cover?',
  options: [
    { label: 'Desktop app', description: 'Primary surface.' },
    { label: 'CLI', description: 'Headless login.' },
    { label: 'Web dashboard', description: 'Old cookie flow.' },
  ],
  multiSelect: true,
};

const LAST: Question = {
  attachmentId: 'tar-eee555fff666',
  header: 'Migration',
  question: 'Migrate existing sessions or force re-login?',
  options: [{ label: 'Migrate silently' }, { label: 'Force re-login' }],
  multiSelect: false,
};

/** Question resource block exactly as chat.subscribe delivers it (PROTOCOL §7.1). */
function questionBlock(q: Question): ContentBlock {
  return {
    type: 'resource',
    resource: {
      uri: `intent-question://${q.attachmentId}`,
      name: q.header,
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: JSON.stringify(q),
    },
  } as unknown as ContentBlock;
}

function assistantMessage(blocks: ContentBlock[], id = 'msg-a1'): AgentMessage {
  return {
    id,
    role: 'assistant',
    contentBlocks: blocks,
    timestamp: new Date().toISOString(),
  } as AgentMessage;
}

function userMessage(text: string, id = 'msg-u1'): AgentMessage {
  return {
    id,
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date().toISOString(),
  } as AgentMessage;
}

function answer(question: Question, partial: Partial<QuestionAnswer> = {}): QuestionAnswer {
  return { question, selectedLabels: [], freeText: '', skipped: false, ...partial };
}

describe('flattenAnswersToMessage (wire contract format)', () => {
  it('flattens answers into blank-line-separated Q:/A: pairs (spec example)', () => {
    const flattened = flattenAnswersToMessage([
      answer(
        { ...SINGLE, question: 'Which authentication method should the new endpoint use?' },
        { selectedLabels: ['OAuth'] },
      ),
      answer(
        { ...SINGLE, question: 'Which database?' },
        { freeText: 'Use both, key for internal' },
      ),
      answer({ ...SINGLE, question: 'Deploy target?' }, { skipped: true }),
    ]);
    expect(flattened).toBe(
      'Q: Which authentication method should the new endpoint use?\n' +
        'A: OAuth\n' +
        '\n' +
        'Q: Which database?\n' +
        'A: (Other) Use both, key for internal\n' +
        '\n' +
        'Q: Deploy target?\n' +
        'A: (skipped)',
    );
  });

  it('comma-joins multi-select answers and appends the (Other) free-form reply', () => {
    const flattened = flattenAnswersToMessage([
      answer(MULTI, { selectedLabels: ['Desktop app', 'CLI'], freeText: 'and the docs site' }),
    ]);
    expect(flattened).toBe(
      `Q: ${MULTI.question}\nA: Desktop app, CLI, (Other) and the docs site`,
    );
  });

  it('reports an empty non-skipped answer as (skipped)', () => {
    expect(flattenAnswersToMessage([answer(SINGLE)])).toBe(
      `Q: ${SINGLE.question}\nA: (skipped)`,
    );
  });
});

/** Daemon agent projection exactly as `agent.get` returns it for a fresh agent. */
const daemonPendingAgent = {
  id: AGENT,
  workspaceId: WS,
  name: 'Coordinator',
  nameExplicitlySet: true,
  status: 'pending',
  provider: 'auggie',
  model: 'opus4.7',
  isActive: false,
  isProcessing: false,
  isResponding: false,
  isStreaming: false,
  isWaitingOnTool: false,
  isWaitingForOtherAgents: false,
  waitingForAgentIds: [],
  messageCount: 0,
  metadata: { isBackground: false },
  createdAt: '2026-07-03T14:35:35.924892Z',
  updatedAt: '2026-07-03T14:35:35.924892Z',
  lastActivity: '2026-07-03T14:35:35.924892Z',
};

function workspace(): Workspace {
  return {
    id: WS,
    title: 'intent',
    branch: 'main',
    status: 'active',
    path: '/Users/clement/src/intent',
    repositoryPath: '/Users/clement/src/intent',
    createdAt: '2026-06-24T13:18:22.961Z',
    updatedAt: '2026-06-24T13:18:22.961Z',
    changesets: [],
    timeline: [],
    conversationInfo: [],
  } as unknown as Workspace;
}

describe('wizard completion → agent.sendMessage wire shape', () => {
  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => {
    backendRequestMock.mockReset();
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.get') return { agent: daemonPendingAgent };
      if (method === 'agent.sendMessage') {
        return { success: true, queued: false, messageId: 'm-1' };
      }
      return {};
    });
    appStore.dispatch(setWorkspaceEntity(workspace()));
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT,
          backendSessionId: null,
          workspaceId: WS,
          name: 'Coordinator',
          status: AgentStatus.Pending,
          messages: [],
          createdAt: '2026-07-03T14:35:35.924Z',
          updatedAt: '2026-07-03T14:35:35.924Z',
        } as unknown as AgentSession,
      ]),
    );
  });
  afterEach(() => {
    appStore.dispatch(clearAllSessions());
  });

  it('sends ONE flattened plain-text user message with no messageMetadata', async () => {
    // Questions come off a PROTOCOL-shaped transcript, exactly as ChatPanel
    // derives them for the wizard.
    const pending = derivePendingQuestions(
      [assistantMessage([questionBlock(SINGLE), questionBlock(MULTI), questionBlock(LAST)])],
      false,
    );
    expect(pending).not.toBeNull();

    // onComplete mirrors ChatPanel's handleQuestionWizardComplete glue:
    // flatten, then dispatch through the ordinary send path.
    render(QuestionWizard, {
      props: {
        questions: pending!.questions,
        onComplete: (answers: QuestionAnswer[]) => {
          appStore.dispatch(
            sendMessage(AGENT, { wsId: WS, text: flattenAnswersToMessage(answers) }),
          );
        },
      },
    });

    // Q1 single-select: advances on selection.
    await fireEvent.click(screen.getByText('OS keychain'));
    // Q2 multi-select: toggle two options, add an (Other) reply, Next.
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByText('CLI'));
    await fireEvent.input(screen.getByPlaceholderText('Or type your own answer…'), {
      target: { value: 'and the docs site' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Q3: explicit Skip completes the wizard.
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));

    await vi.waitFor(() => {
      expect(backendRequestMock.mock.calls.map((c) => c[0])).toContain('agent.sendMessage');
    });

    const sendCall = backendRequestMock.mock.calls.find((c) => c[0] === 'agent.sendMessage')!;
    const params = sendCall[1] as Record<string, unknown>;
    expect(params.agentId).toBe(AGENT);
    expect(params.workspaceId).toBe(WS);
    // The EXACT flattened text — nothing prepended or appended.
    expect(params.content).toBe(
      `Q: ${SINGLE.question}\n` +
        'A: OS keychain\n' +
        '\n' +
        `Q: ${MULTI.question}\n` +
        'A: Desktop app, CLI, (Other) and the docs site\n' +
        '\n' +
        `Q: ${LAST.question}\n` +
        'A: (skipped)',
    );
    // A completely ordinary user message: no metadata of any kind.
    expect(params).not.toHaveProperty('messageMetadata');
    expect(params).not.toHaveProperty('metadata');
    // Exactly ONE send for the whole question set.
    expect(
      backendRequestMock.mock.calls.filter((c) => c[0] === 'agent.sendMessage'),
    ).toHaveLength(1);
  }, 30000);
});

describe('transcript-driven wizard transitions', () => {
  const questionMsg = assistantMessage([questionBlock(SINGLE), questionBlock(MULTI)]);
  const answerText = flattenAnswersToMessage([
    answer(SINGLE, { selectedLabels: ['OS keychain'] }),
    answer(MULTI, { skipped: true }),
  ]);

  it('pends before the answer message exists; superseded once it lands', () => {
    expect(derivePendingQuestions([questionMsg], false)).not.toBeNull();
    // The flattened answer message arrives as an ordinary user message —
    // wizard closes and the composer restores (derivation goes null).
    expect(derivePendingQuestions([questionMsg, userMessage(answerText)], false)).toBeNull();
  });

  it('session restore re-presents unanswered questions but not answered ones', () => {
    // Restored transcript WITHOUT the answer message: questions pend again
    // (no draft persistence — derivation reads only the transcript).
    const unanswered: AgentMessage[] = [userMessage('kick off', 'msg-u0'), questionMsg];
    const pending = derivePendingQuestions(unanswered, false);
    expect(pending).not.toBeNull();
    expect(pending!.questions.map((q) => q.header)).toEqual(['Token storage', 'Scope']);

    // Restored transcript WITH the flattened answer message: superseded.
    const answered: AgentMessage[] = [
      userMessage('kick off', 'msg-u0'),
      questionMsg,
      userMessage(answerText, 'msg-u2'),
    ];
    expect(derivePendingQuestions(answered, false)).toBeNull();
  });
});
