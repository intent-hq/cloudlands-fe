import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TipTapEditor from '../TipTapEditor.svelte';
import type { DockEvidenceInsertion, EditorScreenReference } from '$shared/dock-evidence';

const reference: EditorScreenReference = { id: 'mark-one', number: 1, label: 'Save' };
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(() => {
  // JSDOM has no Range layout. These tests assert text/focus, never measured geometry.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  cleanup();
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBounds);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

describe('controlled evidence events in the production TipTap component', () => {
  it('waits for the controlled owner to consume one head before inserting the next event', async () => {
    const applied = vi.fn();
    const first = { id: 'first-event', parts: [{ kind: 'text' as const, text: 'one' }] };
    const second = { id: 'second-event', parts: [{ kind: 'text' as const, text: 'two' }] };
    const props = {
      value: 'Start',
      screenReferences: [reference],
      screenInsertions: [first, second],
      onScreenInsertionApplied: applied,
    };
    const result = render(TipTapEditor, { props });
    await waitFor(() => expect(applied).toHaveBeenCalled());
    expect(applied.mock.calls.every(([id]) => id === first.id)).toBe(true);
    expect(result.component.getTextContent()).toContain('one');
    expect(result.component.getTextContent()).not.toContain('two');
    expect(result.component.flushScreenEvidence()).toBe(false);
    await result.rerender({ ...props, screenInsertions: [second] });
    await waitFor(() => expect(applied.mock.calls.some(([id]) => id === second.id)).toBe(true));
    expect(result.component.getTextContent().split('one')).toHaveLength(2);
    expect(result.component.getTextContent()).toContain('two');
  });

  it('commits one insertion without an independent ordinary draft write or focus transfer', async () => {
    const applied = vi.fn();
    const updated = vi.fn();
    const props = {
      value: 'Before ',
      screenReferences: [reference],
      screenInsertions: [],
      onScreenInsertionApplied: applied,
      onUpdate: updated,
    };
    const result = render(TipTapEditor, { props });
    await waitFor(() => expect(result.container.querySelector('.tiptap-editor')).not.toBeNull());
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const insertion: DockEvidenceInsertion = {
      id: 'event-1',
      parts: [
        { kind: 'text', text: ' spoken ' },
        { kind: 'mark', markId: reference.id },
      ],
    };
    await result.rerender({ ...props, screenInsertions: [insertion] });
    await waitFor(() => expect(applied).toHaveBeenCalled());
    expect(updated).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    const text = result.component.getTextContent();
    await result.rerender({ ...props, screenInsertions: [{ ...insertion }] });
    await tick();
    expect(result.component.getTextContent()).toBe(text);
    expect(result.container.querySelectorAll('[data-screen-reference]')).toHaveLength(1);
    button.remove();
  });

  it('defers an evidence event until the final composition text commits', async () => {
    const applied = vi.fn();
    const props = {
      value: 'A',
      screenReferences: [reference],
      screenInsertions: [],
      onScreenInsertionApplied: applied,
    };
    const result = render(TipTapEditor, { props });
    await waitFor(() => expect(result.container.querySelector('.tiptap-editor p')).not.toBeNull());
    const element = result.container.querySelector<HTMLElement>('.tiptap-editor');
    if (!element) throw Error('Editor missing');
    element.focus();
    await fireEvent.compositionStart(element);
    const paragraph = element.querySelector('p');
    if (!paragraph) throw Error('Paragraph missing');
    paragraph.textContent = 'A漢';
    const caret = document.createRange();
    caret.selectNodeContents(paragraph);
    caret.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);
    await fireEvent.input(element, {
      inputType: 'insertCompositionText',
      data: '漢',
      isComposing: true,
    });
    const insertion: DockEvidenceInsertion = {
      id: 'event-ime',
      parts: [
        { kind: 'text', text: ' voice ' },
        { kind: 'mark', markId: reference.id },
      ],
    };
    await result.rerender({ ...props, screenInsertions: [insertion] });
    expect(applied).not.toHaveBeenCalled();
    expect(result.component.flushScreenEvidence()).toBe(false);
    expect(element.textContent).toBe('A漢');
    await fireEvent.compositionEnd(element, { data: '漢' });
    await waitFor(() => expect(applied).toHaveBeenCalled());
    expect(result.component.getTextContent()).toBe('A漢 voice [[mark:1]]');
  });
});
