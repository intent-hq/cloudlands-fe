import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactDocumentSchema, type ArtifactDocument } from '$shared/types/visual-artifact';
import ArtifactEditor from './ArtifactEditor.svelte';
import { displayImageSource, moveItems, rectangle, removeItems } from './editor-actions';
const base: ArtifactDocument = {
  version: 1,
  id: 'art',
  title: 'Test',
  kind: 'board',
  items: [
    { id: 'a', type: 'card', text: 'First idea', x: 20, y: 30, width: 200, height: 100 },
    { id: 'b', type: 'card', text: 'Second idea', x: 300, y: 30, width: 200, height: 100 },
  ],
  connections: [{ id: 'edge', from: 'a', to: 'b' }],
  annotations: [{ id: 'note', text: 'Check this', selection: { itemIds: ['a'] } }],
  chosenIds: ['a'],
};
afterEach(cleanup);
describe('artifact editing', () => {
  it('never renders unresolved workspace paths and validates resolved pixels', () => {
    const source = 'intent://local/file/concept.png';
    const raster = 'data:image/png;base64,AAAA';
    expect(displayImageSource(source, {})).toBeUndefined();
    expect(displayImageSource('workspace-asset://ws/asset', {})).toBeUndefined();
    expect(
      displayImageSource(source, { [source]: 'https://example.com/image.png' }),
    ).toBeUndefined();
    expect(displayImageSource(source, { [source]: raster })).toBe(raster);
    expect(displayImageSource(raster, {})).toBe(raster);
  });
  it('deletes references with their item, leaving a valid document and original unchanged', () => {
    const next = removeItems(base, ['a']);
    expect(next.items.map((item) => item.id)).toEqual(['b']);
    expect(next.connections).toEqual([]);
    expect(next.annotations).toEqual([]);
    expect(next.chosenIds).toEqual([]);
    expect(ArtifactDocumentSchema.safeParse(next).success).toBe(true);
    expect(base.items).toHaveLength(2);
  });
  it('clamps normalized regions and handles reverse drags and point selections', () => {
    expect(rectangle({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 })).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.6000000000000001,
      height: 0.6000000000000001,
    });
    expect(rectangle({ x: 1, y: 1 }, { x: 2, y: 2 })).toEqual({
      x: 0.99,
      y: 0.99,
      width: 0.01,
      height: 0.01,
    });
  });
  it('moves only selected items and respects coordinate limits', () => {
    const next = moveItems(base, ['a'], 200000, -200000);
    expect(next.items[0]).toMatchObject({ x: 100000, y: -100000 });
    expect(next.items[1]).toEqual(base.items[1]);
  });
  it('keyboard selection is ephemeral while arrow movement emits a draft', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(ArtifactEditor, { document: base, selection: { itemIds: ['a'] }, onChange, onSelect });
    const node = screen.getByRole('button', { name: 'First idea' });
    await fireEvent.keyDown(node, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ itemIds: ['a'] });
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.keyDown(node, { key: 'ArrowRight', shiftKey: true });
    expect(onChange.mock.lastCall?.[0].items[0].x).toBe(30);
  });
  it('option selection does not choose until the explicit choose action', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(ArtifactEditor, {
      document: { ...base, kind: 'options', chosenIds: [] },
      onChange,
      onSelect,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'First idea' }));
    expect(onSelect).toHaveBeenCalledWith({ itemIds: ['a'] });
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Choose', exact: true })[0]);
    expect(onChange.mock.lastCall?.[0].chosenIds).toEqual(['a']);
  });
  it('connects and groups the explicit multi-selection', async () => {
    const onChange = vi.fn();
    render(ArtifactEditor, {
      document: { ...base, connections: [] },
      selection: { itemIds: ['a', 'b'] },
      onChange,
      onSelect: vi.fn(),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Connect', exact: true }));
    expect(onChange.mock.lastCall?.[0].connections).toEqual([
      { id: expect.any(String), from: 'a', to: 'b' },
    ]);
    await fireEvent.click(screen.getByRole('button', { name: 'Group', exact: true }));
    const items = onChange.mock.lastCall?.[0].items;
    expect(items[0].group).toEqual(expect.any(String));
    expect(items[1].group).toBe(items[0].group);
  });
  it('adds an annotation only after explicit submission and keeps its normalized region', async () => {
    const onChange = vi.fn();
    const region = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    render(ArtifactEditor, {
      document: {
        ...base,
        kind: 'image',
        image: { src: 'data:image/png;base64,AAAA', alt: 'Concept' },
        annotations: [],
      },
      selection: { itemIds: [], region },
      onChange,
      onSelect: vi.fn(),
    });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Try more contrast' } });
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    expect(onChange.mock.lastCall?.[0].annotations).toEqual([
      { id: expect.any(String), text: 'Try more contrast', selection: { itemIds: [], region } },
    ]);
  });
  it('readonly keyboard cannot mutate a board', async () => {
    const onChange = vi.fn();
    render(ArtifactEditor, {
      document: base,
      selection: { itemIds: ['a'] },
      onChange,
      onSelect: vi.fn(),
      readonly: true,
    });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'First idea' }), { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('ignores foreign preview messages and only captures valid iframe state explicitly', async () => {
    const onChange = vi.fn();
    const { container } = render(ArtifactEditor, {
      document: { ...base, kind: 'preview', html: '<p>Demo</p>' },
      onChange,
      onSelect: vi.fn(),
    });
    const capture = screen.getByRole('button', { name: 'Capture state' }) as HTMLButtonElement;
    await fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        data: { type: 'intent-artifact:state', state: { bad: true } },
      }),
    );
    expect(capture.disabled).toBe(true);
    const iframe = container.querySelector('iframe')!;
    await fireEvent(
      window,
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { type: 'intent-artifact:state', state: { count: 2 } },
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.click(capture);
    expect(onChange.mock.lastCall?.[0].previewState).toEqual({ count: 2 });
  });
});
