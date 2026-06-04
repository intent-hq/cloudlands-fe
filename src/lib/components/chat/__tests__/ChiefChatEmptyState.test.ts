/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChiefChatEmptyState from '../ChiefChatEmptyState.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

describe('ChiefChatEmptyState', () => {
  it('renders high-leverage Chief suggestions', () => {
    render(ChiefChatEmptyState, { props: { onSelect: vi.fn() } });

    expect(screen.getByText(/As your Chief of Staff, I can help you use the app/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /make workspaces for the latest prs/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete stale workspaces/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /analyze my workspaces/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch me to a random theme/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /recurring work chief could automate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /audit risky open work/i })).toBeNull();
  });

  it('does not render shortcut hints', () => {
    render(ChiefChatEmptyState, { props: { onSelect: vi.fn() } });

    expect(screen.queryByText('⌃1')).toBeNull();
    expect(screen.queryByText('Alt+1')).toBeNull();
  });

  it('sends the selected suggestion prompt', async () => {
    const onSelect = vi.fn();
    render(ChiefChatEmptyState, { props: { onSelect } });

    await fireEvent.click(screen.getByRole('button', { name: /analyze my workspaces/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.stringContaining('Propose specialist changes, AGENTS.md updates'),
    );
  });
});