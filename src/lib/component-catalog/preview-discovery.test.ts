import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewLoaderIndex,
  installPreviewBrowserApi,
  listPreviewIds,
  loadPreview,
  loadPreviewFromLoader,
  registerPreviewLoader,
  setActivePreview,
} from './preview-discovery';

const component = () => undefined;

function loader(id: string, states: Record<string, { props: Record<string, unknown> }> = {}) {
  return async () => ({
    default: component,
    preview: {
      id,
      title: id,
      defaultState: Object.keys(states)[0] ?? 'default',
      states,
    },
  });
}

describe('preview discovery', () => {
  afterEach(() => {
    setActivePreview(null);
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('finds colocated previews without a shared registry entry', () => {
    const ids = listPreviewIds();
    expect(ids).toEqual(
      expect.arrayContaining([
        'button',
        'diagram-controls-host',
        'diagram-workbench',
        'mention-agent-avatar',
        'workspace-hover-card',
        'workspace-tab-strip-geometry',
      ]),
    );
    expect(ids).toEqual([...ids].sort());
  });

  const ids = listPreviewIds();
  const loadedIds: string[] = [];
  const assertCompleteSet = () => {
    expect(listPreviewIds()).toEqual(ids);
    expect(loadedIds).toEqual(ids);
  };

  // Even a filter selecting only an older case must not certify a partial set.
  afterAll(assertCompleteSet);

  describe.sequential('discovered preview definitions', () => {
    // This validates each import, not whole-catalog latency: the original 60s
    // timeout now bounds each preview rather than their cumulative import time.
    it.each(ids)(
      'loads a valid preview definition: %s',
      async (id) => {
        const loadedId = (await loadPreview(id))?.definition.id ?? '';
        loadedIds.push(loadedId);
        expect(loadedId).toBe(id);
      },
      60_000,
    );

    it('completes the full discovered set in sorted order', assertCompleteSet);
  });

  it('rejects duplicate filenames instead of silently replacing a preview', () => {
    expect(() =>
      createPreviewLoaderIndex([
        ['/src/one/example.preview.ts', loader('example')],
        ['/src/two/example.preview.svelte', loader('example')],
      ]),
    ).toThrow(
      'Duplicate preview slug “example” in “/src/one/example.preview.ts” and “/src/two/example.preview.svelte”.',
    );
  });

  it('rejects a loaded definition whose id does not match the filename', async () => {
    await expect(
      loadPreviewFromLoader('example', loader('different', { default: { props: {} } })),
    ).rejects.toThrow('Preview slug “example” does not match definition id “different”.');
  });

  it('rejects a loaded definition with no states', async () => {
    await expect(loadPreviewFromLoader('example', loader('example'))).rejects.toThrow(
      'Preview “example” must define at least one state.',
    );
  });

  it('allows a harness to register and restore a preview loader', () => {
    const unregister = registerPreviewLoader(
      'ct-only',
      loader('ct-only', { default: { props: {} } }),
    );

    expect(listPreviewIds()).toContain('ct-only');
    unregister();
    expect(listPreviewIds()).not.toContain('ct-only');
  });

  it('exposes geometry for the active ready scene focus frame', () => {
    document.body.innerHTML = `<section data-preview-ready="true"><main data-testid="catalog-scene-focus"><div data-probe></div></main></section>`;
    const root = document.querySelector('main')!;
    const probe = root.firstElementChild!;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 420,
      height: 200,
    } as DOMRect);
    vi.spyOn(probe, 'getBoundingClientRect').mockReturnValue({
      left: 15,
      top: 27,
      width: 80,
      height: 30,
    } as DOMRect);
    const uninstall = installPreviewBrowserApi(window);

    expect(window.__INTENT_PREVIEW__?.probe()).toBeNull();
    setActivePreview({ slug: 'button', state: 'loading', width: 420, status: 'ready' });
    expect(window.__INTENT_PREVIEW__?.probe()).toMatchObject({
      slug: 'button',
      state: 'loading',
      width: 420,
      root: { width: 420, height: 200 },
      probes: { 'data-probe': { x: 5, y: 7, width: 80, height: 30 } },
    });

    uninstall();
  });
});
