import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import AgentPlacementPicker from './AgentPlacementPicker.svelte';

const capabilities = { agentNodes: true, localNodeIsolation: true };
describe('agent placement choices', () => {
  it('allows local isolation with Labs off and emits canonical placement', async () => {
    const onchange = vi.fn();
    render(AgentPlacementPicker, { capabilities, remoteEnabled: false, onchange });
    await fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'Remote isolated checkout' })).toBeNull();
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Local isolated checkout' }), {
      pointerType: 'mouse',
      button: 0,
    });
    expect(onchange).toHaveBeenCalledExactlyOnceWith({ target: 'local', checkout: 'isolated' });
  });
  it('updates off/on/off while open without converting a remote selection to shared', async () => {
    const onchange = vi.fn();
    const props = {
      capabilities,
      remoteEnabled: false,
      onchange,
      value: { target: 'remote', checkout: 'isolated' } as const,
    };
    const view = render(AgentPlacementPicker, props);
    await fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'Remote isolated checkout' })).toBeNull();
    await view.rerender({ ...props, remoteEnabled: true });
    expect(screen.getByRole('option', { name: 'Remote isolated checkout' })).toBeTruthy();
    await view.rerender(props);
    expect(screen.queryByRole('option', { name: 'Remote isolated checkout' })).toBeNull();
    expect(onchange).not.toHaveBeenCalled();
  });
  it('disables isolated selection when the daemon lacks that capability', async () => {
    const onchange = vi.fn();
    render(AgentPlacementPicker, {
      capabilities: { agentNodes: true, localNodeIsolation: false },
      remoteEnabled: false,
      onchange,
    });
    await fireEvent.click(screen.getByRole('combobox'));
    const isolated = screen.getByRole('option', { name: 'Local isolated checkout' });
    expect(isolated.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(isolated);
    expect(onchange).not.toHaveBeenCalled();
  });
});
