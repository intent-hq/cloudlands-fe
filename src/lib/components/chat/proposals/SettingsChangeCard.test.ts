/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

const selectorState = vi.hoisted(() => ({
  applied: null as null | { appliedAt: number; reverseChanges: [] },
  status: 'idle' as 'idle' | 'applying' | 'applied' | 'undoing' | 'failed',
  error: null as string | null,
}));

vi.mock('$store/renderer/slices/settings-proposal-history/settings-proposal-history-selectors', () => ({
  selectProposalAppliedState: vi.fn(() => ({
    subscribe: (run: (value: typeof selectorState.applied) => void) => {
      run(selectorState.applied);
      return () => {};
    },
  })),
}));

vi.mock('$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors', () => ({
  selectProposalStatus: vi.fn(() => ({
    subscribe: (run: (value: typeof selectorState.status) => void) => {
      run(selectorState.status);
      return () => {};
    },
  })),
  selectProposalError: vi.fn(() => ({
    subscribe: (run: (value: typeof selectorState.error) => void) => {
      run(selectorState.error);
      return () => {};
    },
  })),
}));

import SettingsChangeCard from './SettingsChangeCard.svelte';

function makeProposal(): Proposal {
  return {
    kind: 'settings-change',
    payload: {
      changes: [{ path: 'theme.activePresetId', value: 'dracula' }],
    },
    applyToolCallId: 'tool-settings-theme',
    preview: {
      title: 'Theme preset: Dracula',
      summary: 'Switch the theme preset to Dracula.',
      applyLabel: 'Apply',
      fields: [
        { key: 'theme.activePresetId', label: 'Theme preset', before: null, after: 'dracula' },
      ],
    },
  };
}

describe('SettingsChangeCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));
    selectorState.applied = null;
    selectorState.status = 'idle';
    selectorState.error = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders friendly summary and before/after rows without JSON chrome', () => {
    const { container } = render(SettingsChangeCard, { props: { proposal: makeProposal() } });

    expect(screen.getByText('Theme preset: Dracula')).toBeTruthy();
    expect(screen.getByText('Switch the theme preset to Dracula.')).toBeTruthy();
    expect(container.textContent).toContain('Theme preset: Default → Dracula');
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(container.textContent).not.toContain('app-settings.proposal.json');
  });

  it('renders nullable enum default labels and applies null edits', async () => {
    const proposal = makeProposal();
    proposal.payload = { changes: [{ path: 'theme.activePresetId', value: null }] };
    proposal.preview.title = 'Theme preset: Default';
    proposal.preview.fields = [
      { key: 'theme.activePresetId', label: 'Theme preset', before: 'dracula', after: 'Default' },
    ];
    const onApply = vi.fn();
    render(SettingsChangeCard, { props: { proposal, onApply } });

    expect(screen.getByText('Theme preset: Default')).toBeTruthy();
    expect(screen.getByText('Dracula → Default')).toBeTruthy();
    const select = screen.getByLabelText('Theme preset') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Default' })).toBeTruthy();

    await fireEvent.change(select, { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply.mock.calls[0]?.[0].editedFields['theme.activePresetId']).toBeNull();
  });

  it('shows applied timestamp and Undo instead of Apply when history exists', async () => {
    selectorState.applied = { appliedAt: Date.now() - 2 * 60 * 1000, reverseChanges: [] };
    const onUndo = vi.fn();
    render(SettingsChangeCard, { props: { proposal: makeProposal(), onUndo } });

    expect(screen.getByText(/Applied 2 min ago/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledWith('tool-settings-theme');
  });

  it('renders lifecycle progress, disabled controls, and aria-live status', () => {
    selectorState.status = 'applying';
    render(SettingsChangeCard, { props: { proposal: makeProposal() } });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Applying…');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Applying…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders undo progress for applied settings proposals', () => {
    selectorState.applied = { appliedAt: Date.now() - 60_000, reverseChanges: [] };
    selectorState.status = 'undoing';
    render(SettingsChangeCard, { props: { proposal: makeProposal() } });

    expect(screen.getByRole('status').textContent).toContain('Undoing…');
    expect(screen.getByRole('button', { name: 'Undoing…' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows Retry only on failed lifecycle and retries apply', async () => {
    selectorState.status = 'failed';
    selectorState.error = 'Nope';
    const onApply = vi.fn();
    render(SettingsChangeCard, { props: { proposal: makeProposal(), onApply } });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Action failed: Nope');
    expect(status.getAttribute('aria-live')).toBe('assertive');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ proposal: makeProposal() }));
  });
});
