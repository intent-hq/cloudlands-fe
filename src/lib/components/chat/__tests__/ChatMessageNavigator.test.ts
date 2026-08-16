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
  });

  it('opens on click, focuses the first row, and renders responsive quiet chrome', async () => {
    renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const results = await screen.findAllByTestId('chat-message-navigator-result');
    await waitFor(() => expect(document.activeElement).toBe(results[0]));
    expect(screen.queryByTestId('chat-message-navigator-search')).toBeNull();
    expect(screen.getByRole('menu').className).toContain('w-[28rem]');
    expect(screen.getByRole('menu').className).toContain('max-w-[calc(100vw-1rem)]');

    const longResult = results.at(-1)!;
    expect(longResult.getAttribute('title')).toBe(messages.at(-1)!.text);
    expect(longResult.getAttribute('aria-label')).toBe(messages.at(-1)!.text);
    expect(longResult.className).toContain('focus:bg-accent');
    expect(longResult.className).toContain('focus:text-accent-foreground');
    expect(longResult.className).toContain('data-[highlighted]:bg-accent');
    expect(longResult.className).toContain('focus-visible:ring-0');
    expect(longResult.querySelector('span')?.className).toContain('type-caption');
    expect(longResult.querySelector('span')?.className).toContain('truncate');
    expect(longResult.querySelector('span')?.className).toContain('whitespace-nowrap');
  });

  it('cycles matching initial letters with wrap and preserves roving movement keys', async () => {
    renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const [alpha, beta, another, azure, last] = await screen.findAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(alpha));

    await fireEvent.keyDown(alpha, { key: 'a' });
    await waitFor(() => expect(document.activeElement).toBe(another));
    await fireEvent.keyDown(another, { key: 'a' });
    await waitFor(() => expect(document.activeElement).toBe(azure));
    await fireEvent.keyDown(azure, { key: 'a' });
    await waitFor(() => expect(document.activeElement).toBe(alpha));

    await fireEvent.keyDown(alpha, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(beta);
    await fireEvent.keyDown(beta, { key: 'End' });
    expect(document.activeElement).toBe(last);
    await fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(alpha);
  });

  it.each([
    ['Enter', { key: 'Enter' }],
    ['Space', { key: ' ', code: 'Space' }],
  ])('selects the focused row with %s', async (_label, keyboardEvent) => {
    const { onSelectMessage } = renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const first = (await screen.findAllByRole('menuitem'))[0];
    await waitFor(() => expect(document.activeElement).toBe(first));
    await fireEvent.keyDown(first, keyboardEvent);
    await waitFor(() => expect(onSelectMessage).toHaveBeenCalledWith('alpha'));
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
  });

  it('opens with hover intent and stays open while the pointer is in the panel', async () => {
    vi.useFakeTimers();
    renderNavigator();
    const region = screen.getByRole('group', { name: 'Browse user messages' });
    await fireEvent.pointerEnter(region);
    await vi.advanceTimersByTimeAsync(119);
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    const panel = screen.getByTestId('chat-message-navigator-panel');
    await fireEvent.pointerLeave(region);
    await fireEvent.pointerEnter(panel);
    await vi.advanceTimersByTimeAsync(200);
    expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy();
  });

  it('opens from keyboard focus and closes on Escape and outside interaction', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    trigger.focus();
    const first = (await screen.findAllByRole('menuitem'))[0];
    await waitFor(() => expect(document.activeElement).toBe(first));
    await fireEvent.keyDown(first, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());

    await fireEvent.click(trigger);
    await screen.findByTestId('chat-message-navigator-panel');
    await fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    await fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
  });

  it('shows a quiet empty state without a text field', async () => {
    renderNavigator(false, []);
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    expect(screen.getByTestId('chat-message-navigator-empty')).toBeTruthy();
    expect(screen.getByTestId('chat-message-navigator-empty').className).toContain('type-caption');
    expect(screen.queryByTestId('chat-message-navigator-search')).toBeNull();
  });
});
