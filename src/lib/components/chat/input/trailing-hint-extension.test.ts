// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TrailingHintExtension, trailingHintPluginKey } from './trailing-hint-extension';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('TrailingHintExtension', () => {
  it('renders an actionable hint after the final prompt text', () => {
    const onActivate = vi.fn();
    const element = document.createElement('div');
    document.body.append(element);
    editor = new Editor({
      element,
      content: '<p>hello</p><p></p>',
      extensions: [StarterKit, TrailingHintExtension],
    });

    editor.view.dispatch(
      editor.state.tr.setMeta(trailingHintPluginKey, {
        kind: 'ready',
        label: '',
        shortcut: '→',
        ariaLabel: 'Enhance prompt',
        onActivate,
      }),
    );

    const hint = element.querySelector<HTMLButtonElement>('.prompt-trailing-hint');
    expect(hint?.parentElement).toBe(element.querySelector('p'));
    expect(hint?.textContent).toBe('→');
    expect(hint?.getAttribute('aria-label')).toBe('Enhance prompt');

    vi.useFakeTimers();
    hint?.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(300);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Enhance prompt');
    hint?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    hint?.click();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('activates with Right Arrow only when the caret is at the prompt end', () => {
    const onActivate = vi.fn();
    const element = document.createElement('div');
    document.body.append(element);
    editor = new Editor({
      element,
      content: '<p>hello</p>',
      extensions: [StarterKit, TrailingHintExtension],
    });
    editor.view.dispatch(
      editor.state.tr.setMeta(trailingHintPluginKey, {
        kind: 'ready',
        label: 'Enhance',
        shortcut: '→',
        ariaLabel: 'Enhance prompt',
        onActivate,
      }),
    );

    editor.commands.setTextSelection(2);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onActivate).not.toHaveBeenCalled();

    editor.commands.focus('end');
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onActivate).toHaveBeenCalledOnce();

    editor.view.dispatch(
      editor.state.tr.setMeta(trailingHintPluginKey, {
        kind: 'enhancing',
        label: 'Enhancing',
        icon: 'dismiss',
        ariaLabel: 'Stop enhancing',
        onActivate,
      }),
    );
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('renders muted action icons with distinct state identities', () => {
    const onActivate = vi.fn();
    const element = document.createElement('div');
    document.body.append(element);
    editor = new Editor({
      element,
      content: '<p>hello</p>',
      extensions: [StarterKit, TrailingHintExtension],
    });

    editor.view.dispatch(
      editor.state.tr.setMeta(trailingHintPluginKey, {
        kind: 'enhanced',
        label: 'Enhanced',
        icon: 'undo',
        ariaLabel: 'Undo enhancement',
        onActivate,
      }),
    );

    const hint = element.querySelector<HTMLElement>('.prompt-trailing-hint');
    expect(hint?.dataset.state).toBe('enhanced');
    const action = hint?.querySelector<HTMLButtonElement>('.prompt-trailing-hint-action');
    expect(action?.querySelector('svg')).not.toBeNull();
    action?.click();
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
