/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

const selectorState = vi.hoisted(() => ({
  applied: null as null | {
    appliedAt: number;
    reverse: { kind: 'delete'; id: string; scope: 'user' };
  },
  status: 'idle' as 'idle' | 'applying' | 'applied' | 'undoing' | 'failed',
  error: null as string | null,
}));

vi.mock(
  '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-selectors',
  () => ({
    selectSpecialistProposalAppliedState: vi.fn(() => ({
      subscribe: (run: (value: typeof selectorState.applied) => void) => {
        run(selectorState.applied);
        return () => {};
      },
    })),
  }),
);

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

import SpecialistChangeCard from './SpecialistChangeCard.svelte';

function makeProposal(): Proposal {
  return {
    kind: 'specialist-edit',
    payload: {
      operation: 'edit',
      id: 'review-buddy',
      name: 'Review Buddy',
      description: 'Reviews changes',
      model: 'auggie:opus4.5',
      prompt: 'Review carefully.',
    },
    applyToolCallId: 'tool-specialist-review-buddy',
    preview: {
      title: 'Edit specialist: Review Buddy',
      summary: 'Review and edit the specialist fields before applying.',
      applyLabel: 'Save specialist',
      fields: [
        { key: 'name', label: 'Name', before: 'Reviewer', after: 'Review Buddy' },
        { key: 'prompt', label: 'Prompt', before: 'Old prompt', after: 'Review carefully.' },
      ],
    },
  };
}

describe('SpecialistChangeCard', () => {
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

  it('renders friendly summary and before/after rows without generic JSON chrome', () => {
    const { container } = render(SpecialistChangeCard, { props: { proposal: makeProposal() } });

    expect(screen.getByText('Edit specialist: Review Buddy')).toBeTruthy();
    expect(screen.getByText('Review and edit the specialist fields before applying.')).toBeTruthy();
    expect(container.textContent).toContain('Name: Reviewer → Review Buddy');
    expect(container.textContent).toContain('Prompt: Old prompt → Review carefully.');
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save specialist' })).toBeTruthy();
    expect(container.textContent).not.toContain('specialist-edit');
  });

  it('emits apply details for specialist proposals', async () => {
    const onApply = vi.fn();
    render(SpecialistChangeCard, { props: { proposal: makeProposal(), onApply } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save specialist' }));

    expect(onApply).toHaveBeenCalledWith({
      proposal: makeProposal(),
      editedFields: {},
      selectedBulkItemIds: [],
    });
  });

  it('shows applied timestamp and Undo instead of Apply when history exists', async () => {
    selectorState.applied = {
      appliedAt: Date.now() - 2 * 60 * 1000,
      reverse: { kind: 'delete', id: 'review-buddy', scope: 'user' },
    };
    const onUndo = vi.fn();
    render(SpecialistChangeCard, { props: { proposal: makeProposal(), onUndo } });

    expect(screen.getByText(/Applied 2 min ago/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save specialist' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledWith('tool-specialist-review-buddy');
  });

  it('renders lifecycle progress, disabled controls, and aria-live status', () => {
    selectorState.status = 'applying';
    render(SpecialistChangeCard, { props: { proposal: makeProposal() } });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Applying…');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Applying…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows Retry only on failed lifecycle and retries apply', async () => {
    selectorState.status = 'failed';
    selectorState.error = 'Nope';
    const onApply = vi.fn();
    render(SpecialistChangeCard, { props: { proposal: makeProposal(), onApply } });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Action failed: Nope');
    expect(status.getAttribute('aria-live')).toBe('assertive');
    expect(screen.queryByRole('button', { name: 'Save specialist' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onApply).toHaveBeenCalledWith({
      proposal: makeProposal(),
      editedFields: {},
      selectedBulkItemIds: [],
    });
  });
});
