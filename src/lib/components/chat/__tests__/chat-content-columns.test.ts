/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage, QueuedMessage } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

import { CHAT_TRANSCRIPT_OVERFLOW_CLASS } from '../chat-queue-edge-layout';
import type { PinnedPromptTrackerOptions } from '../pinned-prompt';
import { resetScaffold, scaffold } from './mocks/chat-panel-render-scaffold';

const pinnedTracker = vi.hoisted(() => ({ options: null as PinnedPromptTrackerOptions | null }));

vi.mock('$store/renderer/store', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).appStore(),
);
vi.mock('$features/layout/panel-layout-adapter', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).panelLayoutAdapter(),
);
vi.mock('$lib/client', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).appClient(),
);
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
  listenSync: vi.fn(() => () => {}),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/SlotOnly.svelte')).default }));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).agentSessionSelectors(),
);
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).chatStateSelectors(),
);
vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).unreadTrackingSelectors(),
);
vi.mock('$store/renderer/slices/agent-queue/agent-queue-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).agentQueueSelectors(),
);
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).transientUiSelectors(),
);
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).providerCatalogSelectors(),
);
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectAllTabs: [] }),
);
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectNoteById: null }),
);
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectWorkspaceTasks: [],
    selectWorkspaceTasksInitialized: false,
  }),
);
vi.mock('$store/renderer/slices/presence/presence-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectAgentTypingPeople: [],
    selectPresenceOwnPrincipalId: null,
  }),
);
vi.mock('$store/renderer/slices/multi-panel-context/multi-panel-context-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectCheckedPanels: [],
    selectPanels: [],
    selectCheckedSelections: [],
  }),
);
vi.mock('$store/renderer/slices/terminals/terminals-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectWorkspaceSetupTerminal: null }),
);
vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectWorkspaceNavigationMainPanel: { type: 'empty' },
  }),
);
vi.mock(
  '$store/renderer/slices/task-agent-associations/task-agent-associations-selectors',
  async () =>
    (await import('./mocks/chat-panel-render-scaffold')).stub({ selectTasksForAgent: [] }),
);
vi.mock('$store/renderer/slices/permission/permission-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({ selectPermissionRequests: [] }),
);
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectChatAuroraEnabled: false,
    selectIsAgentMonospace: false,
  }),
);
vi.mock('$store/renderer/slices/specialists/specialists-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).stub({
    selectSpecialists: [],
    selectEffectiveBehaviorPrompt: '',
    selectEffectiveModel: '',
  }),
);
// Pass-through wrapper around the real tracker that captures its options so
// tests can drive `onChange` (set a pinned prompt) directly.
vi.mock('../pinned-prompt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pinned-prompt')>();
  return {
    ...actual,
    trackPinnedPrompt: (container: HTMLElement, options: PinnedPromptTrackerOptions) => {
      pinnedTracker.options = options;
      const real = actual.trackPinnedPrompt(container, options);
      return {
        update: (next: PinnedPromptTrackerOptions) => {
          pinnedTracker.options = next;
          real.update(next);
        },
        destroy: real.destroy,
      };
    },
  };
});
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/QueueRegionRichInput.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../EventWakeupBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../StreamingStatus.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../LiveStreamPhaseIndicator.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../RegularAgentWelcome.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../SuggestedPrompts.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../questions/QuestionWizard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatFileChangesSummary.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AutoCommitStatus.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../MonitoredPrsRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
// Bindable stand-in: ChatPanel binds the card's `visible` flag into its own
// composer-layer state, so the mock must be able to drive that binding.
vi.mock('../EventSubscriptionsCard.svelte', async () => ({
  default: (await import('./mocks/BindableVisibleUtility.svelte')).default,
}));
vi.mock('../AttentionRequestBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../LazyTurn.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../InlinePermissionRequest.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AuroraBackground.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ModelChangeNotice.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$features/onboarding/messages/WorkspaceSetupCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/panel-find-bar', async () => ({
  PanelFindBar: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/skeleton', async () => ({
  Skeleton: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatPanel from '../ChatPanel.svelte';

const workspace = { id: 'ws-1', title: 'Workspace' } as never;
const userMessage: AgentMessage = {
  id: 'user-1',
  role: 'user',
  timestamp: '2026-01-01T10:00:00.000Z',
  contentBlocks: [{ type: 'text', text: 'Inspect the panel' }],
} as unknown as AgentMessage;
const queuedMessage: QueuedMessage = {
  id: 'queued-1',
  content: 'Follow up after this turn',
  queuedAt: '2026-01-01T10:01:00.000Z',
};

function classTokens(element: Element | null) {
  return new Set(element?.className.split(/\s+/) ?? []);
}

function hasClasses(element: Element | null, classes: string) {
  const tokens = classTokens(element);
  return classes.split(/\s+/).every((token) => tokens.has(token));
}

function byTestId(root: ParentNode, testId: string) {
  return root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

describe('chat content column contracts', () => {
  beforeEach(() => {
    resetScaffold();
    pinnedTracker.options = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function renderPanel(panelWorkspace: unknown = workspace) {
    const view = render(ChatPanel, {
      props: { workspace: panelWorkspace as never, agentId: 'agent-1', isActive: true },
    });
    await tick();
    return view.container;
  }

  it('caps the transcript without changing the scroll owner', async () => {
    scaffold.agentMessages = [userMessage];
    const container = await renderPanel();

    const viewport = byTestId(container, 'chat-transcript-scroll-viewport')!;
    const inner = byTestId(container, 'chat-transcript-inner')!;
    expect(viewport.contains(inner)).toBe(true);
    expect(hasClasses(inner, 'conversation-column chat-content-measure w-full min-w-0')).toBe(true);
    expect(classTokens(inner).has('overflow-y-auto')).toBe(false);
    expect(inner.querySelector('[data-message-id="user-1"]')).not.toBeNull();
  });

  it('scrolls the transcript viewport vertically only (intent-hq/monorepo#2969)', async () => {
    const container = await renderPanel();

    const viewport = byTestId(container, 'chat-transcript-scroll-viewport');
    expect(hasClasses(viewport, `flex-1 ${CHAT_TRANSCRIPT_OVERFLOW_CLASS}`)).toBe(true);
    expect(CHAT_TRANSCRIPT_OVERFLOW_CLASS).toContain('overflow-y-auto');
    expect(CHAT_TRANSCRIPT_OVERFLOW_CLASS).toContain('overflow-x-hidden');
  });

  it('keeps the prompt layer full width around one capped, inset composer lane', async () => {
    const container = await renderPanel();

    const layer = byTestId(container, 'composer-prompt-layer')!;
    expect(hasClasses(layer, 'composer-prompt-layer relative z-10 w-full')).toBe(true);
    expect(layer.getAttribute('data-has-transcript-utility')).toBe('false');
    expect(layer.style.paddingInlineEnd).toBe('0px');
    const lane = byTestId(layer, 'chat-composer-lane')!;
    expect(
      hasClasses(lane, 'composer-prompt-lane chat-content-measure mx-auto w-full min-w-0'),
    ).toBe(true);
    const controls = byTestId(lane, 'chat-composer-controls-inner')!;
    expect(controls.contains(byTestId(container, 'question-composer'))).toBe(true);
    expect(controls.contains(byTestId(container, 'mock-rich-input'))).toBe(true);
  });

  it('mirrors the transcript utility visibility onto the composer prompt layer', async () => {
    const container = await renderPanel();

    const layer = byTestId(container, 'composer-prompt-layer')!;
    const utility = byTestId(container, 'mock-transcript-utility')!;
    expect(byTestId(container, 'transcript-utility-stack')!.contains(utility)).toBe(true);
    expect(layer.getAttribute('data-has-transcript-utility')).toBe('false');

    await fireEvent.click(utility);
    expect(utility.getAttribute('data-visible')).toBe('true');
    expect(layer.getAttribute('data-has-transcript-utility')).toBe('true');

    await fireEvent.click(utility);
    expect(utility.getAttribute('data-visible')).toBe('false');
    expect(layer.getAttribute('data-has-transcript-utility')).toBe('false');
  });

  it('caps the pinned prompt lane while its overlay host stays full width', async () => {
    scaffold.agentMessages = [userMessage];
    const container = await renderPanel();

    const host = byTestId(container, 'pinned-prompt-overlay-host')!;
    expect(host.style.paddingInlineEnd).toBe('0px');
    expect(byTestId(host, 'pinned-prompt-overlay-lane')).toBeNull();

    pinnedTracker.options!.onChange({ id: userMessage.id, message: userMessage, surface: 'user' });
    await tick();

    const lane = byTestId(host, 'pinned-prompt-overlay-lane');
    expect(hasClasses(lane, 'chat-content-measure mx-auto w-full min-w-0')).toBe(true);
    expect(classTokens(host).has('chat-content-measure')).toBe(false);
  });

  it('renders queued-message surfaces inside the composer lane', async () => {
    scaffold.queuedMessages = [queuedMessage];
    const container = await renderPanel();

    const queue = byTestId(container, 'queued-messages-container')!;
    expect(byTestId(container, 'mock-queue-region')!.contains(queue)).toBe(true);
    expect(byTestId(container, 'chat-composer-lane')!.contains(queue)).toBe(true);
    expect(byTestId(container, 'queued-message-utility-area')).toBeNull();
    expect(container.querySelector('.queued-message-utility-wide')).toBeNull();
  });

  it('opens a blank Chief thread on the starter prompts instead of an empty state', async () => {
    const chiefIntro = m.chat_chiefEmptyState_intro_label();

    const regular = await renderPanel();
    expect(regular.textContent).not.toContain(chiefIntro);
    cleanup();

    const chief = await renderPanel({ id: CHIEF_WORKSPACE_ID, title: 'Chief' });
    expect(byTestId(chief, 'chat-transcript-inner')!.textContent).toContain(chiefIntro);
  });
});
