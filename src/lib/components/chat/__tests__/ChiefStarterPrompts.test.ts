/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChiefStarterPrompts from '../ChiefStarterPrompts.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

describe('ChiefStarterPrompts', () => {
  it('uses the shared prompt list with the Chief hint and starter labels', () => {
    render(ChiefStarterPrompts, { props: { onSelect: vi.fn() } });

    const hint = screen.getByText(/Ask Intent to help you use the app/i);
    expect(hint.closest('section')?.className).toContain('pt-6');
    expect(hint.closest('section')?.className).not.toContain('mt-auto');
    expect(screen.getByTestId('suggested-prompts-list')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /make workspaces for the latest prs/i }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete stale workspaces/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /analyze my workspaces/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /prepare my daily brief/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch me to a random theme/i })).toBeTruthy();
  });

  it('sends the full prompt represented by a concise starter label', async () => {
    const onSelect = vi.fn();
    render(ChiefStarterPrompts, { props: { onSelect } });

    await fireEvent.click(screen.getByRole('button', { name: /analyze my workspaces/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.stringContaining('Propose specialist changes, AGENTS.md updates'),
    );
  });
});
