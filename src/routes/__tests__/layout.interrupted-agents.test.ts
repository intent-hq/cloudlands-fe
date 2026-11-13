/**
 * Regression coverage for the grouped app layout's interrupted-agent modal
 * handlers and its priority over queued release notes. Mounts the real layout
 * with probes for both modals, stubbing the same heavy children and side
 * effects as the HUD gating suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import type { InterruptedAgent } from '$lib/client/app-client';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';
import {
  COLLABORATION_AUTH_CHANNELS,
  INVITE_CONSENT_CHANNELS,
  INVITE_NOTICE_CHANNELS,
  INVITE_PROGRESS_CHANNELS,
} from '$shared/ipc/channels';

// Guard against layout onMount deferred work logging after the last test and
// racing worker teardown (intent-hq/monorepo#1774).
installConsoleTeardownGuard();

const interruptedService = vi.hoisted(() => ({
  resolveInterruptedAgents: vi.fn(async () => {}),
  notifyInterruptedAgentsModalClosed: vi.fn(),
  showHandler: null as ((agents: InterruptedAgent[]) => void) | null,
  LiveAppClientStub: class {},
  installedClient: null as unknown,
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: unknown) => void) => {
      run({ url: { pathname: '/' }, params: {}, route: { id: '/' } });
      return () => {};
    },
  },
}));

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: () => () => {},
}));
vi.mock('$store/renderer/app-store-lifecycle', () => ({
  startAppStoreLifecycle: () => () => {},
}));
vi.mock('$store/renderer/sagas', () => ({ startAllAppSagas: () => [] }));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: () => {} }));
vi.mock('$features/backend/splash-gate', () => ({
  dismissSplashElement: () => {},
  wireSplashGate: () => () => {},
}));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  installInterruptedAgentsService: (
    client: unknown,
    showHandler: (agents: InterruptedAgent[]) => void,
  ) => {
    interruptedService.installedClient = client;
    interruptedService.showHandler = showHandler;
    return () => {};
  },
  notifyInterruptedAgentsModalClosed: interruptedService.notifyInterruptedAgentsModalClosed,
  resolveInterruptedAgents: interruptedService.resolveInterruptedAgents,
}));
vi.mock('$lib/client/live/live-app-client', () => ({
  LiveAppClient: interruptedService.LiveAppClientStub,
}));

vi.mock('$lib/components/modals/InterruptedAgentsModal.svelte', async () => ({
  default: (await import('./mocks/InterruptedAgentsModalProbe.svelte')).default,
}));

vi.mock('$lib/components/layout/WindowTitleBar.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/toast/Toast.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/encoder/EncoderCycleHud.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/CommandPalette.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/AuggieSetupGate.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/debug/DebugPanel.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitCredentialsModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitHubAuthModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/KeyboardShortcutsCheatSheet.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/WorkspaceWarningDialogs.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/ReleaseNotesModal.svelte', async () => ({
  default: (await import('./mocks/ReleaseNotesModalProbe.svelte')).default,
}));
vi.mock('$features/collaboration-auth/renderer/CollaborationSignInModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/InviteConsentModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/InviteNoticeModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/InviteProgressModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/stats/StatsOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonStoppedOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonUpdatingOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/terminal/RootQuakeTerminalOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/FeatureCodeDialog.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/NewSpaceModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/navigation/LinkActionMenu.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/LinkTooltip.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import { showReleaseNotesSuccess } from '$store/renderer/slices/release-notes/release-notes-slice';
import Layout from '../(app)/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="interrupted-children">content</div>',
}));

type ModalProps = {
  onResumeSelected?: (resumeIds: string[], abandonIds: string[]) => Promise<void> | void;
  onAbandonAll?: (abandonIds: string[]) => Promise<void> | void;
  close: (reason?: 'dismissed' | 'resolved') => void;
  resume: (resumeIds: string[], abandonIds: string[]) => void;
  abandon: (abandonIds: string[]) => void;
};

type ReleaseNotesModalProps = {
  open: boolean;
  releaseNotes: typeof NOTES | null;
  close: () => void;
};

const AGENTS: InterruptedAgent[] = [
  {
    agentId: 'agent-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace One',
    agentName: 'Agent One',
    prevStatus: 'active',
    interruptedAt: '2026-08-25T00:00:00Z',
  },
];

const NOTES = {
  version: '2.3.0',
  notes: '## What changed',
  url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.3.0',
};

function modalProps(): ModalProps {
  return (globalThis as Record<string, unknown>).__interruptedAgentsModalProps as ModalProps;
}

function releaseNotesModalProps(): ReleaseNotesModalProps {
  return (globalThis as Record<string, unknown>).__releaseNotesModalProps as ReleaseNotesModalProps;
}

async function renderLayout() {
  render(Layout, { props: { children: childrenSnippet } });
  await waitFor(() => expect(interruptedService.showHandler).not.toBeNull());
}

function showInterruptedAgents(agents: InterruptedAgent[]) {
  interruptedService.showHandler?.(agents);
}

function queueReleaseNotes() {
  appStore.dispatch(showReleaseNotesSuccess(NOTES));
}

const invitationDialogs = [
  { name: 'progress', channels: INVITE_PROGRESS_CHANNELS, payload: { phase: 'connecting' } },
  {
    name: 'sign-in',
    channels: COLLABORATION_AUTH_CHANNELS,
    payload: { request: { scope: 'workspace' } },
  },
  {
    name: 'consent',
    channels: INVITE_CONSENT_CHANNELS,
    payload: { mode: 'confirm', workspaceTitle: 'Design review', hostLabel: 'Studio' },
  },
  {
    name: 'notice',
    channels: INVITE_NOTICE_CHANNELS,
    payload: { kind: 'failed', reason: 'expired' },
  },
];

function emitInvitationEvent(channel: string, payload: unknown) {
  const api = window.electronAPI as unknown as {
    _getRegisteredHandlers(channel: string): Array<(payload: unknown) => void>;
  };
  const handler = api._getRegisteredHandlers(channel).at(-1);
  expect(handler).toBeTypeOf('function');
  handler!(payload);
}

describe('+layout.svelte interrupted-agents resolve handlers', () => {
  beforeEach(() => {
    appStore.init();
    interruptedService.resolveInterruptedAgents.mockClear();
    interruptedService.showHandler = null;
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    delete (globalThis as Record<string, unknown>).__interruptedAgentsModalProps;
    delete (globalThis as Record<string, unknown>).__releaseNotesModalProps;
  });

  it('installs the interrupted-agents service on the live daemon client', async () => {
    await renderLayout();

    expect(interruptedService.installedClient).toBeInstanceOf(interruptedService.LiveAppClientStub);
  });

  it.each(['dismissed', 'resolved'] as const)(
    'forwards the recovery close reason: %s',
    async (reason) => {
      await renderLayout();
      showInterruptedAgents(AGENTS);
      modalProps().close(reason);
      expect(interruptedService.notifyInterruptedAgentsModalClosed).toHaveBeenCalledWith(reason);
    },
  );

  it('routes resume-selected through resolveInterruptedAgents (stops the watcher)', async () => {
    await renderLayout();

    await modalProps().onResumeSelected?.(['agent-1'], ['agent-2']);

    expect(interruptedService.resolveInterruptedAgents).toHaveBeenCalledWith(
      expect.any(interruptedService.LiveAppClientStub),
      ['agent-1'],
      ['agent-2'],
    );
  });

  it('routes abandon-all through resolveInterruptedAgents (stops the watcher)', async () => {
    await renderLayout();

    await modalProps().onAbandonAll?.(['agent-1', 'agent-2']);

    expect(interruptedService.resolveInterruptedAgents).toHaveBeenCalledWith(
      expect.any(interruptedService.LiveAppClientStub),
      [],
      ['agent-1', 'agent-2'],
    );
  });

  it('gives interrupted-agent recovery priority without consuming queued release notes', async () => {
    await renderLayout();
    showInterruptedAgents(AGENTS);
    queueReleaseNotes();

    await waitFor(() => expect(screen.getByTestId('interrupted-agents-modal-marker')).toBeTruthy());
    expect(screen.queryByTestId('release-notes-modal-host')).toBeNull();
    expect(screen.queryByTestId('release-notes-modal-marker')).toBeNull();
    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
  });

  it('hands queued release notes off immediately after interrupted agents are abandoned', async () => {
    await renderLayout();
    showInterruptedAgents(AGENTS);
    queueReleaseNotes();

    modalProps().abandon(['agent-1']);

    await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());
    expect(screen.queryByTestId('interrupted-agents-modal-marker')).toBeNull();
    expect(screen.getAllByTestId('release-notes-modal-marker')).toHaveLength(1);
    expect(interruptedService.resolveInterruptedAgents).toHaveBeenCalledWith(
      expect.anything(),
      [],
      ['agent-1'],
    );
  });

  it('releases queued notes when interrupted-agent reconciliation becomes empty', async () => {
    await renderLayout();
    showInterruptedAgents(AGENTS);
    queueReleaseNotes();

    showInterruptedAgents([]);

    await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());
    expect(screen.queryByTestId('interrupted-agents-modal-marker')).toBeNull();
  });

  it('shows release notes normally when there are no interrupted agents', async () => {
    await renderLayout();
    queueReleaseNotes();

    await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());
    expect(releaseNotesModalProps().open).toBe(true);
  });

  it('does not resurrect dismissed release notes after reconnect reconciliation', async () => {
    await renderLayout();
    queueReleaseNotes();
    await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());

    releaseNotesModalProps().close();
    await waitFor(() => expect(screen.queryByTestId('release-notes-modal-marker')).toBeNull());
    expect(appStore.state.releaseNotes.showModal).toBe(false);

    showInterruptedAgents(AGENTS);
    showInterruptedAgents([]);

    await waitFor(() => expect(screen.queryByTestId('interrupted-agents-modal-marker')).toBeNull());
    expect(screen.queryByTestId('release-notes-modal-marker')).toBeNull();
    expect(appStore.state.releaseNotes.showModal).toBe(false);
  });

  it.each(invitationDialogs)(
    'suspends open release notes during invitation $name without consuming them',
    async ({ channels, payload }) => {
      await renderLayout();
      queueReleaseNotes();
      await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());

      emitInvitationEvent(channels.SHOW, { requestId: 'invitation', ...payload });

      await waitFor(() => expect(screen.queryByTestId('release-notes-modal-host')).toBeNull());
      expect(appStore.state.releaseNotes.showModal).toBe(true);
      expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);

      emitInvitationEvent(channels.DISMISS, { requestId: 'previous-invitation' });
      expect(screen.queryByTestId('release-notes-modal-host')).toBeNull();
      emitInvitationEvent(channels.DISMISS, { requestId: 'invitation' });

      await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());
    },
  );

  it('keeps incoming release notes queued across invitation dialog handoffs', async () => {
    await renderLayout();
    emitInvitationEvent(INVITE_PROGRESS_CHANNELS.SHOW, {
      requestId: 'connecting',
      phase: 'connecting',
    });
    queueReleaseNotes();
    await waitFor(() => expect(screen.queryByTestId('release-notes-modal-host')).toBeNull());

    emitInvitationEvent(COLLABORATION_AUTH_CHANNELS.SHOW, {
      requestId: 'sign-in',
      request: { scope: 'workspace' },
    });
    emitInvitationEvent(INVITE_PROGRESS_CHANNELS.DISMISS, { requestId: 'connecting' });
    await waitFor(() => expect(screen.queryByTestId('release-notes-modal-host')).toBeNull());

    emitInvitationEvent(INVITE_NOTICE_CHANNELS.SHOW, {
      requestId: 'failed',
      kind: 'failed',
      reason: 'expired',
    });
    emitInvitationEvent(COLLABORATION_AUTH_CHANNELS.DISMISS, { requestId: 'sign-in' });
    await waitFor(() => expect(screen.queryByTestId('release-notes-modal-host')).toBeNull());

    emitInvitationEvent(INVITE_NOTICE_CHANNELS.DISMISS, { requestId: 'failed' });
    await waitFor(() => expect(screen.getByTestId('release-notes-modal-marker')).toBeTruthy());
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
  });
});
