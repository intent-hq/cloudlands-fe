import { describe, expect, it, vi } from 'vitest';
import { streamMermaidScene } from './mermaid-scene';

function scene() {
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.setAttribute('viewBox', '0 0 1000 2000');
  const path = document.createElementNS(root.namespaceURI, 'path');
  path.setAttribute('d', 'M0 0 ' + 'L1 2 '.repeat(400_000));
  root.append(path);
  const text = document.createElementNS(root.namespaceURI, 'text');
  text.textContent = '😀λ'.repeat(100_000);
  root.append(text);
  return root as SVGSVGElement;
}

describe('native Mermaid scene artifact stream', () => {
  it('emits exact large native attributes/text without a whole SVG snapshot or concurrent writes', async () => {
    const svg = scene();
    Object.defineProperty(svg, 'outerHTML', {
      get: () => {
        throw new Error('whole SVG snapshot');
      },
    });
    const writes: string[] = [];
    let outstanding = 0;
    const result = await streamMermaidScene(svg, {
      signal: new AbortController().signal,
      append: async (record) => {
        expect(++outstanding).toBe(1);
        expect(new TextEncoder().encode(record).length).toBeLessThanOrEqual(16384);
        await Promise.resolve();
        writes.push(record);
        outstanding--;
      },
    });
    const records = writes.map((r) => JSON.parse(r));
    const path = records.find((r) => r.kind === 'node' && r.name === 'path');
    const text = records.find((r) => r.kind === 'node' && r.nodeType === Node.TEXT_NODE);
    const pathData = records
      .filter((r) => r.kind === 'attribute' && r.node === path.id && r.field === 'value')
      .map((r) => r.text)
      .join('');
    const textData = records
      .filter((r) => r.kind === 'text' && r.node === text.id)
      .map((r) => r.text)
      .join('');
    expect(pathData).toBe(svg.querySelector('path')!.getAttribute('d'));
    expect(textData).toBe(svg.textContent);
    expect(result.nodes).toBe(4);
    expect(result.outputBytes).toBe(
      writes.reduce((total, r) => total + new TextEncoder().encode(r).length, 0),
    );
    expect(result.maxRecordBytes).toBeLessThanOrEqual(16384);
    expect(records.filter((r) => r.kind === 'node').map((r) => r.parent)).toEqual([null, 0, 0, 2]);
  });

  it('stops after cancellation during an outstanding acknowledged write', async () => {
    const controller = new AbortController();
    const append = vi.fn(async () => controller.abort());
    await expect(
      streamMermaidScene(scene(), { signal: controller.signal, append }),
    ).rejects.toThrow(/abort/i);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('does not publish further records after sink failure', async () => {
    const append = vi.fn(async () => {
      throw new Error('artifact write failed');
    });
    await expect(
      streamMermaidScene(scene(), { signal: new AbortController().signal, append }),
    ).rejects.toThrow('artifact write failed');
    expect(append).toHaveBeenCalledTimes(1);
  });
});
