import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedPreviewImports } from '../../test/shared-preview-imports';
import { warmImport } from '../../test/warm-import';
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

// A preview counts as sharing a module when this many previews import it.
const SHARED_IMPORT_MIN_PREVIEWS = 5;
// Each preview case pays only for compiling its own modules.
const PREVIEW_LOAD_TIMEOUT_MS = 60_000;
// The one-off cold compile of the shared graph took 38 s on an idle machine
// (intent-hq/intent#6514) and outlasted three 60 s preview cases on a loaded
// one, so it gets its own budget.
const SHARED_WARM_UP_TIMEOUT_MS = 600_000;

const previewSources = import.meta.glob<string>(
  ['/src/**/*.preview.ts', '/src/**/*.preview.svelte'],
  { query: '?raw', import: 'default', eager: true },
);

// Compile the code most previews share (the renderer store, shared types, UI
// primitives) once, before the per-preview cases, instead of inside whichever
// preview sorts first. Failures are left to the preview cases, which report
// them against the preview that needs the module. Imports run one at a time:
// concurrent ones can evaluate a module against a half-initialised dependency
// (e.g. svelte/internal/client) and cache it broken for every later preview.
warmImport(async () => {
  for (const specifier of sharedPreviewImports(previewSources, SHARED_IMPORT_MIN_PREVIEWS)) {
    await import(/* @vite-ignore */ specifier).catch(() => undefined);
  }
}, SHARED_WARM_UP_TIMEOUT_MS);

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

  it('warms the modules most previews share', () => {
    expect(sharedPreviewImports(previewSources, SHARED_IMPORT_MIN_PREVIEWS)).toEqual(
      expect.arrayContaining([
        '$lib/component-catalog/preview-definition',
        '$store/renderer/store',
        'svelte',
      ]),
    );
  });

  it.each(listPreviewIds())(
    'loads a valid preview definition for %s',
    async (id) => {
      expect((await loadPreview(id))?.definition.id).toBe(id);
    },
    PREVIEW_LOAD_TIMEOUT_MS,
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
