import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewLoaderIndex,
  installPreviewBrowserApi,
  listPreviewIds,
  loadPreviewFromLoader,
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
      expect.arrayContaining(['button', 'mention-agent-avatar', 'workspace-hover-card']),
    );
    expect(ids).toEqual([...ids].sort());
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
