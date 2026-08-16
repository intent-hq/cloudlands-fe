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
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import HarnessFeaturesModal from '../HarnessFeaturesModal.svelte';
import {
  HARNESS_FEATURE_CATALOG,
  buildHarnessFeatureRows,
  humanizeHarnessFeatureKey,
} from '../harness-feature-catalog';
import { FEATURE_PATHS } from '$lib/components/settings/agent-feature-definitions';

afterEach(cleanup);

function renderModal(props: { version: string; features?: Record<string, boolean> | null }) {
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
  it('shows the version in the title and settings-page labels with descriptions', async () => {
    renderModal({ version: '1.0', features: { structuredQuestions: true } });

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    expect(dialog).toBeTruthy();
    // Settings-page pretty labels, not raw camelCase keys.
    expect(screen.getByText('Structured questions')).toBeTruthy();
    expect(screen.queryByText('structuredQuestions')).toBeNull();
    expect(
      screen.getByText('Let agents ask structured clarifying questions with predefined options'),
    ).toBeTruthy();
  });

  it('marks snapshot-on features On and everything else Off', async () => {
    renderModal({ version: '1.0', features: { structuredQuestions: true, taskGraph: false } });

    const dialog = await screen.findByRole('dialog');
    const states = getStates(dialog);
    expect(states).toHaveLength(HARNESS_FEATURE_CATALOG.length);
    const stateFor = (key: string) => states.find((el) => el.dataset.feature === key)!;
    expect(stateFor('structuredQuestions').textContent!.trim()).toBe('On');
    expect(stateFor('taskGraph').textContent!.trim()).toBe('Off');
    expect(stateFor('browserAutomation').textContent!.trim()).toBe('Off');
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
    expect(dialog.className).toContain('overflow-y-auto');
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
