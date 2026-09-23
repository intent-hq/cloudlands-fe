/**
 * The app shell's outer inset (`pl-2` / `pb-2`) lives on the frame row, which
 * never shrinks, so the bottom gap survives when the workspace frame's flex
 * item is squeezed; the frame itself only carries the trailing `mr-2`. The
 * shell is rendered with every heavy child replaced by a marker so only the
 * frame geometry classes are under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const mockPage = vi.hoisted(() => ({ pathname: '/' }));
const mocks = vi.hoisted(() => ({
  dismissSplashElement: vi.fn(),
  startAppStoreLifecycle: vi.fn(() => () => {}),
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: unknown) => void) => {
      run({
        url: { pathname: mockPage.pathname },
        params: {},
        route: { id: mockPage.pathname },
      });
      return () => {};
    },
  },
}));

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: () => () => {},
}));
vi.mock('$store/renderer/app-store-lifecycle', () => ({
  startAppStoreLifecycle: mocks.startAppStoreLifecycle,
}));
vi.mock('$store/renderer/sagas', () => ({ startAllAppSagas: () => [] }));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$lib/actions/pause-window-animations', () => ({
  pauseWindowAnimations: () => ({ destroy() {} }),
}));
vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: () => {} }));
vi.mock('$features/backend/splash-gate', () => ({
  dismissSplashElement: mocks.dismissSplashElement,
  wireSplashGate: () => () => {},
}));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  installInterruptedAgentsService: () => () => {},
  notifyInterruptedAgentsModalClosed: () => {},
  resolveInterruptedAgents: async () => {},
}));
vi.mock('$lib/client/live/live-app-client', () => ({ LiveAppClient: class {} }));

vi.mock('$lib/components/layout/sidebar-nav', async () => ({
  SidebarNav: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
  SidebarPanel: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/WindowTitleBar.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/toast/Toast.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/encoder/EncoderCycleHud.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/CommandPalette.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/AuggieSetupGate.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/debug/DebugPanel.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitCredentialsModal.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitHubAuthModal.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/KeyboardShortcutsCheatSheet.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/WorkspaceWarningDialogs.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/ReleaseNotesModal.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/stats/StatsOverlay.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonStoppedOverlay.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonUpdatingOverlay.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/terminal/RootQuakeTerminalOverlay.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/FeatureCodeDialog.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/NewSpaceModal.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/InterruptedAgentsModal.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/navigation/LinkActionMenu.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/LinkTooltip.svelte', async () => ({
  default: (await import('../../../../../routes/__tests__/mocks/Marker.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import AppLayout from '../../../../../routes/(app)/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="frame-inset-children">content</div>',
}));

describe('workspace frame outer inset', () => {
  beforeEach(() => {
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  function renderShell() {
    render(AppLayout, { props: { children: childrenSnippet } });
    const main = screen.getByRole('main');
    const frame = main.parentElement!;
    const frameRow = frame.parentElement!;
    return { main, frame, frameRow };
  }

  it('keeps the bottom inset on the non-shrinking shell boundary', () => {
    const { frame, frameRow } = renderShell();

    expect(frameRow.classList.contains('workspace-frame-row')).toBe(true);
    expect(frameRow.classList.contains('pb-2')).toBe(true);
    expect(frameRow.classList.contains('pl-2')).toBe(true);
    expect(frameRow.classList.contains('min-h-0')).toBe(true);

    expect(frame.classList.contains('workspace-frame')).toBe(true);
    expect(frame.classList.contains('mr-2')).toBe(true);
    expect(frame.classList.contains('mb-2')).toBe(false);
    expect(frame.classList.contains('pb-2')).toBe(false);
  });

  it('keeps the standard workspace surface rounded', () => {
    const { main } = renderShell();

    expect(main.classList.contains('workspace-main')).toBe(true);
    for (const surfaceClass of ['rounded-xl', 'border', 'border-border', 'shadow-sm']) {
      expect(main.classList.contains(surfaceClass), surfaceClass).toBe(true);
    }
  });

  it('keeps the workspace frame from becoming an outer vertical scroll owner', () => {
    const { main } = renderShell();
    const contentSlot = screen.getByTestId('frame-inset-children').parentElement!;

    expect(contentSlot.parentElement).toBe(main);
    expect(main.classList.contains('overflow-hidden')).toBe(true);
    for (const scrollClass of ['flex-1', 'min-h-0', 'overflow-hidden']) {
      expect(contentSlot.classList.contains(scrollClass), scrollClass).toBe(true);
    }
  });

  it('keeps the sidebar frame dimensions stable', () => {
    const { frameRow } = renderShell();
    const sidebarFrame = frameRow.querySelector<HTMLElement>('[data-sidebar-panel-frame]')!;

    expect(sidebarFrame).not.toBeNull();
    expect(sidebarFrame.parentElement).toBe(frameRow);
    for (const frameClass of ['relative', 'z-40', 'shrink-0']) {
      expect(sidebarFrame.classList.contains(frameClass), frameClass).toBe(true);
    }
  });
});
