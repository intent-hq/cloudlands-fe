import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';
import type { MessageComposerProps } from './types';

// Controlled clipboard transport tests. Trusted OS input is covered separately.
describe('public composer clipboard file intake', () => {
  let node: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const filesChanged = vi.fn();
  const send = vi.fn();
  const changed = vi.fn();
  const png = (name = 'image.png') =>
    new File(['image bytes'], name, { type: 'image/png', lastModified: 1 });
  const item = (file: File | null) => ({ kind: 'file', getAsFile: () => file });

  async function render(props: Partial<MessageComposerProps> = {}) {
    await act(async () => {
      root.render(
        <MessageComposer
          value={'before Ω\nafter'}
          onValueChange={changed}
          onSend={send}
          onFilesChange={filesChanged}
          {...props}
        />,
      );
    });
    return node.querySelector('textarea')!;
  }

  async function paste(data?: unknown) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data ?? null });
    await act(async () => node.querySelector('textarea')!.dispatchEvent(event));
    return event;
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  });

  it('admits a clipboard file once without changing text, caret or sending', async () => {
    const input = await render();
    input.focus();
    input.setSelectionRange(3, 5);
    const file = png();
    const event = await paste({ items: [item(file)], files: [file] });
    expect(filesChanged).toHaveBeenCalledExactlyOnceWith([file]);
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('before Ω\nafter');
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 5]);
    expect(document.activeElement).toBe(input);
    expect(changed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses the existing deduplication and accumulated maxFiles policy', async () => {
    const old = png('old.png');
    const next = png('next.png');
    const overflow = png('overflow.png');
    await render({ files: [old], maxFiles: 2 });
    await paste({ items: [item(old), item(next), item(next), item(overflow)], files: [next] });
    expect(filesChanged).toHaveBeenCalledExactlyOnceWith([old, next]);
  });

  it('accepts a non-image file through the configured public accept policy', async () => {
    const file = new File(['plain Ω'], 'note.txt', { type: 'text/plain' });
    await render({ accept: '.txt' });
    expect((await paste({ items: [item(file)], files: [file] })).defaultPrevented).toBe(true);
    expect(filesChanged).toHaveBeenCalledExactlyOnceWith([file]);
  });

  it('falls back to FileList when no usable file item exists', async () => {
    const file = png();
    await render();
    await paste({ items: [item(null)], files: [file] });
    expect(filesChanged).toHaveBeenCalledExactlyOnceWith([file]);
  });

  it('uses file items once when FileList wraps the same native image with a different timestamp', async () => {
    const first = png();
    const second = new File(['image bytes'], 'image.png', {
      type: 'image/png',
      lastModified: 2,
    });
    await render();
    await paste({ items: [item(first)], files: [second] });
    expect(filesChanged).toHaveBeenCalledExactlyOnceWith([first]);
  });

  it.each([
    ['ordinary text', { items: [{ kind: 'string' }], files: [] }],
    ['unavailable clipboard', null],
    ['missing file', { items: [item(null)], files: [] }],
    [
      'unsupported type',
      { items: [item(new File(['x'], 'x.exe', { type: 'application/octet-stream' }))], files: [] },
    ],
  ])('does not consume %s or synthesize text/uploads', async (_name, data) => {
    await render();
    expect((await paste(data)).defaultPrevented).toBe(false);
    expect(filesChanged).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['duplicate', 'full', 'zero'] as const)(
    'does not admit an extra file for %s intake',
    async (reason) => {
      const existing = png();
      await render({
        files: reason === 'zero' ? [] : [existing],
        maxFiles: reason === 'zero' ? 0 : reason === 'full' ? 1 : undefined,
      });
      const incoming = reason === 'duplicate' ? existing : png('new.png');
      expect((await paste({ items: [item(incoming)], files: [incoming] })).defaultPrevented).toBe(
        false,
      );
      expect(filesChanged).not.toHaveBeenCalled();
    },
  );

  it('composes the textarea caller handler and respects its cancellation', async () => {
    const onPaste = vi.fn((event: React.ClipboardEvent<HTMLTextAreaElement>) =>
      event.preventDefault(),
    );
    await render({ textareaProps: { onPaste } });
    const file = png();
    await paste({ items: [item(file)], files: [file] });
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(filesChanged).not.toHaveBeenCalled();
  });

  it('calls the textarea handler once for accepted files and ordinary text', async () => {
    const onPaste = vi.fn();
    await render({ textareaProps: { onPaste } });
    const file = png();
    await paste({ items: [item(file)], files: [file] });
    await paste({ items: [{ kind: 'string' }], files: [] });
    expect(onPaste).toHaveBeenCalledTimes(2);
    expect(filesChanged).toHaveBeenCalledExactlyOnceWith([file]);
  });

  it('blocks intake after disabling the composer and without a file consumer', async () => {
    await render();
    await render({ disabled: true });
    const file = png();
    expect((await paste({ items: [item(file)], files: [file] })).defaultPrevented).toBe(false);
    await render({ onFilesChange: undefined });
    expect((await paste({ items: [item(file)], files: [file] })).defaultPrevented).toBe(false);
    expect(filesChanged).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
