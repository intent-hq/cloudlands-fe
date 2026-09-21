import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMarkdown } from './download-markdown';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('downloadMarkdown', () => {
  it.each([
    ['Plan: June/July?', 'Plan- June-July-.md'],
    [' . ', 'document.md'],
    ['CON', '_CON.md'],
    ['Notes.md', 'Notes.md'],
  ])('downloads exact bytes with a safe filename for %s', async (title, filename) => {
    vi.useFakeTimers();
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      blob = value as Blob;
      return 'blob:markdown-test';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let clicked: { filename: string; url: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked = { filename: this.download, url: this.href };
    });
    const body = '# Héllo\r\n\n- [ ] Task\n\n';
    downloadMarkdown(body, title);
    expect(clicked).toEqual({ filename, url: 'blob:markdown-test' });
    expect(blob?.type).toBe('text/markdown;charset=utf-8');
    const read = new FileReader();
    const text = new Promise((resolve) => {
      read.onload = () => resolve(read.result);
    });
    read.readAsText(blob!);
    await vi.runAllTimersAsync();
    expect(await text).toBe(body);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:markdown-test');
  });

  it('cleans up and reports synchronous download failures to its caller', () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => downloadMarkdown('text', 'Title')).toThrow('blocked');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:failed');
  });
});
