/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SuggestedPrompts from '../SuggestedPrompts.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

afterEach(cleanup);

describe('SuggestedPrompts', () => {
  it('uses the canonical compact-action style and preserves selection behavior', async () => {
    const onSelect = vi.fn();
    render(SuggestedPrompts, {
      props: {
        prompts: ['Approved, proceed with delegation.'],
        onSelect,
      },
    });

    const suggestion = screen.getByRole('button', { name: 'Approved, proceed with delegation.' });
    expect(suggestion.className).toContain('type-caption');
    expect(suggestion.getAttribute('data-typography-role')).toBe('caption');

    await fireEvent.click(suggestion);
    expect(onSelect).toHaveBeenCalledWith('Approved, proceed with delegation.');
  });

  it('keeps prompt rows closely grouped in tall chat panels', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['First prompt', 'Second prompt'],
        onSelect: vi.fn(),
      },
    });

    expect(screen.getByTestId('suggested-prompts-list').className).toContain('gap-0.5');
    expect(screen.getByRole('button', { name: 'First prompt' }).className).toContain('py-0.5');
  });

  it('groups follow-up prompts on a quiet surface separate from response prose', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['First prompt'],
        onSelect: vi.fn(),
      },
    });

    const surface = screen.getByTestId('suggested-prompts-surface');
    expect(surface.className).not.toContain('bg-');
    expect(surface.className).not.toContain('rounded');
    expect(surface.className).not.toContain('border');
    const prompt = screen.getByRole('button', { name: 'First prompt' });
    expect(prompt.className).toContain('gap-2');
    expect(prompt.className).toContain('px-1.5');
    expect(prompt.className).toContain('hover:bg-muted/30');
    const source = readFileSync(resolve('src/lib/components/chat/SuggestedPrompts.svelte'), 'utf8');
    expect(source).toContain('class="mt-1.5 w-4 shrink-0');
  });

  it('removes row gaps and tightens padding in short chat panels', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['First prompt', 'Second prompt'],
        onSelect: vi.fn(),
        compact: true,
      },
    });

    const list = screen.getByTestId('suggested-prompts-list');
    expect(list.className).toContain('gap-0');
    expect(list.getAttribute('data-compact')).toBe('true');
    expect(screen.getByRole('button', { name: 'First prompt' }).className).toContain('py-0.5');
  });

  it('connects chat panel compact mode to prompt spacing', () => {
    const chatPanel = readFileSync(resolve('src/lib/components/chat/ChatPanel.svelte'), 'utf8');

    expect(chatPanel).toContain("class=\"w-full {isCompactMode ? 'pb-1 pt-2' : 'py-2'}\"");
    expect(chatPanel).toContain('compact={isCompactMode}');
  });

  it('renders muted regular-weight shortcut hints at the prompt caption size', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['Approved, proceed with delegation.'],
        onSelect: vi.fn(),
        showShortcutHints: true,
      },
    });

    const hint = screen.getByText(/(?:⌃|Alt\+)1/);
    expect(hint.className).toContain('font-normal');
    expect(hint.className).toContain('text-muted-foreground/50');
    expect(hint.className).not.toContain('font-medium');
    expect(hint.className.split(/\s+/)).not.toContain('text-ui');
    expect(hint.parentElement?.className).toContain('type-caption');
  });
});
