/**
 * @vitest-environment jsdom
 */
/**
 * Composer-slot pending-proposal tray: walks the ordered entries one at a
 * time with an "n of N" header (chevrons clamp at the ends and the index
 * clamps as entries shrink), Hide collapses to a re-expandable banner via
 * the host-owned flag, Dismiss (header button or the card's Discard) is
 * gated behind the confirmation dialog before onDismiss fires, Apply
 * forwards the card's action to onApply, and the last-viewed proposal
 * persists per agent so a remount restores it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

const lifecycleSelectorState = vi.hoisted(() => ({
  status: 'idle' as 'idle' | 'applying' | 'applied' | 'undoing' | 'failed',
  error: null as string | null,
  errorCode: null as string | null,
  result: null as { workspaceId?: string } | null,
}));

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockRepoAndBranchPicker.svelte'))
    .default,
}));
vi.mock('$lib/components/chat/SpecialistDropdown.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSpecialistDropdown.svelte'))
    .default,
}));
vi.mock(
  '$store/renderer/slices/settings-proposal-history/settings-proposal-history-selectors',
  () => ({
    selectProposalAppliedState: vi.fn(() => ({
      subscribe: (run: (value: null) => void) => {
        run(null);
        return () => {};
      },
    })),
  }),
);
vi.mock(
  '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-selectors',
  () => ({
    selectSpecialistProposalAppliedState: vi.fn(() => ({
      subscribe: (run: (value: null) => void) => {
        run(null);
        return () => {};
      },
    })),
  }),
);
vi.mock('$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors', () => ({
  selectProposalStatus: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.status) => void) => {
      run(lifecycleSelectorState.status);
      return () => {};
    },
  })),
  selectProposalError: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.error) => void) => {
      run(lifecycleSelectorState.error);
      return () => {};
    },
  })),
  selectProposalErrorCode: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.errorCode) => void) => {
      run(lifecycleSelectorState.errorCode);
      return () => {};
    },
  })),
  selectProposalResult: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.result) => void) => {
      run(lifecycleSelectorState.result);
      return () => {};
    },
  })),
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-selectors', () => ({
  selectPrBranchLookupEntries: vi.fn(() => ({
    subscribe: (run: (value: Record<string, never>) => void) => {
      run({});
      return () => {};
    },
  })),
}));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: vi.fn(),
    state: {},
    createSelector: vi.fn((fn) => ({
      select: fn,
      withStore: () => () => ({ subscribe: () => () => {} }),
    })),
  },
}));

import ProposalTray, { trayBodyMaxHeight } from './ProposalTray.svelte';
import type { PendingProposalEntry } from './pending-proposals';
import { saveTrayPosition } from './proposal-tray-storage';
import { warmImport } from '../../../../test/warm-import';

const AGENT = 'agent-tray-test';

function makeEntry(id: string, title: string): PendingProposalEntry {
  const proposal: Proposal = {
    kind: 'bulk-op',
    payload: {},
    preview: {
      title,
      fields: [{ key: 'title', label: 'Title', value: title }],
    },
  };
  return { proposalId: id, messageId: `msg-${id}`, proposal };
}

const ENTRIES = [makeEntry('prop-a', 'Change setting A'), makeEntry('prop-b', 'Change setting B')];

// The global test-setup localStorage stub is a no-op. Install a functional
// mock whose entries are enumerable own properties (Web Storage enumeration
// semantics) so `safeLocalStorage.keysWithPrefix` — which save-time pruning
// depends on — sees them (same approach as QuestionWizard.test.ts).
function installEnumerableLocalStorage(): void {
  const storage: Record<string, string> = {};
  const methods: Record<string, unknown> = {
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    setItem: (key: string, value: string) => {
      storage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const key of Object.keys(storage)) delete storage[key];
    },
  };
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(storage, name, { value: fn, enumerable: false, configurable: true });
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

beforeEach(() => {
  lifecycleSelectorState.status = 'idle';
  installEnumerableLocalStorage();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockRepoAndBranchPicker.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSpecialistDropdown.svelte'));

describe('ProposalTray', () => {
  it('renders the current proposal with an n-of-N header and clamped chevrons', async () => {
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES } });

    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getAllByText('Change setting A').length).toBeGreaterThan(0);
    const back = screen.getByTestId('proposal-tray-back');
    const forward = screen.getByTestId('proposal-tray-forward');
    expect(back.hasAttribute('disabled')).toBe(true);
    expect(forward.hasAttribute('disabled')).toBe(false);

    await fireEvent.click(forward);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getAllByText('Change setting B').length).toBeGreaterThan(0);
    expect(screen.getByTestId('proposal-tray-forward').hasAttribute('disabled')).toBe(true);

    await fireEvent.click(screen.getByTestId('proposal-tray-back'));
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('hides the nav and renders the single proposal when only one entry is pending', () => {
    render(ProposalTray, { props: { agentId: AGENT, entries: [ENTRIES[0]!] } });

    expect(screen.queryByTestId('proposal-tray-back')).toBeNull();
    expect(screen.queryByTestId('proposal-tray-forward')).toBeNull();
    expect(screen.getAllByText('Change setting A').length).toBeGreaterThan(0);
  });

  it('clamps the index when entries shrink after a resolution', async () => {
    const { rerender } = render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES } });
    await fireEvent.click(screen.getByTestId('proposal-tray-forward'));
    expect(screen.getByText('2 of 2')).toBeTruthy();

    await rerender({ agentId: AGENT, entries: [ENTRIES[0]!] });
    expect(screen.getAllByText('Change setting A').length).toBeGreaterThan(0);
    expect(screen.queryByText('2 of 2')).toBeNull();
  });

  it('renders the collapsed banner and re-expands through the host flag', async () => {
    const onToggleCollapsed = vi.fn();
    render(ProposalTray, {
      props: { agentId: AGENT, entries: ENTRIES, collapsed: true, onToggleCollapsed },
    });

    expect(screen.getByText('Pending Proposals')).toBeTruthy();
    expect(screen.queryAllByText('Change setting A')).toHaveLength(0);
    await fireEvent.click(screen.getByTestId('proposal-tray-banner'));
    expect(onToggleCollapsed).toHaveBeenCalledWith(false);
  });

  it('reports Hide to the host without dismissing anything', async () => {
    const onToggleCollapsed = vi.fn();
    const onDismiss = vi.fn();
    render(ProposalTray, {
      props: { agentId: AGENT, entries: ENTRIES, onToggleCollapsed, onDismiss },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('forwards the card Apply action to onApply', async () => {
    const onApply = vi.fn();
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES, onApply } });

    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].proposal.preview.title).toBe('Change setting A');
  });

  it('gates Dismiss behind the confirmation dialog before calling onDismiss', async () => {
    const onDismiss = vi.fn();
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES, onDismiss } });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).not.toHaveBeenCalled();

    await fireEvent.click(await screen.findByRole('button', { name: 'Dismiss proposal' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss.mock.calls[0]![0].proposalId).toBe('prop-a');
  });

  it('cancelling the confirmation dialog keeps the entry pending', async () => {
    const onDismiss = vi.fn();
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES, onDismiss } });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getAllByText('Change setting A').length).toBeGreaterThan(0);
  });

  it("routes the card's own Discard through the same confirmation dialog", async () => {
    const onDismiss = vi.fn();
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES, onDismiss } });

    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Dismiss proposal' })).toBeTruthy();
  });

  it('restores the last-viewed proposal for the agent on remount', () => {
    saveTrayPosition(AGENT, 'prop-b');
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES } });

    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getAllByText('Change setting B').length).toBeGreaterThan(0);
  });

  it('falls back to the first proposal when the persisted one is gone', () => {
    saveTrayPosition(AGENT, 'prop-gone');
    render(ProposalTray, { props: { agentId: AGENT, entries: ENTRIES } });

    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('caps the body as a scroll region with the header outside it', () => {
    const { container } = render(ProposalTray, {
      props: { agentId: AGENT, entries: ENTRIES, maxBodyHeight: 200 },
    });

    const body = container.querySelector('[data-proposal-tray-body]') as HTMLElement;
    expect(body.style.maxHeight).toBe('200px');
    expect(body.className).toContain('overflow-y-auto');
    const header = container.querySelector('[data-proposal-tray-header]') as HTMLElement;
    expect(body.contains(header)).toBe(false);
  });
});

describe('trayBodyMaxHeight', () => {
  it('reserves panel chrome, floors short panels, and caps tall ones', () => {
    // Short Chief sidebar: the 160px floor keeps the card usable.
    expect(trayBodyMaxHeight(300)).toBe(160);
    // Mid-size panel: panel height minus the reserved chrome.
    expect(trayBodyMaxHeight(600)).toBe(360);
    // Tall panel: capped so the transcript stays dominant.
    expect(trayBodyMaxHeight(2000)).toBe(480);
    // Unmeasured host falls back to the cap.
    expect(trayBodyMaxHeight(0)).toBe(480);
  });
});
