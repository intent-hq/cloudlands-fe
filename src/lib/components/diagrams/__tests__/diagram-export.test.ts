/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeTextToClipboard } from '$lib/utils/clipboard';
import {
  copyDiagramImage,
  copyDiagramSvg,
  downloadDiagramSvg,
  prepareDiagramSvgForExport,
  serializeDiagramSvg,
} from '../diagram-export';

vi.mock('$lib/utils/clipboard', () => ({ writeTextToClipboard: vi.fn() }));

function diagramFixture(includeDatabaseRim = false): {
  container: HTMLDivElement;
  svg: SVGSVGElement;
} {
  const container = document.createElement('div');
  container.innerHTML = `
    <div role="toolbar">Not exported</div>
    <svg class="diagram-svg-layer" width="320" height="180" style="background-color: rgb(12, 34, 56); transform: scale(.5)">
      <defs><marker id="arrow"><path d="M0 0L4 2L0 4" stroke="context-stroke" /></marker></defs>
      <path class="edge-path" d="M0 0L100 100" marker-end="url(#arrow)" />
      <foreignObject x="8" y="8" width="120" height="44">
        <div data-store-node="${includeDatabaseRim}" style="border: 0; background: rgb(24, 24, 27)">
          <span data-node-icon><svg width="14" height="14"><circle cx="7" cy="7" r="6" /></svg></span>
          <span class="node-label">Primary database</span>
        </div>
      </foreignObject>
      <text x="160" y="160">complete label</text>
    </svg>`;
  document.body.appendChild(container);
  return { container, svg: container.querySelector('svg')! };
}

