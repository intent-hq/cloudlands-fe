/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {}, dispatch: vi.fn() });
});

import GoalEditorDialog from '../GoalEditorDialog.svelte';

describe('GoalEditorDialog', () => {
  it('seeds the field on open and keeps typed text when the goal changes elsewhere', async () => {
    const view = render(GoalEditorDialog, {
      props: { open: true, workspaceId: 'ws-1', agentId: 'agent-1', initialGoal: 'First goal' },
    });
    await tick();
    const field = (await screen.findByTestId('goal-editor-field')) as HTMLTextAreaElement;
    expect(field.value).toBe('First goal');

    await fireEvent.input(field, { target: { value: 'My edit' } });
    // Another client's agent:updated changes the stored goal while the dialog is open.
    await view.rerender({ initialGoal: 'Changed elsewhere' });
    await tick();
    expect((screen.getByTestId('goal-editor-field') as HTMLTextAreaElement).value).toBe('My edit');

    // Reopening seeds from the latest goal.
    await view.rerender({ open: false });
    await tick();
    await view.rerender({ open: true });
    await tick();
    expect(((await screen.findByTestId('goal-editor-field')) as HTMLTextAreaElement).value).toBe(
      'Changed elsewhere',
    );
  });
});
