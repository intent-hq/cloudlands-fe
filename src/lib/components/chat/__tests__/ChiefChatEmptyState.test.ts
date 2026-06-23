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
  it('renders neutral introductory copy and high-leverage suggestions', () => {
    render(ChiefChatEmptyState, { props: { onSelect: vi.fn() } });

    expect(screen.queryByText(/As your Chief of Staff, I can help you use the app/i)).toBeNull();
    expect(screen.queryByText(/Chief of Staff/i)).toBeNull();
    const intro = screen.getByText(/Ask Intent to help you use the app/i);
    expect(intro).toBeTruthy();
    expect(intro.className).toContain('flex-1');
    expect(intro.parentElement?.className).toContain(
      'mb-4 flex items-baseline gap-3 px-1.5 text-foreground',
    );
    expect(screen.getByRole('button', { name: /make workspaces for the latest prs/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete stale workspaces/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /analyze my workspaces/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /prepare my daily brief/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch me to a random theme/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /recurring work chief could automate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /audit risky open work/i })).toBeNull();
  });

  it('keeps suggestion icons visually separated from aligned prompt text', () => {
    render(ChiefChatEmptyState, { props: { onSelect: vi.fn() } });

    const suggestion = screen.getByRole('button', { name: /make workspaces for the latest prs/i });
    const icons = screen.getAllByTestId('chief-suggestion-icon');
    expect(icons).toHaveLength(5);
    expect(suggestion.className).toContain('group flex');
    expect(suggestion.className).toContain('gap-3');
    expect(suggestion.className).not.toContain('-ml-');
    expect(suggestion.querySelector('.absolute')).toBeNull();
    expect(icons[0].className).toContain('w-3 shrink-0');
    expect(icons[0].className).toContain('opacity-70');
    expect(suggestion.querySelector('.flex-1')?.textContent).toContain(
      'Make workspaces for the latest PRs assigned to me.',
    );
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

  it('sends the daily brief prompt without Chief of Staff wording', async () => {
    const onSelect = vi.fn();
    render(ChiefChatEmptyState, { props: { onSelect } });

    await fireEvent.click(screen.getByRole('button', { name: /prepare my daily brief/i }));

    expect(onSelect).toHaveBeenCalledWith(expect.stringContaining('Give me a concise daily brief'));
    expect(onSelect).toHaveBeenCalledWith(expect.not.stringContaining('Chief of Staff'));
  });
});
