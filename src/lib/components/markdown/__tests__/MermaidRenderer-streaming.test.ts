import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn(),
  mermaidAPI: { getDiagramFromText: vi.fn(async () => ({ type: 'mock' })) },
}));
vi.mock('mermaid', () => ({ default: mocks }));
vi.mock('@mermaid-js/layout-elk', () => ({ default: [] }));
import MermaidRenderer from '../MermaidRenderer.svelte';

const tokens = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 8%',
  '--card': '0 0% 98%',
  '--card-foreground': '0 0% 8%',
  '--muted': '210 12% 92%',
  '--muted-foreground': '210 8% 35%',
  '--border': '210 10% 82%',
  '--accent': '145 30% 90%',
  '--accent-foreground': '145 50% 20%',
  '--text-caption-size': '13px',
  '--radius-small': '5px',
};
beforeEach(() => {
  for (const [name, value] of Object.entries(tokens))
    document.documentElement.style.setProperty(name, value);
  mocks.render.mockReset();
  mocks.render.mockImplementation(async (_id: string, source: string) => {
    if (source.includes('INCOMPLETE')) throw new Error('Parse error');
    return { svg: `<svg data-source="${source.replace(/\n/g, ' ')}"></svg>` };
  });
});
afterEach(() => {
  cleanup();
  for (const name of Object.keys(tokens)) document.documentElement.style.removeProperty(name);
});

describe('Mermaid streaming presentation', () => {
  it.each([
    'flowchart LR',
    'sequenceDiagram',
    'stateDiagram-v2',
    'classDiagram',
    'erDiagram',
    'pie',
    'gantt',
    'mindmap',
    'architecture-beta',
    'gitGraph',
  ])(
    'retains %s paint through incomplete chunks then validates unchanged final input',
    async (family) => {
      const initial = `${family}\nA`;
      const result = render(MermaidRenderer, { code: initial, isStreaming: true });
      await waitFor(() => expect(result.container.querySelector('.mermaid-svg svg')).toBeTruthy());
      const first = result.container.querySelector('.mermaid-svg svg');
      const invalid = `${initial}\nINCOMPLETE`;
      await result.rerender({ code: invalid, isStreaming: true });
      await waitFor(() => expect(mocks.render.mock.calls.at(-1)?.[1]).toContain('INCOMPLETE'));
      expect(result.container.querySelector('.mermaid-svg svg')).toBe(first);
      expect(result.queryByRole('alert')).toBeNull();
      await result.rerender({ code: `${initial}\nB`, isStreaming: true });
      await waitFor(() =>
        expect(
          result.container.querySelector('.mermaid-svg svg')?.getAttribute('data-source'),
        ).toContain('B'),
      );
      await result.rerender({ code: invalid, isStreaming: true });
      await waitFor(() => expect(mocks.render.mock.calls.at(-1)?.[1]).toContain('INCOMPLETE'));
      expect(result.queryByRole('alert')).toBeNull();
      const beforeFinal = mocks.render.mock.calls.length;
      await result.rerender({ code: invalid, isStreaming: false });
      await waitFor(() => expect(result.queryByRole('alert')).not.toBeNull());
      expect(mocks.render.mock.calls.length).toBeGreaterThan(beforeFinal);
      expect(result.container.querySelector('.mermaid-svg svg')).toBeNull();
      expect(result.container.querySelector('.error-source-code')?.textContent).toBe(invalid);
    },
  );

  it('shows pending rather than raw code, empty or error UI before the first valid paint', async () => {
    const result = render(MermaidRenderer, { code: '', isStreaming: true });
    expect(result.queryByRole('status')?.textContent).toContain('Loading');
    await result.rerender({ code: 'INCOMPLETE', isStreaming: true });
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    expect(result.queryByRole('alert')).toBeNull();
    expect(result.container.querySelector('pre')).toBeNull();
    expect(mocks.initialize.mock.calls.at(-1)?.[0].suppressErrorRendering).toBe(true);
  });

  it('does not install a stale async result after source replacement', async () => {
    let finish!: (value: { svg: string }) => void;
    mocks.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = render(MermaidRenderer, { code: 'sequenceDiagram\nA', isStreaming: true });
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    await result.rerender({ code: 'sequenceDiagram\nReplacement', isStreaming: true });
    finish({ svg: '<svg data-stale="true"></svg>' });
    await waitFor(() =>
      expect(
        result.container.querySelector('.mermaid-svg svg')?.getAttribute('data-source'),
      ).toContain('Replacement'),
    );
    expect(result.container.querySelector('[data-stale]')).toBeNull();
  });
});
