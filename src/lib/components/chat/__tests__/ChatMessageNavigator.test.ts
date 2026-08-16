/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ChatMessageNavigator from '../ChatMessageNavigator.svelte';

const messages = [
  { id: 'one', text: 'First user message' },
  {
    id: 'two',
    text: 'A very long user message that must stay on one line and truncate inside the panel width',
  },
];

function renderNavigator(isAtBottom = false) {
  const onSelectMessage = vi.fn().mockResolvedValue(true);
  const onScrollToBottom = vi.fn();
  const view = render(ChatMessageNavigator, {
    props: { messages, isAtBottom, onSelectMessage, onScrollToBottom },
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

  it('opens on click, transfers focus, filters locally, and renders truncated named rows', async () => {
    const { onSelectMessage } = renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const search = await screen.findByTestId('chat-message-navigator-search');
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(
      search.compareDocumentPosition(screen.getAllByTestId('chat-message-navigator-result')[0]),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await fireEvent.input(search, { target: { value: 'very long' } });
    const result = screen.getByTestId('chat-message-navigator-result');
    expect(result.getAttribute('title')).toBe(messages[1].text);
    expect(result.getAttribute('aria-label')).toBe(messages[1].text);
    expect(result.querySelector('span')?.className).toContain('truncate');
    expect(result.querySelector('span')?.className).toContain('whitespace-nowrap');

    await fireEvent.click(result);
    await waitFor(() => expect(onSelectMessage).toHaveBeenCalledWith('two'));
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
    const search = await screen.findByTestId('chat-message-navigator-search');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());

    await fireEvent.click(trigger);
    await screen.findByTestId('chat-message-navigator-panel');
    await fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    await fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
  });

  it('shows the empty result state without removing the search field', async () => {
    renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const search = await screen.findByTestId('chat-message-navigator-search');
    await fireEvent.input(search, { target: { value: 'no match' } });
    expect(screen.getByTestId('chat-message-navigator-empty')).toBeTruthy();
    expect(screen.getByTestId('chat-message-navigator-search')).toBeTruthy();
  });
});
