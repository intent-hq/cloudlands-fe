import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewLoaderIndex,
  installPreviewBrowserApi,
  listPreviewIds,
  loadPreview,
  loadPreviewFromLoader,
  registerPreviewLoader,
  setActivePreview,
} from './preview-discovery';
import { warmImport } from '../../test/warm-import';

// Without a warm-up, the first preview case (currently advisory-wakes) pays the
// one-time cold compile of the module graph most previews share: the store,
// i18n messages, UI primitives and the chat message renderer. That took it
// from ~1s to ~10s on a fast cold run and past its 60s limit under
// `pnpm test:loaded` and on slower developer machines.
// Warm those shared roots once, under warmImport's cold-compile timeout, so
// each case below is billed only for its own preview and keeps its own limit.
warmImport(() => import('$store/renderer/store'));
warmImport(() => import('$shared/paraglide/messages.js'));
warmImport(() => import('$lib/components/ui/button'));
warmImport(() => import('$lib/components/chat/StreamingMessageContent.svelte'));

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

  it.each(listPreviewIds())(
    'loads a valid preview definition for %s',
    async (id) => {
      expect((await loadPreview(id))?.definition.id).toBe(id);
    },
    60_000,
  );

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
