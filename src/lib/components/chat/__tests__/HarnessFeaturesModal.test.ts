/**
 * @vitest-environment jsdom
 *
 * HarnessFeaturesModal — read-only modal listing harness features
 * (PROTOCOL §5.5 `harnessVersion` / `harnessFeatures`; monorepo#2459).
 *
 * Covers the row-building contract (union of catalog + snapshot, snapshot
 * value wins, off-by-default for catalog keys missing from the snapshot,
 * humanized fallback for unknown snapshot keys) and the dialog shell
 * (version in the title, scrollable body, standard dismissal).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const backendRequest = vi.fn();
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: (...args: unknown[]) => backendRequest(...args),
}));

import HarnessFeaturesModal from '../HarnessFeaturesModal.svelte';
import {
  HARNESS_FEATURE_CATALOG,
  buildHarnessFeatureRows,
  humanizeHarnessFeatureKey,
} from '../harness-feature-catalog';
import { FEATURE_PATHS } from '$lib/components/settings/agent-feature-definitions';
import { initAppStore, store } from '$store/renderer/store';

afterEach(cleanup);

function renderModal(props: {
  version: string;
  features?: Record<string, boolean> | null;
  agentId?: string;
}) {
  return render(HarnessFeaturesModal, { props: { open: true, ...props } });
}

function getStates(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll('[data-testid="harness-feature-state"]'),
  ) as HTMLElement[];
}

describe('buildHarnessFeatureRows', () => {
  it('stays in lockstep with the settings page feature definitions', () => {
    expect(HARNESS_FEATURE_CATALOG.map((f) => f.key)).toEqual(
      FEATURE_PATHS.map((path) => path.replace(/^agentFeatures\./, '')),
    );
  });

  it('renders the union: catalog keys plus snapshot-only keys', () => {
    const rows = buildHarnessFeatureRows({ structuredQuestions: true, agentActions: true });
    expect(rows).toHaveLength(HARNESS_FEATURE_CATALOG.length + 1);
    const unknown = rows.find((row) => row.key === 'agentActions')!;
    expect(unknown.known).toBe(false);
    expect(unknown.description).toBeNull();
    expect(unknown.label).toBe('Agent actions');
  });

  it('keeps catalog order and appends unknown snapshot keys at the end', () => {
    const rows = buildHarnessFeatureRows({ zzzUnknown: true, aaaUnknown: false });
    expect(rows.slice(0, HARNESS_FEATURE_CATALOG.length).map((row) => row.key)).toEqual(
      HARNESS_FEATURE_CATALOG.map((feature) => feature.key),
    );
    // Unknown keys trail the catalog, sorted by label.
    expect(rows.slice(HARNESS_FEATURE_CATALOG.length).map((row) => row.key)).toEqual([
      'aaaUnknown',
      'zzzUnknown',
    ]);
  });

  it('snapshot value wins over the catalog default', () => {
    const rows = buildHarnessFeatureRows({ taskGraph: true, backgroundHooks: false });
    expect(rows.find((row) => row.key === 'taskGraph')!.enabled).toBe(true);
    expect(rows.find((row) => row.key === 'backgroundHooks')!.enabled).toBe(false);
  });

  it('catalog keys missing from the snapshot render OFF', () => {
    const rows = buildHarnessFeatureRows({ structuredQuestions: true });
    for (const row of rows.filter((r) => r.key !== 'structuredQuestions')) {
      expect(row.enabled).toBe(false);
    }
  });

  it('null/absent snapshot renders every catalog key OFF', () => {
    const rows = buildHarnessFeatureRows(null);
    expect(rows).toHaveLength(HARNESS_FEATURE_CATALOG.length);
    expect(rows.every((row) => !row.enabled)).toBe(true);
  });

  it('humanizes unknown wire keys', () => {
    expect(humanizeHarnessFeatureKey('agentActions')).toBe('Agent actions');
    expect(humanizeHarnessFeatureKey('some_wireKey')).toBe('Some wire key');
  });
});

describe('HarnessFeaturesModal', () => {
  it.each<{ features: Record<string, boolean>; enabled: string }>([
    { features: { peerAgents: true }, enabled: 'true' },
    { features: { peerAgents: false }, enabled: 'false' },
    { features: {}, enabled: 'false' },
  ])('renders peer agents from the session snapshot $features', async ({ features, enabled }) => {
    renderModal({ version: '1.0', features });

    const dialog = await screen.findByRole('dialog');
    const state = getStates(dialog).find((el) => el.dataset.feature === 'peerAgents')!;
    expect(state.dataset.enabled).toBe(enabled);
  });

  it('shows the version in the title and settings-page labels', async () => {
    renderModal({ version: '1.0', features: { structuredQuestions: true } });

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' }); // protocol-version-ok: agent-harness product version fixture
    expect(dialog).toBeTruthy();
    // Settings-page pretty labels, not raw camelCase keys.
    expect(screen.getByText('Structured questions')).toBeTruthy();
    expect(screen.queryByText('structuredQuestions')).toBeNull();
  });

  it('marks snapshot-on features On and everything else Off', async () => {
    renderModal({ version: '1.0', features: { structuredQuestions: true, taskGraph: false } });

    const dialog = await screen.findByRole('dialog');
    const states = getStates(dialog);
    expect(states).toHaveLength(HARNESS_FEATURE_CATALOG.length);
    const stateFor = (key: string) => states.find((el) => el.dataset.feature === key)!;
    expect(stateFor('structuredQuestions').closest('section')?.getAttribute('aria-label')).toBe(
      'On',
    );
    expect(stateFor('taskGraph').closest('section')?.getAttribute('aria-label')).toBe('Off');
    expect(stateFor('browserAutomation').closest('section')?.getAttribute('aria-label')).toBe(
      'Off',
    );
  });

  it('renders unknown snapshot keys with a humanized label and no description', async () => {
    renderModal({ version: '1.0', features: { agentActions: true } });

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByText('Agent actions')).toBeTruthy();
    const state = getStates(dialog).find((el) => el.dataset.feature === 'agentActions')!;
    expect(state.dataset.enabled).toBe('true');
  });

  it('uses the scrollable canonical dialog content', async () => {
    renderModal({ version: '1.0', features: {} });

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-slot="dialog-body"]')?.className).toContain(
      'overflow-y-auto',
    );
    expect(dialog.className).toContain('dialog-editorial-content');
    expect(dialog.querySelector('[data-testid="harness-features-list"]')).not.toBeNull();
  });

  it('dismisses via Escape', async () => {
    renderModal({ version: '1.0', features: {} });
    const dialog = await screen.findByRole('dialog');

    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('dismisses via the X close button', async () => {
    renderModal({ version: '1.0', features: {} });
    await screen.findByRole('dialog');

    await fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('HarnessFeaturesModal starting context', () => {
  let storeContext: ReturnType<typeof initAppStore> | undefined;
  beforeEach(() => {
    backendRequest.mockReset();
    storeContext = initAppStore(store);
  });
  afterEach(() => {
    storeContext?.dispose?.();
    storeContext = undefined;
  });

  const breakdown = {
    available: true,
    harnessVersion: '3.12',
    recordedAt: '2026-11-10T12:00:00Z',
    systemPromptChars: 4_000,
    toolDescriptionChars: 0,
    totalChars: 4_000,
    estTokens: 1_000,
    sections: [
      {
        id: 'repo-rules',
        label: 'Repo rules',
        owner: 'user',
        location: 'systemPrompt',
        chars: 4_000,
        estTokens: 1_000,
      },
    ],
    hiddenSkills: [
      {
        name: 'memory',
        reason: 'mcp-server-missing',
        detail: 'needs mcp__memory__',
        fix: 'Add it',
      },
    ],
  };

  it('reads agent.getSession for the agent and lists its sections and hidden skills', async () => {
    backendRequest.mockResolvedValue({ session: { promptBreakdown: breakdown } });
    renderModal({ version: '3.12', features: {}, agentId: 'agent-modal' });

    const panel = await screen.findByTestId('prompt-breakdown');
    expect(backendRequest).toHaveBeenCalledWith('agent.getSession', { agentId: 'agent-modal' });
    expect(panel.textContent).toContain('Repo rules');
    expect(panel.textContent).toContain('memory');
  });

  function respondWith(promptBreakdown: unknown) {
    let settled = false;
    backendRequest.mockImplementationOnce(async () => {
      settled = true;
      return { session: { promptBreakdown } };
    });
    return async () => {
      await waitFor(() => expect(settled).toBe(true));
      await tick();
      await tick();
    };
  }

  it('shows no starting context when the session has none', async () => {
    const answered = respondWith({ available: false, reason: 'not-recorded' });
    renderModal({ version: '3.12', features: {}, agentId: 'agent-none' });

    await screen.findByRole('dialog');
    await answered();
    expect(screen.queryByTestId('prompt-breakdown')).toBeNull();
  });

  it('reads again on reopen, so a later spawn shows its breakdown', async () => {
    const firstAnswered = respondWith({ available: false, reason: 'not-recorded' });
    const view = render(HarnessFeaturesModal, {
      props: { open: true, version: '3.12', features: {}, agentId: 'agent-respawn' },
    });
    await screen.findByRole('dialog');
    await firstAnswered();
    expect(screen.queryByTestId('prompt-breakdown')).toBeNull();

    await view.rerender({ open: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    respondWith(breakdown);
    await view.rerender({ open: true });

    expect(await screen.findByTestId('prompt-breakdown')).toBeTruthy();
    expect(backendRequest).toHaveBeenCalledTimes(2);
  });

  it('skips the session read for harnesses that cannot carry a breakdown', async () => {
    renderModal({ version: '3.9', features: {}, agentId: 'agent-old' });

    await screen.findByRole('dialog');
    expect(backendRequest).not.toHaveBeenCalled();
    expect(screen.queryByTestId('prompt-breakdown')).toBeNull();
  });
});
