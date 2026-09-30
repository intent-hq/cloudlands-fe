import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import AgentPlacementRequiredDialog from './AgentPlacementRequiredDialog.svelte';
const capabilities = { agentNodes: true, localNodeIsolation: true };
describe('required local placement dialog', () => {
  it('requires an actual choice and submits the selected isolated placement', async () => {
    const onanswer = vi.fn();
    render(AgentPlacementRequiredDialog, { capabilities, onanswer });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'Remote isolated checkout' })).toBeNull();
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Local isolated checkout' }), {
      pointerType: 'mouse',
      button: 0,
    });
    await fireEvent.click(confirm);
    expect(onanswer).toHaveBeenCalledExactlyOnceWith({ target: 'local', checkout: 'isolated' });
  });
  it('cancel does not select a hidden shared default', async () => {
    const onanswer = vi.fn();
    render(AgentPlacementRequiredDialog, { capabilities, onanswer });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onanswer).toHaveBeenCalledExactlyOnceWith(null);
  });
});
