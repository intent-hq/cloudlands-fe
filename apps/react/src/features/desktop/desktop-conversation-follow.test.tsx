import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopConversation } from './desktop-conversation';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { openWorkspaceTab } from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import {
  resetLayout,
  openTab,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import {
  chatTrackedWorkspaceSet,
  chatLiveStreamPhaseChanged,
  transcriptHydrationSettled,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { runChatDrafts } from '../../../../../src/store/renderer/slices/chat-drafts/sagas/chat-drafts-worker';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { MessageComposerProps } from '@/components/ui/message-composer';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type Workspace, type AgentSession } from '$shared/types';
const ui = vi.hoisted(() => ({
  props: undefined as MessageComposerProps | undefined,
  options: undefined as any,
  following: true,
  followToBottom: vi.fn(),
}));
vi.mock('./desktop-composer', () => ({
  DesktopComposer: (props: MessageComposerProps) => {
    ui.props = props;
    return <textarea />;
  },
}));
vi.mock('$lib/utils/smartScroll', () => ({
  followBottom: (_element: HTMLElement, opts: any) => {
    ui.options = opts;
    ui.following = opts.follow;
    return {
      update: (next: any) => {
        ui.options = next;
        ui.following = next.follow;
      },
      destroy: vi.fn(),
    };
  },
  followToBottom: ui.followToBottom,
}));
vi.mock('@/features/agent/chat-runtime', async () => {
  const { createChatSubmission } =
    await import('../../../../../src/features/agent/chat-submission-factory');
  const { createAgentSubmissionAdmitter } =
    await import('../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-admission-factory');
  return {
    chatSubmission: createChatSubmission(
      createAgentSubmissionAdmitter(() => ({ key: 'probe', isCurrent: () => true })),
    ),
    submissionRetry: { requestChatMessageRetry: vi.fn() },
  };
});
const ws = WorkspaceId('reviewer-scroll'),
  agent = AgentId('reviewer-scroll-agent');
let dispose: () => void,
  stop: () => void,
  host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  panel: string,
  tab: string;
const settle = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial = createAdmittedLegacyPrincipal();
  initial.principal.snapshot!.capabilities.submissionCorrelation = 1;
  dispose = store.init(initial);
  store.dispatch(setWorkspaceEntity({ id: ws, title: 'Review', myRole: 'owner' } as Workspace));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agent,
        workspaceId: ws,
        name: 'Review',
        status: AgentStatus.RuntimeIdle,
        messages: [],
        createdAt: '2026-10-15T18:00:00Z',
        updatedAt: '2026-10-15T18:00:00Z',
        backendSessionId: null,
      } as AgentSession,
    ]),
  );
  store.dispatch(openWorkspaceTab(ws));
  store.dispatch(resetLayout(ws));
  store.dispatch(
    openTab(ws, {
      type: 'agent',
      agentId: agent,
      workspaceId: ws,
      title: 'Review',
      closable: true,
    }),
  );
  const layout = selectDesktopLayout.select(store.state, ws);
  panel = layout.focusedPanelId!;
  tab = layout.panels[panel].activeTabId!;
  store.dispatch(chatTrackedWorkspaceSet(agent, ws));
  store.dispatch(chatLiveStreamPhaseChanged(agent, 'live'));
  store.dispatch(transcriptHydrationSettled(agent));
  stop = store.runSaga(function* () {
    yield* runChatDrafts(
      {
        get: async () => ({ text: '', attachments: [], updatedAt: '' }),
        set: async () => ({ ok: true as const, updatedAt: '' }),
        clear: async () => ({ ok: true as const }),
      },
      () => () => true,
    );
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  ui.props = undefined;
  ui.followToBottom.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
it('re-enables the canonical follower when an ordinary desktop Send is admitted', async () => {
  await act(async () =>
    root.render(
      <DesktopConversation
        workspaceId={ws}
        agentId={agent}
        panelId={panel}
        tabId={tab}
        active
        onUnavailable={() => {}}
      />,
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.disabled).toBe(false);
  });
  await act(async () => ui.props!.onValueChange!('new prompt'));
  await settle();
  // The DOM scroll helper reports real user departure through its public callback.
  // No jsdom geometry is assigned or asserted: this checks owner-to-helper wiring only.
  ui.following = false;
  ui.options.onFollowChange(false);
  await act(async () => ui.props!.onSend!('new prompt', []));
  const entry = store.state.pendingSubmissions.byAgentId[agent];
  expect(getItems(entry!.submissions)).toHaveLength(1);
  expect(ui.following || ui.followToBottom.mock.calls.length > 0).toBe(true);
});
