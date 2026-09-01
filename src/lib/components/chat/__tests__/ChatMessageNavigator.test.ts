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

function renderNavigator(
  isAtBottom = false,
  navigationMessages = messages,
  isLoadingIndex = false,
) {
  const onSelectMessage = vi.fn().mockResolvedValue(true);
  const onScrollToBottom = vi.fn();
  const view = render(ChatMessageNavigator, {
    props: {
      messages: navigationMessages,
      isAtBottom,
      isLoadingIndex,
      onSelectMessage,
      onScrollToBottom,
    },
  });
  return { ...view, onSelectMessage, onScrollToBottom };
}

function afterAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChatMessageNavigator', () => {
  it('keeps the mirrored chat button immediately before the stable down arrow', () => {
    renderNavigator(true);
    const controls = screen.getByTestId('chat-header-navigation-controls');
    const buttons = controls.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBe(screen.getByTestId('chat-message-navigator-trigger'));
    expect(buttons[1]).toBe(screen.getByTestId('chat-scroll-to-bottom-button'));
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    const chatIcon = buttons[0].querySelector('[data-chat-message-navigator-chat-icon]');
    expect(chatIcon?.classList.contains('size-3.5!')).toBe(true);
    expect(chatIcon?.getAttribute('transform')).toBe('scale(-1, 1)');
    expect(buttons[0].querySelector('[data-icon]')).toBeNull();
    expect(buttons[1].querySelector('[data-icon]')?.classList.contains('size-4!')).toBe(true);
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
    expect(results.map((result) => result.getAttribute('data-navigation-message-id'))).toEqual(
      messages.map((message) => message.id),
    );
    expect(results.every((result) => !result.hasAttribute('data-message-id'))).toBe(true);
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input.getAttribute('aria-activedescendant')).toBe(results.at(-1)!.id);
    expect(input.className).toContain('h-(--control-height-medium)');
    expect(input.className).toContain('outline-none');
    expect(input.className).toContain('caret-foreground');
    expect(input.className).toContain('focus-visible:border-ring');

    const panel = screen.getByTestId('chat-message-navigator-panel').parentElement!;
    expect(panel.className).toContain('w-[28rem]');
    expect(panel.className).toContain('--bits-popover-content-available-width');
    expect(panel.className).toContain('max-h-[var(--bits-popover-content-available-height)]');
    expect(panel.className).toContain('overflow-hidden');
    expect(screen.getByTestId('chat-message-navigator-panel').className).toContain('min-h-0');
    expect(listbox.className).toContain('min-h-0');
    expect(listbox.className).toContain('flex-1');
    expect(listbox.className).toContain('max-h-72');
    expect(listbox.className).toContain('overflow-x-hidden');

    const longResult = results.at(-1)!;
    expect(longResult.getAttribute('title')).toBeNull();
    expect(longResult.className).toContain('bg-accent');
    expect(longResult.className).toContain('text-accent-foreground');
    expect(longResult.className).toContain('type-caption');
    expect(longResult.className).toContain('font-normal');
    expect(longResult.className).toContain('h-(--control-height-large)');
    expect(results.every((result) => result.className.includes('text-left'))).toBe(true);
    expect(longResult.className).toContain('focus-visible:ring-inset');
    expect(longResult.querySelector('span')?.className).toContain('overflow-hidden');
    expect(longResult.querySelector('span')?.className).toContain('whitespace-nowrap');
    expect(longResult.querySelector('span')?.className).toContain('text-ellipsis');
    expect(longResult.querySelector('span')?.className).toContain('text-left');

    longResult.focus();
    await fireEvent.focus(longResult);
    const tooltip = await screen.findByRole('tooltip', {
      name: messages.at(-1)!.text,
      hidden: true,
    });
    await waitFor(() => expect(longResult.getAttribute('aria-describedby')).toBe(tooltip.id));
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
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
    await fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSelectMessage).toHaveBeenCalledWith('alpha'));
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
  });

  it('does not open from hover or focus alone', async () => {
    vi.useFakeTimers();
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    trigger.focus();
    await fireEvent.focus(trigger);
    await vi.runAllTimersAsync();
    expect(trigger).toBe(document.activeElement);
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
  });

  it('opens with Space only after the trigger is focused', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    trigger.focus();
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    await fireEvent.keyDown(trigger, { key: ' ' });
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('does not steal focus after dismissal or message selection', async () => {
    const { onSelectMessage } = renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    const downButton = screen.getByTestId('chat-scroll-to-bottom-button');

    await fireEvent.click(trigger);
    let input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    downButton.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(downButton);

    await fireEvent.keyDown(trigger, { key: ' ' });
    input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    onSelectMessage.mockImplementation(async () => {
      expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
      downButton.focus();
      return true;
    });
    await fireEvent.click(screen.getAllByRole('option')[0]);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    expect(document.activeElement).toBe(downButton);
  });

  it('stays open while pointer and focus move from the trigger into the panel', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    await fireEvent.click(trigger);
    const panel = screen.getByTestId('chat-message-navigator-panel');

    await fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    await fireEvent.pointerEnter(panel, { pointerType: 'mouse' });
    expect(screen.getByTestId('chat-message-navigator-panel')).toBe(panel);

    const option = screen.getAllByTestId('chat-message-navigator-result')[1];
    option.focus();
    await fireEvent.focusIn(option);
    expect(screen.getByTestId('chat-message-navigator-panel')).toBe(panel);
  });

  it('keeps trigger and content focus inside and dismisses on true outside focus', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    const downButton = screen.getByTestId('chat-scroll-to-bottom-button');

    await fireEvent.click(trigger);
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const option = screen.getAllByRole('option')[1];
    option.focus();
    expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy();

    trigger.focus();
    expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy();
    option.focus();
    await afterAnimationFrame();
    downButton.focus();
    await fireEvent.focusIn(downButton);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    expect(document.activeElement).toBe(downButton);
  });

  it('stays closed on later pointer intent and still opens from touch activation', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    const downButton = screen.getByTestId('chat-scroll-to-bottom-button');
    await fireEvent.click(trigger);
    await screen.findByRole('combobox', { name: 'Filter user messages' });
    await afterAnimationFrame();
    downButton.focus();
    await fireEvent.focusIn(downButton);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());

    await fireEvent.pointerOver(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 12,
      clientY: 10,
      relatedTarget: downButton,
    });
    await fireEvent.pointerMove(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 13,
      clientY: 10,
    });
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();

    await fireEvent.pointerDown(trigger, { pointerType: 'touch', pointerId: 2 });
    await fireEvent.pointerUp(trigger, { pointerType: 'touch', pointerId: 2 });
    await fireEvent.click(trigger);
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
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

  it('starts with the most recent message active on open and after filtering', async () => {
    renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const input = screen.getByRole('combobox', { name: 'Filter user messages' });
    let options = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
    expect(options.at(-1)!.getAttribute('aria-selected')).toBe('true');

    await fireEvent.input(input, { target: { value: 'user message' } });
    options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
  });

  it('keeps the newest message active while index items are prepended', async () => {
    const view = renderNavigator(false, messages.slice(3));
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const input = screen.getByRole('combobox', { name: 'Filter user messages' });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    await view.rerender({ messages });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(messages.length);
    expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
    expect(options.at(-1)!.getAttribute('data-navigation-message-id')).toBe('long');
  });

  it('keeps the same message active by identity after the user moved and items are prepended', async () => {
    const view = renderNavigator(false, messages.slice(3));
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const input = screen.getByRole('combobox', { name: 'Filter user messages' });
    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    const before = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(before[0].id);
    expect(before[0].getAttribute('data-navigation-message-id')).toBe('azure');

    await view.rerender({ messages });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(messages.length);
    const active = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(active?.getAttribute('data-navigation-message-id')).toBe('azure');
    expect(input.getAttribute('aria-activedescendant')).toBe(active!.id);
  });

  it('releases the end anchor on user scroll but not on programmatic scroll', async () => {
    const newerA = { id: 'newer-a', text: 'Newer message a' };
    const newerB = { id: 'newer-b', text: 'Newer message b' };
    const view = renderNavigator();
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const input = screen.getByRole('combobox', { name: 'Filter user messages' });
    const listbox = screen.getByRole('listbox');

    // The scroll-into-view effect has just run for the open: a scroll event
    // inside its suppression window (before the next animation frame) must
    // not release the anchor, so a new last item still becomes active.
    await fireEvent.scroll(listbox);
    await view.rerender({ messages: [...messages, newerA] });
    let options = screen.getAllByTestId('chat-message-navigator-result');
    expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
    expect(options.at(-1)!.getAttribute('data-navigation-message-id')).toBe('newer-a');

    // After the suppression window closes, a scroll is user intent and
    // releases the anchor: the active option no longer follows the end.
    await afterAnimationFrame();
    await afterAnimationFrame();
    await fireEvent.scroll(listbox);
    await view.rerender({ messages: [...messages, newerA, newerB] });
    options = screen.getAllByTestId('chat-message-navigator-result');
    const active = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(active?.getAttribute('data-navigation-message-id')).toBe('newer-a');
    expect(active).not.toBe(options.at(-1));
    expect(input.getAttribute('aria-activedescendant')).toBe(active!.id);
  });

  it('shows a loading row while the index fetch is in flight and removes it after', async () => {
    const view = renderNavigator(false, messages, true);
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const loading = screen.getByTestId('chat-message-navigator-loading');
    expect(loading.querySelector('[data-slot="spinner"]')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(messages.length);

    await view.rerender({ isLoadingIndex: false });
    expect(screen.queryByTestId('chat-message-navigator-loading')).toBeNull();
  });

  it('announces loading through a persistent live region that outlives the loader', async () => {
    const view = renderNavigator(false, messages, false);
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    const region = screen.getByTestId('chat-message-navigator-loading-region');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByTestId('chat-message-navigator-loading')).toBeNull();

    await view.rerender({ isLoadingIndex: true });
    expect(screen.getByTestId('chat-message-navigator-loading-region')).toBe(region);
    expect(region.contains(screen.getByTestId('chat-message-navigator-loading'))).toBe(true);

    await view.rerender({ isLoadingIndex: false });
    expect(screen.getByTestId('chat-message-navigator-loading-region')).toBe(region);
    expect(screen.queryByTestId('chat-message-navigator-loading')).toBeNull();
  });

  it('shows the loader instead of the empty state when no items are cached yet', async () => {
    renderNavigator(false, [], true);
    await fireEvent.click(screen.getByTestId('chat-message-navigator-trigger'));
    expect(screen.getByTestId('chat-message-navigator-loading')).toBeTruthy();
    expect(screen.queryByTestId('chat-message-navigator-empty')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
