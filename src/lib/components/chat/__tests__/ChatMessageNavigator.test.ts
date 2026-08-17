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
    expect(buttons[1].querySelector('[data-icon]')?.classList.contains('size-5!')).toBe(true);
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
    expect(input.getAttribute('aria-activedescendant')).toBe(results[0].id);
    expect(input.className).toContain('h-(--control-height-medium)');
    expect(input.className).toContain('outline-none');
    expect(input.className).toContain('caret-foreground');
    expect(input.className).not.toMatch(/focus(?:-visible)?:|hover:border|ring-|shadow-/);

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
    expect(results[0].className).toContain('bg-accent');
    expect(results[0].className).toContain('text-accent-foreground');
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
    expect(document.activeElement).toBe(screen.getByTestId('chat-message-navigator-search'));
  });

  it('opens with Space and from focus without a click', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    await fireEvent.keyDown(trigger, { key: ' ' });
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());

    trigger.focus();
    await waitFor(() => expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox')));
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
      downButton.focus();
      return true;
    });
    await fireEvent.click(screen.getAllByRole('option')[0]);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    expect(document.activeElement).toBe(downButton);
  });

  it('stays open while pointer and focus move from the trigger into the panel', async () => {
    vi.useFakeTimers();
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    await vi.advanceTimersByTimeAsync(120);
    await Promise.resolve();
    const panel = screen.getByTestId('chat-message-navigator-panel');

    await fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    await fireEvent.pointerEnter(panel, { pointerType: 'mouse' });
    await vi.advanceTimersByTimeAsync(181);
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

    trigger.focus();
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const option = screen.getAllByRole('option')[1];
    option.focus();
    expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy();

    trigger.focus();
    expect(screen.getByTestId('chat-message-navigator-panel')).toBeTruthy();
    option.focus();
    downButton.focus();
    await fireEvent.focusIn(downButton);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    expect(document.activeElement).toBe(downButton);
  });

  it('reopens on later mouse hover intent but not stationary movement or touch', async () => {
    renderNavigator();
    const trigger = screen.getByTestId('chat-message-navigator-trigger');
    const downButton = screen.getByTestId('chat-scroll-to-bottom-button');
    const pointerTrace: Array<{ type: string; pointerType: string; x: number; y: number }> = [];
    for (const type of ['pointerover', 'pointerenter', 'pointermove']) {
      trigger.addEventListener(type, (event) => {
        const pointer = event as PointerEvent;
        pointerTrace.push({
          type,
          pointerType: pointer.pointerType,
          x: pointer.clientX,
          y: pointer.clientY,
        });
      });
    }

    trigger.focus();
    await screen.findByRole('combobox', { name: 'Filter user messages' });
    await fireEvent.pointerOver(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      relatedTarget: downButton,
    });
    await fireEvent.pointerEnter(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    downButton.focus();
    await fireEvent.focusIn(downButton);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    pointerTrace.length = 0;

    await fireEvent.pointerMove(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    await fireEvent.pointerOver(trigger, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 12,
      clientY: 10,
      relatedTarget: downButton,
    });
    await fireEvent.pointerEnter(trigger, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 12,
      clientY: 10,
    });
    await fireEvent.pointerMove(trigger, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 12,
      clientY: 10,
    });
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    await fireEvent.pointerOver(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 11,
      clientY: 10,
      relatedTarget: downButton,
    });
    const input = await screen.findByRole('combobox', { name: 'Filter user messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(pointerTrace).toEqual([
      { type: 'pointermove', pointerType: 'mouse', x: 10, y: 10 },
      { type: 'pointerover', pointerType: 'touch', x: 12, y: 10 },
      { type: 'pointerenter', pointerType: 'touch', x: 12, y: 10 },
      { type: 'pointermove', pointerType: 'touch', x: 12, y: 10 },
      { type: 'pointerover', pointerType: 'mouse', x: 11, y: 10 },
    ]);

    downButton.focus();
    await fireEvent.focusIn(downButton);
    await waitFor(() => expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull());
    pointerTrace.length = 0;
    await fireEvent.pointerMove(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 11,
      clientY: 10,
    });
    expect(screen.queryByTestId('chat-message-navigator-panel')).toBeNull();
    await fireEvent.pointerMove(trigger, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 12,
      clientY: 10,
    });
    await screen.findByRole('combobox', { name: 'Filter user messages' });
    expect(pointerTrace).toEqual([
      { type: 'pointermove', pointerType: 'mouse', x: 11, y: 10 },
      { type: 'pointermove', pointerType: 'mouse', x: 12, y: 10 },
    ]);
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
