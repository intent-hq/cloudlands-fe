/**
 * Previously-running script tabs (daemon `previouslyRunning` marker, PROTOCOL
 * §5.8): after an app relaunch the daemon reports services that were running
 * before its last shutdown. The overlay must render a bottom-bar tab for each
 * (unopened, not auto-selected) and let the user dismiss it — dismissal calls
 * `script.stop`, which clears the daemon-side marker even when the script is
 * not live, then refetches the list.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { ScriptRuntimeState, ScriptWithState } from '$features/scripts/types';

const scriptSelectorState = vi.hoisted(() => {
  const subscribers = new Set<(scripts: ScriptWithState[]) => void>();
  return {
    scripts: [] as ScriptWithState[],
    initialized: false,
    subscribers,
    flush() {
      for (const subscriber of subscribers) subscriber(this.scripts);
    },
  };
});

vi.mock('$store/renderer/store', async () => {
  const { get } = await import('svelte/store');
  const { scriptsReducer } = await import('$store/renderer/slices/scripts/scripts-slice');
  const { terminalsReducer } = await import('$store/renderer/slices/terminals/terminals-slice');
  let scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
  let terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
  let currentTabId: string | null = null;
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const subscribers = new Set<() => void>();
  const resolveSelectorArg = (arg: any) =>
    arg && typeof arg.subscribe === 'function' ? get(arg) : arg;
  const store: any = {
    get state() {
      return {
        tabState: { currentTabId },
        scripts: scriptsState,
        terminals: terminalsState,
      };
    },
    dispatch: (action: any) => {
      dispatched.push(action);
      scriptsState = scriptsReducer(scriptsState, action);
      terminalsState = terminalsReducer(terminalsState, action);
      for (const notify of subscribers) notify();
      return action;
    },
    createSelector: (fn: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => ({
          subscribe: (listener: (v: any) => void) => {
            const notify = () => listener(fn(store.state, ...args.map(resolveSelectorArg)));
            notify();
            subscribers.add(notify);
            return () => subscribers.delete(notify);
          },
        }),
        { select: fn },
      ),
    getReadableState: () => ({
      subscribe: (listener: (v: any) => void) => {
        const notify = () => listener(store.state);
        notify();
        subscribers.add(notify);
        return () => subscribers.delete(notify);
      },
    }),
    __dispatched: dispatched,
    __setCurrentTab: (id: string | null) => {
      currentTabId = id;
    },
    __reset: () => {
      scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
      terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
      currentTabId = null;
      dispatched.length = 0;
      subscribers.clear();
    },
  };
  return { store };
});

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => ({
  selectWorkspaceScriptEntries: Object.assign(
    () => ({
      subscribe(listener: (scripts: ScriptWithState[]) => void) {
        listener(scriptSelectorState.scripts);
        scriptSelectorState.subscribers.add(listener);
        return () => scriptSelectorState.subscribers.delete(listener);
      },
    }),
    { select: () => scriptSelectorState.scripts },
  ),
  selectWorkspaceScriptsInitialized: () => ({
    subscribe(listener: (initialized: boolean) => void) {
      listener(scriptSelectorState.initialized);
      return () => {};
    },
  }),
}));

vi.mock('../Terminal.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../SetupScriptBanner.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../ScriptOutputViewer.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../TerminalSidebar.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$lib/components/ui/tooltip', async () => {
  const MockTooltip = (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'))
    .default;
  const MockTooltipRich = (
    await import('../../workspace/sidebar/__tests__/mocks/MockTooltipRich.svelte')
  ).default;
  return { Tooltip: MockTooltip, TooltipRich: MockTooltipRich, TooltipShortcut: MockTooltip };
});
vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockButton.svelte')).default,
}));
vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    detect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue({ success: true }),
    restart: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeTerminal: vi.fn(), clearTerminal: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: () => null },
}));

import QuakeTerminalOverlay from '../QuakeTerminalOverlay.svelte';
import { store as appStore } from '$store/renderer/store';
import { scriptsClient } from '$features/scripts/scripts.client';
import {
  setScriptsData,
  setScriptsInitialized,
} from '$store/renderer/slices/scripts/scripts-slice';
import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../../../test/warm-import';

const WS_A = 'ws-a' as WorkspaceId;

function makeScript(id: string, runtime: Partial<ScriptRuntimeState> = {}): ScriptWithState {
  return {
    id,
    workspaceId: WS_A,
    name: `script-${id}`,
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    runtime: { status: 'idle', exitCode: null, restartCount: 0, ...runtime },
  };
}

function seedScripts(scripts: ScriptWithState[]) {
  appStore.dispatch(setScriptsData(WS_A, scripts));
  appStore.dispatch(setScriptsInitialized(WS_A, true));
  scriptSelectorState.scripts = scripts;
  scriptSelectorState.initialized = true;
  scriptSelectorState.flush();
}

function scriptTabs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function dispatchedTypes(): string[] {
  return (appStore as any).__dispatched.map((action: { type: string }) => action.type);
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

describe('QuakeTerminalOverlay previously-running script tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appStore as any).__reset();
    (appStore as any).__setCurrentTab(WS_A);
    scriptSelectorState.scripts = [];
    scriptSelectorState.initialized = false;
    scriptSelectorState.subscribers.clear();
  });

  it('renders a tab for each previously-running script without auto-selecting it', async () => {
    seedScripts([
      makeScript('prev-1', { previouslyRunning: true }),
      makeScript('prev-2', { previouslyRunning: true }),
      makeScript('plain-idle'),
    ]);

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });

    await waitFor(() => expect(scriptTabs(container)).toHaveLength(2));
    const tabs = scriptTabs(container);
    const labels = tabs.map((tab) => tab.textContent ?? '');
    expect(labels.some((text) => text.includes('script-prev-1'))).toBe(true);
    expect(labels.some((text) => text.includes('script-prev-2'))).toBe(true);
    expect(labels.some((text) => text.includes('script-plain-idle'))).toBe(false);
    // Unopened: no tab is selected and no script selection was dispatched.
    expect(tabs.every((tab) => tab.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(dispatchedTypes()).not.toContain('terminals/selectScript');
  });

  it('still renders live scripts as tabs, without a dismiss button', async () => {
    seedScripts([makeScript('live-1', { status: 'running', pid: 42 })]);

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });

    await waitFor(() => expect(scriptTabs(container)).toHaveLength(1));
    const labels = scriptTabs(container).map((tab) => tab.textContent ?? '');
    expect(labels.some((text) => text.includes('script-live-1'))).toBe(true);
    expect(container.querySelector('[data-dismiss-script-tab]')).toBeNull();
  });

  it('labels bottom-tab status without relying on color', async () => {
    seedScripts([
      makeScript('live-1', { status: 'running', pid: 42 }),
      makeScript('restart-1', { status: 'restarting', pid: 43 }),
      makeScript('success-1', { status: 'exited', exitCode: 0, previouslyRunning: true }),
      makeScript('failed-1', { status: 'exited', exitCode: 1, previouslyRunning: true }),
      makeScript('stopped-1', { status: 'exited', exitCode: 143, previouslyRunning: true }),
      makeScript('idle-1', { status: 'idle', previouslyRunning: true }),
    ]);

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });

    await waitFor(() => expect(scriptTabs(container)).toHaveLength(6));
    const labels = Object.fromEntries(
      scriptTabs(container).map((tab) => [
        tab.textContent?.trim(),
        tab.querySelector('[role="img"]')?.getAttribute('aria-label'),
      ]),
    );
    expect(labels['script-live-1']).toBe('Running');
    expect(labels['script-restart-1']).toBe('Restarting');
    expect(labels['script-success-1']).toBe('Exited (0)');
    expect(labels['script-failed-1']).toBe('Error (1)');
    expect(labels['script-stopped-1']).toBe('Stopped (signal 15)');
    expect(labels['script-idle-1']).toBe('Idle');
  });

  it('dismissing a previously-running tab calls script.stop and refetches the list', async () => {
    seedScripts([makeScript('prev-1', { previouslyRunning: true })]);

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });

    await waitFor(() =>
      expect(container.querySelector('[data-dismiss-script-tab="prev-1"]')).not.toBeNull(),
    );
    const dismiss = container.querySelector<HTMLButtonElement>(
      '[data-dismiss-script-tab="prev-1"]',
    );
    await fireEvent.click(dismiss!);
    // The handler awaits scriptsClient.stop before dispatching the refresh.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scriptsClient.stop).toHaveBeenCalledWith(WS_A, 'prev-1');
    expect(dispatchedTypes()).toContain('scripts/refreshScripts');
  });

  it('removes the dismiss control from the document while its script tab is being renamed', async () => {
    seedScripts([makeScript('prev-1', { previouslyRunning: true })]);
    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    const dismissName = m.terminal_quakeOverlay_dismissScriptTab_ariaLabel();

    await waitFor(() => expect(screen.getByRole('button', { name: dismissName })).not.toBeNull());
    await fireEvent.doubleClick(scriptTabs(container)[0]);

    expect(container.querySelector('[data-edit-script-tab="prev-1"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: dismissName })).toBeNull();
  });

  it('a previously-running script that goes live keeps its tab and loses the dismiss button', async () => {
    seedScripts([makeScript('prev-1', { previouslyRunning: true })]);
    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await waitFor(() =>
      expect(container.querySelector('[data-dismiss-script-tab="prev-1"]')).not.toBeNull(),
    );

    seedScripts([makeScript('prev-1', { status: 'running', pid: 42 })]);
    await waitFor(() =>
      expect(container.querySelector('[data-dismiss-script-tab="prev-1"]')).toBeNull(),
    );

    const labels = scriptTabs(container).map((tab) => tab.textContent ?? '');
    expect(labels.some((text) => text.includes('script-prev-1'))).toBe(true);
    expect(container.querySelector('[data-dismiss-script-tab="prev-1"]')).toBeNull();
  });
});
