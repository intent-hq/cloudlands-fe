/**
 * `inputLocked` is the transient composer lock used while a draft restore is
 * in flight. Unlike `disabled` it must reject focus/typing *without* taking
 * the disabled styling path — the placeholder has to stay on screen so the
 * composer does not visibly blank out on a workspace switch.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import TipTapEditor from '../TipTapEditor.svelte';

const PLACEHOLDER = 'Ask anything';

/** The editor mounts asynchronously (dynamic extension imports). */
async function mountEditor(props: Record<string, unknown>) {
  const result = render(TipTapEditor, { props: { placeholder: PLACEHOLDER, ...props } });
  for (let i = 0; i < 20; i++) {
    if (result.container.querySelector('.tiptap-editor')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await tick();
  return result;
}

function editorEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.tiptap-editor');
  if (!el) throw new Error('editor did not mount');
  return el as HTMLElement;
}

describe('TipTapEditor inputLocked', () => {
  afterEach(() => {
    cleanup();
  });

  it('rejects focus while locked and keeps the placeholder rendered', async () => {
    const { container, component } = await mountEditor({ inputLocked: true });

    expect(editorEl(container).getAttribute('contenteditable')).toBe('false');
    // Placeholder is rendered via the empty-editor class + data-placeholder,
    // which must survive the lock (showOnlyWhenEditable: false).
    const paragraph = container.querySelector('.tiptap-editor p');
    expect(paragraph?.classList.contains('is-editor-empty')).toBe(true);
    expect(paragraph?.getAttribute('data-placeholder')).toBe(PLACEHOLDER);

    expect(component.focus()).toBe(false);
    expect(component.focusEnd()).toBe(false);
    expect(component.focusAndSelectAll()).toBe(false);
  });

  it('restores editability and focusability when the lock releases', async () => {
    const { container, component, rerender } = await mountEditor({ inputLocked: true });
    expect(editorEl(container).getAttribute('contenteditable')).toBe('false');

    await rerender({ placeholder: PLACEHOLDER, inputLocked: false });
    await tick();

    expect(editorEl(container).getAttribute('contenteditable')).toBe('true');
    // focus() no longer short-circuits on the lock (jsdom does not report a
    // real focused view, so focusEnd is the observable non-rejecting path).
    expect(component.focusEnd()).toBe(true);
  });

  it('stays editable when neither disabled nor locked', async () => {
    const { container } = await mountEditor({});
    expect(editorEl(container).getAttribute('contenteditable')).toBe('true');
  });
});
