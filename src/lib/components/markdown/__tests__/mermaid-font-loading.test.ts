import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMermaidTextFont } from '../mermaid-font-loading';

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  vi.restoreAllMocks();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
});

function fixture(font: string) {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.textContent = 'Actual note content';
  const style = document.createElement('span').style;
  Object.assign(style, {
    fontStyle: 'italic',
    fontWeight: '600',
    fontSize: '17px',
    fontFamily: '"Note face", serif',
  });
  Object.defineProperty(style, 'font', { value: font });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);
  const load = vi.fn<(font: string, content?: string) => Promise<FontFace[]>>();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
  return { text, load };
}

describe('loadMermaidTextFont', () => {
  it('uses the displayed longhands when inherited settings make the shorthand empty', async () => {
    const { text, load } = fixture('');
    load.mockResolvedValue([]);
    const before = text.outerHTML;
    await loadMermaidTextFont(text);
    expect(load).toHaveBeenCalledExactlyOnceWith(
      'italic 600 17px "Note face", serif',
      'Actual note content',
    );
    expect(text.outerHTML).toBe(before);
  });

  it('keeps an ordinary shorthand and waits for the actual font load promise', async () => {
    const { text, load } = fixture('italic 600 17px / 24px "Note face", serif');
    let resolve!: (faces: FontFace[]) => void;
    const pending = new Promise<FontFace[]>((done) => {
      resolve = done;
    });
    load.mockReturnValue(pending);
    const result = loadMermaidTextFont(text);
    let settled = false;
    void result?.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(result).toBe(pending);
    expect(load).toHaveBeenCalledExactlyOnceWith(
      'italic 600 17px / 24px "Note face", serif',
      'Actual note content',
    );
    resolve([]);
    await result;
    expect(settled).toBe(true);
  });

  it.each(['', '12px serif'])(
    'propagates genuine load rejection for shorthand %j',
    async (font) => {
      const { text, load } = fixture(font);
      const failure = new DOMException('Font download failed', 'NetworkError');
      load.mockRejectedValue(failure);
      await expect(loadMermaidTextFont(text)).rejects.toBe(failure);
      expect(load).toHaveBeenCalledTimes(1);
    },
  );
});
