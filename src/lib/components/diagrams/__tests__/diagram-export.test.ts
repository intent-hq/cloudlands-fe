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
    <svg width="320" height="180" style="background-color: rgb(12, 34, 56); transform: scale(.5)">
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

  it('copies serialized SVG text to the shared clipboard path', async () => {
    const { container } = diagramFixture();
    vi.mocked(writeTextToClipboard).mockResolvedValue();

    await copyDiagramSvg(container);

    expect(writeTextToClipboard).toHaveBeenCalledOnce();
    expect(vi.mocked(writeTextToClipboard).mock.calls[0][0]).toMatch(/^<svg[^>]+xmlns=/);
  });

  it('copies a PNG using the visible theme canvas color', async () => {
    const { container } = diagramFixture();
    const close = vi.fn();
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const context = { fillStyle: '', fillRect, drawImage };
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close }));
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
    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('downloads a sanitized SVG filename and revokes its object URL', () => {
    const { container } = diagramFixture();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:diagram');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));

    downloadDiagramSvg(container, 'System / overview');

    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0].download).toBe('System-overview.svg');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagram');
  });

  it('rejects actions when no rendered SVG is available', async () => {
    const container = document.createElement('div');
    await expect(copyDiagramSvg(container)).rejects.toThrow('Diagram SVG is unavailable');
    await expect(copyDiagramImage(container)).rejects.toThrow('Diagram SVG is unavailable');
    expect(() => downloadDiagramSvg(container)).toThrow('Diagram SVG is unavailable');
  });
});
