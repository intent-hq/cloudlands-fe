import { fireEvent, render } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const flags = {
    enableCreationAnimation: true,
    animationDuration: 300,
    enablePageTransitions: true,
    enableComponentTransitions: true,
    showDebugInfo: true,
    showPerformanceMetrics: false,
    logStateChanges: false,
    enableAutofocus: true,
    enableBranchCaching: true,
    enableFormPersistence: true,
    simulateSlowNetwork: false,
    simulateErrors: false,
    networkDelay: 0,
  };
  const toggle = vi.fn((key: keyof typeof flags) => {
    const value = flags[key];
    if (typeof value === 'boolean') {
      (flags as Record<string, boolean | number>)[key] = !value;
    }
  });
  return { flags, toggle, dispatch: vi.fn() };
});

vi.mock('$lib/config/debug', () => ({
  debugConfig: {
    getAll: () => ({ ...mocks.flags }),
    subscribe: () => () => {},
    toggle: mocks.toggle,
    set: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: vi.fn() },
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: { select: vi.fn(() => []) },
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  resetWorkspaceState: vi.fn(() => ({ type: 'workspace/reset' })),
}));

vi.mock('$lib/utils/workspace-route-context', () => ({
  getWorkspaceRouteContext: () => null,
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

describe('DebugPanel', () => {
  beforeEach(() => {
    mocks.toggle.mockClear();
    mocks.flags.showDebugInfo = true;
    mocks.flags.enableCreationAnimation = true;
  });

  it('renders every debug flag with a textless button Toggle and updates the selected flag', async () => {
    const { container, getByRole, getByText } = render(
      (await import('./DebugPanel.svelte')).default,
    );
    const accessibleNames = [
      m.debug_panel_creationAnimation_ariaLabel(),
      m.debug_panel_pageTransitions_ariaLabel(),
      m.debug_panel_componentTransitions_ariaLabel(),
      m.debug_panel_performanceMetrics_ariaLabel(),
      m.debug_panel_logStateChanges_ariaLabel(),
      m.debug_panel_enableAutofocus_ariaLabel(),
      m.debug_panel_branchCaching_ariaLabel(),
      m.debug_panel_formPersistence_ariaLabel(),
      m.debug_panel_simulateSlowNetwork_ariaLabel(),
      m.debug_panel_simulateErrors_ariaLabel(),
    ];
    const creationAnimation = getByRole('button', { name: accessibleNames[0] });

    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(10);
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(getByText('Creation Animation')).toBeTruthy();
    for (const accessibleName of accessibleNames) {
      expect(getByRole('button', { name: accessibleName }).textContent?.trim()).toBe('');
    }
    expect(creationAnimation.textContent?.trim()).toBe('');
    expect(creationAnimation.getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(creationAnimation);

    expect(mocks.toggle).toHaveBeenCalledWith('enableCreationAnimation');
    expect(creationAnimation.getAttribute('aria-pressed')).toBe('false');
  });
});