beforeEach(() => {
  vi.mocked(writeTextToClipboard).mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('diagram export', () => {
  it('builds a standalone SVG with complete themed geometry and no toolbar chrome', () => {
    const { container, svg } = diagramFixture(true);
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (pseudo === '::before') {
        const style = document.createElement('span').style;
        style.position = 'absolute';
        style.border = '1px solid rgb(12, 34, 56)';
        style.borderRadius = '50%';
        return style as unknown as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(element);
    });

    const exported = prepareDiagramSvgForExport(svg);
    const serialized = serializeDiagramSvg(container);

    expect(exported.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(exported.getAttribute('viewBox')).toBe('0 0 320 180');
    expect(exported.style.transform).toBe('');
    expect(exported.querySelector('foreignObject .node-label')?.textContent).toBe(
      'Primary database',
    );
    expect(exported.querySelector('[data-node-icon] svg')).toBeTruthy();
    expect(exported.querySelector('[data-diagram-export-pseudo="before"]')).toBeTruthy();
    expect(exported.querySelector('marker path')?.getAttribute('stroke')).toBe('context-stroke');
    expect(exported.querySelector('.edge-path')).toBeTruthy();
    expect(serialized).toContain('complete label');
    expect(serialized).not.toContain('Not exported');
  });

  it.each([0.5, 2])('keeps far-edge geometry inside the export at camera scale %s', (scale) => {
    const { svg } = diagramFixture();
    svg.style.transform = `translate(71px, -29px) scale(${scale})`;
    svg.insertAdjacentHTML(
      'beforeend',
      '<g transform="translate(8 6)"><rect x="264" y="132" width="40" height="32" /></g>',
    );
    const original = svg.outerHTML;
    // jsdom has no layout. Model only the camera's screen-space bounds; the
    // authored far-edge geometry below is the independent containment oracle.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      width: 320 * scale,
      height: 180 * scale,
    } as DOMRect);

    const exported = prepareDiagramSvgForExport(svg);
    const [, , width, height] = exported.getAttribute('viewBox')!.split(' ').map(Number);
    expect(width - (264 + 8 + 40)).toBe(8);
    expect(height - (132 + 6 + 32)).toBe(10);
    expect(exported.querySelector('g')?.getAttribute('transform')).toBe('translate(8 6)');
    expect(exported.style.transform).toBe('');
    expect(svg.outerHTML).toBe(original);
  });

  it('preserves the Mermaid viewBox mapping into a smaller rendered viewport', () => {
    const { svg } = diagramFixture();
    svg.classList.remove('diagram-svg-layer');
    svg.setAttribute('viewBox', '-20 -10 640 360');
    svg.style.removeProperty('transform');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      width: 160,
      height: 90,
    } as DOMRect);

    const exported = prepareDiagramSvgForExport(svg);
    const [x, y, width, height] = exported.getAttribute('viewBox')!.split(' ').map(Number);
    expect([x, y]).toEqual([-20, -10]);
    expect(width / Number(exported.getAttribute('width'))).toBe(4);
    expect(height / Number(exported.getAttribute('height'))).toBe(4);
    expect(exported.style.overflow).toBe('hidden');
  });

  it('uses viewBox dimensions when the viewport and absolute dimensions are unavailable', () => {
    const { svg } = diagramFixture();
    svg.setAttribute('width', '100%');
    svg.removeAttribute('height');
    svg.setAttribute('viewBox', '-20, -10, 640, 360');

    const exported = prepareDiagramSvgForExport(svg);
    expect(Number(exported.getAttribute('width')) / Number(exported.getAttribute('height'))).toBe(
      16 / 9,
    );
    expect(exported.getAttribute('viewBox')).toBe('-20, -10, 640, 360');
    svg.removeAttribute('viewBox');
    const fallback = prepareDiagramSvgForExport(svg);
    expect(fallback.getAttribute('viewBox')).toBe('0 0 1 1');
  });

  it('copies serialized SVG text to the shared clipboard path', async () => {
    const { container } = diagramFixture();
    vi.mocked(writeTextToClipboard).mockResolvedValue();

    await copyDiagramSvg(container);

    expect(writeTextToClipboard).toHaveBeenCalledOnce();
    expect(vi.mocked(writeTextToClipboard).mock.calls[0][0]).toMatch(/^<svg[^>]+xmlns=/);
  });

  it('copies an intrinsic-sized PNG despite the camera scale, using the visible canvas color', async () => {
    const { container, svg } = diagramFixture();
    svg.style.transform = 'translate(71px, -29px) scale(.5)';
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 160, height: 90 } as DOMRect);
    const original = svg.outerHTML;
    let encodedSvg = '';
    const image = { src: '', decode: vi.fn().mockResolvedValue(undefined) };
    image.decode.mockImplementation(async () => {
      encodedSvg = decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1));
    });
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const context = { fillStyle: '', fillRect, drawImage };
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          return image;
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: clipboardWrite },
    });
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);

    await copyDiagramImage(container);

    expect(context.fillStyle).toBe('rgb(12, 34, 56)');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 640, 360);
    // Parse as HTML here because jsdom's XMLSerializer duplicates xmlns; real
    // SVG decoding and PNG dimensions are covered in the export browser spec.
    const exported = new DOMParser().parseFromString(encodedSvg, 'text/html').querySelector('svg')!;
    expect(Number(exported.getAttribute('width')) * 2).toBe(640);
    expect(Number(exported.getAttribute('height')) * 2).toBe(360);
    expect(exported.style.transform).toBe('');
    expect(svg.outerHTML).toBe(original);
    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(image.decode).toHaveBeenCalledOnce();
    expect(image.src).toBe('');
  });

  it('downloads a sanitized SVG filename and revokes its object URL', async () => {
    const { container } = diagramFixture();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:diagram');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));

    await downloadDiagramSvg(container, 'System / overview');

    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0].download).toBe('System-overview.svg');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagram');
  });

  it('rejects actions when no rendered SVG is available', async () => {
    const container = document.createElement('div');
    await expect(copyDiagramSvg(container)).rejects.toThrow('Diagram SVG is unavailable');
    await expect(copyDiagramImage(container)).rejects.toThrow('Diagram SVG is unavailable');
    await expect(downloadDiagramSvg(container)).rejects.toThrow('Diagram SVG is unavailable');
  });

  it('ignores preceding template and toolbar icons, retaining icons inside the actual graph', () => {
    const { container, svg } = diagramFixture();
    const template = document.createElement('div');
    template.innerHTML = '<svg><text>Template icon</text></svg>';
    container.prepend(template);
    const output = serializeDiagramSvg(container);
    expect(output).toContain('Primary database');
    expect(output).not.toContain('Template icon');
    expect(output).toContain('data-node-icon');
    svg.remove();
    expect(() => serializeDiagramSvg(container)).toThrow('Diagram SVG is unavailable');
  });

  it('rejects a pending graph and ambiguous scopes rather than choosing a stale or neighboring graph', () => {
    const { container, svg } = diagramFixture();
    container.className = 'diagram-renderer';
    container.dataset.diagramSettled = 'false';
    expect(() => serializeDiagramSvg(container)).toThrow('Diagram SVG is unavailable');
    container.dataset.diagramSettled = 'true';
    container.append(svg.cloneNode(true));
    expect(() => serializeDiagramSvg(container)).toThrow('Diagram SVG is unavailable');
  });

  it('propagates image decode failure without reaching the clipboard and cleans the image', async () => {
    const { container } = diagramFixture();
    const image = { src: '', decode: vi.fn().mockRejectedValue(new Error('decode failed')) };
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          return image;
        }
      },
    );
    const write = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    await expect(copyDiagramImage(container)).rejects.toThrow('decode failed');
    expect(write).not.toHaveBeenCalled();
    expect(image.src).toBe('');
  });

  it('embeds only graph font families without changing live stylesheets', async () => {
    const { container, svg } = diagramFixture();
    svg.style.fontFamily = 'ExportFace';
    const style = document.createElement('style');
    style.textContent =
      '@font-face {font-family: ExportFace; src:url(/fonts/export.woff2)} @font-face {font-family: UnusedFace; src:url(/fonts/unused.woff2)}';
    container.prepend(style);
    // jsdom drops the font-face src descriptor; supply only that unsupported
    // CSSOM read. Browser coverage exercises real bundled faces and rasterization.
    vi.spyOn(style.sheet!.cssRules[0], 'cssText', 'get').mockReturnValue(
      '@font-face {font-family: ExportFace; src:url(/fonts/export.woff2)}',
    );
    vi.spyOn(style.sheet!.cssRules[1], 'cssText', 'get').mockReturnValue(
      '@font-face {font-family: UnusedFace; src:url(/fonts/unused.woff2)}',
    );
    const originalCss = style.textContent;
    const fetchFont = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['abc'], { type: 'font/woff2' }) });
    vi.stubGlobal('fetch', fetchFont);
    await copyDiagramSvg(container);
    expect(fetchFont).toHaveBeenCalledOnce();
    expect(String(fetchFont.mock.calls[0][0])).toMatch(/\/fonts\/export\.woff2$/);
    const output = vi.mocked(writeTextToClipboard).mock.calls[0][0];
    expect(output).toContain('data:font/woff2;base64,YWJj');
    expect(output).not.toContain('unused.woff2');
    expect(style.textContent).toBe(originalCss);
  });

  it('fails before clipboard or download when a required font cannot be read', async () => {
    const { container, svg } = diagramFixture();
    svg.style.fontFamily = 'UnavailableFace';
    const style = document.createElement('style');
    style.textContent = '@font-face {font-family: UnavailableFace; src:url(/fonts/missing.woff2)}';
    container.prepend(style);
    vi.spyOn(style.sheet!.cssRules[0], 'cssText', 'get').mockReturnValue(
      '@font-face {font-family: UnavailableFace; src:url(/fonts/missing.woff2)}',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(copyDiagramSvg(container)).rejects.toThrow('Diagram font is unavailable');
    await expect(downloadDiagramSvg(container)).rejects.toThrow('Diagram font is unavailable');
    expect(writeTextToClipboard).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it.each(['top-level', 'imported'] as const)(
    'skips inaccessible %s CSSOM rules and embeds later readable fonts',
    async (location) => {
      const { container, svg } = diagramFixture();
      svg.style.fontFamily = 'ExportFace, LaterFace';
      const style = document.createElement('style');
      container.prepend(style);
      const firstSheet = style.sheet!;
      let inaccessible = firstSheet;
      if (location === 'imported') {
        firstSheet.insertRule('@import url("https://inaccessible.example/style.css");', 0);
        inaccessible = new CSSStyleSheet();
        vi.spyOn(firstSheet.cssRules[0] as CSSImportRule, 'styleSheet', 'get').mockReturnValue(
          inaccessible,
        );
        firstSheet.insertRule('@font-face {font-family: ExportFace;}', 1);
        vi.spyOn(firstSheet.cssRules[1], 'cssText', 'get').mockReturnValue(
          '@font-face {font-family: ExportFace; src:url(/fonts/export.woff2)}',
        );
      }
      const laterSheet = new CSSStyleSheet();
      laterSheet.insertRule('@font-face {font-family: LaterFace;}', 0);
      vi.spyOn(laterSheet.cssRules[0], 'cssText', 'get').mockReturnValue(
        '@font-face {font-family: LaterFace; src:url(/fonts/later.woff2)}',
      );
      // Capture rendered styles before installing the inaccessible CSSOM seam;
      // jsdom itself cannot compute styles from a security-restricted sheet.
      const styles = new Map(
        [svg, ...svg.querySelectorAll('*')].map((element) => [
          element,
          window.getComputedStyle(element),
        ]),
      );
      vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => styles.get(element)!);
      const readRules = vi.fn(() => {
        throw new DOMException('Stylesheet rules are inaccessible', 'SecurityError');
      });
      Object.defineProperty(inaccessible, 'cssRules', { get: readRules });
      vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([
        firstSheet,
        laterSheet,
      ] as unknown as StyleSheetList);
      const fetchFont = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['abc'], { type: 'font/woff2' }),
      });
      vi.stubGlobal('fetch', fetchFont);

      await copyDiagramSvg(container);

      expect(readRules).toHaveBeenCalledOnce();
      expect(fetchFont.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(
        location === 'imported'
          ? ['/fonts/export.woff2', '/fonts/later.woff2']
          : ['/fonts/later.woff2'],
      );
      // XML parse/render coverage lives in the browser suite; jsdom duplicates
      // namespace attributes when serializing this fixture.
      const output = vi.mocked(writeTextToClipboard).mock.calls[0][0];
      expect(output).toContain('font-family: LaterFace');
      expect(output.match(/data:font\/woff2;base64,YWJj/g)).toHaveLength(
        location === 'imported' ? 2 : 1,
      );
      expect(output).toContain('complete label');
    },
  );

  it('propagates non-security CSSOM errors without reaching the clipboard', async () => {
    const { container } = diagramFixture();
    const failure = new TypeError('Unexpected CSSOM failure');
    const sheet = new CSSStyleSheet();
    Object.defineProperty(sheet, 'cssRules', {
      get() {
        throw failure;
      },
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(document.createElement('span').style);
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([sheet] as unknown as StyleSheetList);

    await expect(copyDiagramSvg(container)).rejects.toBe(failure);

    expect(writeTextToClipboard).not.toHaveBeenCalled();
  });
});
