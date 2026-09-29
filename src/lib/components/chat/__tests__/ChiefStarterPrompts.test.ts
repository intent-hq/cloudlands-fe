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
  it('sends the full prompt represented by a concise starter label', async () => {
    const onSelect = vi.fn();
    render(ChiefStarterPrompts, { props: { onSelect } });

    await fireEvent.click(screen.getByRole('button', { name: /analyze my workspaces/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.stringContaining('Propose specialist changes, AGENTS.md updates'),
    );
  });

  it('sends the daily brief prompt without obsolete Chief of Staff wording', async () => {
    const onSelect = vi.fn();
    render(ChiefStarterPrompts, { props: { onSelect } });

    await fireEvent.click(screen.getByRole('button', { name: /prepare my daily brief/i }));

    expect(onSelect).toHaveBeenCalledWith(expect.stringContaining('Give me a concise daily brief'));
    expect(onSelect).toHaveBeenCalledWith(expect.not.stringContaining('Chief of Staff'));
  });
});
