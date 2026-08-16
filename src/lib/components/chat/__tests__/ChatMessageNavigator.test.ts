/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ChatMessageNavigator from '../ChatMessageNavigator.svelte';

const messages = [
  { id: 'alpha', text: 'Alpha first user message' },
  { id: 'beta', text: 'Beta user message' },
  { id: 'another', text: 'Another user message' },
  { id: 'azure', text: 'Azure user message' },
  {
    id: 'long',
    text: 'This very long user message must stay on one line and truncate inside the panel width',
  },
];

function renderNavigator(isAtBottom = false, navigationMessages = messages) {
  const onSelectMessage = vi.fn().mockResolvedValue(true);
  const onScrollToBottom = vi.fn();
  const view = render(ChatMessageNavigator, {
    props: { messages: navigationMessages, isAtBottom, onSelectMessage, onScrollToBottom },
  });
  return { ...view, onSelectMessage, onScrollToBottom };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChatMessageNavigator', () => {
  it('keeps the list button immediately before the stable down arrow', () => {
    renderNavigator(true);
    const controls = screen.getByTestId('chat-header-navigation-controls');
    const buttons = controls.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBe(screen.getByTestId('chat-message-navigator-trigger'));
    expect(buttons[1]).toBe(screen.getByTestId('chat-scroll-to-bottom-button'));
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[0].querySelector('[data-icon]')?.classList.contains('size-3!')).toBe(true);
    expect(buttons[1].querySelector('[data-icon]')?.classList.contains('size-[11px]!')).toBe(true);
  });

  it('opens a valid searchable listbox and autofocuses its quiet field', async () => {
    renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const results = await screen.findAllByTestId('chat-message-navigator-result');
    const input = screen.getByRole('combobox', { name: 'Filter user messages' });
    const listbox = screen.getByRole('listbox');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(results.every((result) => result.getAttribute('role') === 'option')).toBe(true);
    expect(results.every((result) => listbox.contains(result))).toBe(true);
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input.getAttribute('aria-activedescendant')).toBe(results[0].id);
    expect(input.className).toContain('focus-visible:ring-0');
    expect(input.className).toContain('focus-visible:border-foreground/40');

    const panel = screen.getByTestId('chat-message-navigator-panel').parentElement!;
    expect(panel.className).toContain('w-[28rem]');
    expect(panel.className).toContain('max-w-[calc(100vw-1rem)]');

    const longResult = results.at(-1)!;
    expect(longResult.getAttribute('title')).toBe(messages.at(-1)!.text);
    expect(results[0].className).toContain('bg-muted');
    expect(results[0].className).toContain('text-foreground');
    expect(longResult.className).toContain('type-caption');
    expect(longResult.className).toContain('font-normal');
    expect(longResult.querySelector('span')?.className).toContain('truncate');
    expect(longResult.querySelector('span')?.className).toContain('whitespace-nowrap');
  });

  it('keeps printable input in the search field and filters sanitized previews', async () => {
    renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const input = screen.getByRole('combobox', {
      name: 'Filter user messages',
    }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    await fireEvent.input(input, { target: { value: 'azure' } });
    expect(input.value).toBe('azure');
    expect(document.activeElement).toBe(input);
    const result = screen.getByRole('option', { name: 'Azure user message' });
    expect(screen.getAllByRole('option')).toEqual([result]);
    expect(input.getAttribute('aria-activedescendant')).toBe(result.id);
  });

  it('keeps focus in the field while Arrow, Home, End, and Enter navigate options', async () => {
    const { onSelectMessage } = renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const input = screen.getByRole('combobox', { name: 'Filter user messages' });
    const options = screen.getAllByRole('option');
    await waitFor(() => expect(document.activeElement).toBe(input));
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
    await fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSelectMessage).toHaveBeenCalledWith('alpha'));
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
  });

  it('opens with hover intent', async () => {
    vi.useFakeTimers();
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    await fireEvent.pointerEnter(trigger);
    await vi.advanceTimersByTimeAsync(119);
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy();
  });

  it('opens from the trigger and closes on Escape', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
  });

  it('shows a quiet empty state with its search field', async () => {
    renderNavigator(false, []);
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    expect(screen.getByTestId('chat-message-navigator-empty')).toBeTruthy();
    expect(screen.getByTestId('chat-message-navigator-empty').className).toContain('type-caption');
    expect(screen.getByTestId('chat-message-navigator-search')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
