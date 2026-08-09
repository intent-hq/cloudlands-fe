/**
 * Regression test for intent-hq/monorepo#1727: the layout's interrupted-agents
 * resume/abandon handlers must go through `resolveInterruptedAgents()` so the
 * service's cross-window watcher is stopped (pre-#584 behaviour). Mounts the
 * real root `+layout.svelte` with a probe standing in for
 * `InterruptedAgentsModal` that publishes the handler props the layout wires
 * up, stubbing the same heavy children/side effects as the HUD gating suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const interruptedService = vi.hoisted(() => ({
  resolveInterruptedAgents: vi.fn(async () => {}),
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
vi.mock('$store/renderer/sagas', () => ({ startAllAppSagas: () => [] }));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: () => {} }));
vi.mock('$features/backend/splash-gate', () => ({ wireSplashGate: () => () => {} }));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  installInterruptedAgentsService: () => () => {},
  notifyInterruptedAgentsModalClosed: () => {},
  resolveInterruptedAgents: interruptedService.resolveInterruptedAgents,
}));
vi.mock('$lib/client/live/live-app-client', () => ({ LiveAppClient: class {} }));

vi.mock('$lib/components/modals/InterruptedAgentsModal.svelte', async () => ({
  default: (await import('./mocks/InterruptedAgentsModalProbe.svelte')).default,
}));

vi.mock('$lib/components/layout/sidebar-nav', async () => ({
  SidebarNav: (await import('./mocks/Marker.svelte')).default,
  SidebarPanel: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/WindowTitleBar.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/UpdateDownloadIndicator.svelte', async () => ({
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
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/workspace/SpacesSwitcherOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/stats/StatsOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonStoppedOverlay.svelte', async () => ({
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
import Layout from '../+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="interrupted-children">content</div>',
}));

type ModalProps = {
  onResumeSelected?: (resumeIds: string[], abandonIds: string[]) => Promise<void> | void;
  onAbandonAll?: (abandonIds: string[]) => Promise<void> | void;
};

function modalProps(): ModalProps {
  return (globalThis as Record<string, unknown>).__interruptedAgentsModalProps as ModalProps;
}

describe('+layout.svelte interrupted-agents resolve handlers', () => {
  beforeEach(() => {
    appStore.init();
    interruptedService.resolveInterruptedAgents.mockClear();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    delete (globalThis as Record<string, unknown>).__interruptedAgentsModalProps;
  });

  it('routes resume-selected through resolveInterruptedAgents (stops the watcher)', async () => {
    render(Layout, { props: { children: childrenSnippet } });

    await modalProps().onResumeSelected?.(['agent-1'], ['agent-2']);

    expect(interruptedService.resolveInterruptedAgents).toHaveBeenCalledWith(
      expect.anything(),
      ['agent-1'],
      ['agent-2'],
    );
  });

  it('routes abandon-all through resolveInterruptedAgents (stops the watcher)', async () => {
    render(Layout, { props: { children: childrenSnippet } });

    await modalProps().onAbandonAll?.(['agent-1', 'agent-2']);

    expect(interruptedService.resolveInterruptedAgents).toHaveBeenCalledWith(
      expect.anything(),
      [],
      ['agent-1', 'agent-2'],
    );
  });
});
