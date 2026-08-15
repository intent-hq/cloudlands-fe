/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  attachPinnedPromptMessage,
  createPinnedPromptController,
  measureScrollbarGutterWidth,
} from '../pinned-prompt';

function message(id: string): AgentMessage {
  return { id, role: 'user', contentBlocks: [{ type: 'text', text: id }] } as AgentMessage;
}

describe('pinned prompt controller', () => {
  function addPrompt(container: HTMLElement, id: string, sourceBottom: number, turnBottom: number) {
    const turn = document.createElement('div');
    turn.dataset.conversationTurn = '';
    turn.getBoundingClientRect = () => ({ bottom: turnBottom }) as DOMRect;
    const source = document.createElement('div');
    source.dataset.pinnableUserPrompt = '';
    source.dataset.pinnedPromptId = id;
    source.getBoundingClientRect = () => ({ bottom: sourceBottom, height: 42 }) as DOMRect;
    const value = message(id);
    attachPinnedPromptMessage(source, value);
    turn.append(source);
    container.append(turn);
    return { source, turn, message: value };
  }

  it('enters and exits without moving or resizing its source row', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    let sourceBottom = 98;
    let turnBottom = 180;
    const { source, turn } = addPrompt(container, 'prompt-1', sourceBottom, turnBottom);
    source.getBoundingClientRect = () => ({ bottom: sourceBottom, height: 42 }) as DOMRect;
    turn.getBoundingClientRect = () => ({ bottom: turnBottom }) as DOMRect;
    const before = source.getBoundingClientRect();
    const controller = createPinnedPromptController();

    expect(controller.update(container, true)?.id).toBe('prompt-1');
    expect(source.parentElement).toBe(turn);
    expect(source.getBoundingClientRect()).toEqual(before);

    sourceBottom = 101;
    expect(controller.update(container, true)?.id).toBe('prompt-1');
    turnBottom = 100;
    expect(controller.update(container, true)).toBeNull();
  });

  it('disables without retaining an owned source row', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    addPrompt(container, 'prompt-1', 90, 180);
    const controller = createPinnedPromptController();
    expect(controller.update(container, true)?.id).toBe('prompt-1');
    expect(controller.update(container, false)).toBeNull();
  });

  it('updates streaming content without leaking ownership between panels', () => {
    const firstPanel = document.createElement('div');
    const secondPanel = document.createElement('div');
    firstPanel.getBoundingClientRect = secondPanel.getBoundingClientRect = () =>
      ({ top: 100 }) as DOMRect;
    const first = addPrompt(firstPanel, 'shared-id', 90, 180);
    addPrompt(secondPanel, 'shared-id', 120, 200);
    const firstController = createPinnedPromptController();
    const secondController = createPinnedPromptController();

    expect(firstController.update(firstPanel, true)?.message).toBe(first.message);
    expect(secondController.update(secondPanel, true)).toBeNull();

    const streamed = message('streamed-content');
    attachPinnedPromptMessage(first.source, streamed);
    expect(firstController.update(firstPanel, true)?.message).toBe(streamed);
    expect(secondController.update(secondPanel, true)).toBeNull();
  });

  it('recomputes the current prompt after transcript pagination inserts an earlier turn', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    addPrompt(container, 'current', 90, 180);
    const controller = createPinnedPromptController();
    expect(controller.update(container, true)?.id).toBe('current');

    const earlier = document.createElement('div');
    earlier.dataset.conversationTurn = '';
    earlier.getBoundingClientRect = () => ({ bottom: 95 }) as DOMRect;
    const source = document.createElement('div');
    source.dataset.pinnableUserPrompt = '';
    source.dataset.pinnedPromptId = 'earlier';
    source.getBoundingClientRect = () => ({ bottom: 80 }) as DOMRect;
    attachPinnedPromptMessage(source, message('earlier'));
    earlier.append(source);
    container.prepend(earlier);

    expect(controller.update(container, true)?.id).toBe('current');
  });
});

describe('measureScrollbarGutterWidth', () => {
  function scrollContainer(
    offsetWidth: number,
    clientWidth: number,
    borders: { left: string; right: string } = { left: '0px', right: '0px' },
  ): HTMLElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'offsetWidth', { value: offsetWidth });
    Object.defineProperty(element, 'clientWidth', { value: clientWidth });
    element.style.borderStyle = 'solid';
    element.style.borderLeftWidth = borders.left;
    element.style.borderRightWidth = borders.right;
    document.body.append(element);
    return element;
  }

  it('returns the width reserved by the scrollbar gutter', () => {
    expect(measureScrollbarGutterWidth(scrollContainer(720, 704))).toBe(16);
  });

  it('returns zero when no gutter is reserved (overlay scrollbars)', () => {
    expect(measureScrollbarGutterWidth(scrollContainer(720, 720))).toBe(0);
  });

  it('never returns a negative width', () => {
    expect(measureScrollbarGutterWidth(scrollContainer(700, 720))).toBe(0);
  });

  it('excludes horizontal border widths from the measurement', () => {
    expect(
      measureScrollbarGutterWidth(scrollContainer(726, 704, { left: '3px', right: '3px' })),
    ).toBe(16);
  });

  it('returns zero when only borders account for the offset/client delta', () => {
    expect(
      measureScrollbarGutterWidth(scrollContainer(724, 720, { left: '2px', right: '2px' })),
    ).toBe(0);
  });
});
