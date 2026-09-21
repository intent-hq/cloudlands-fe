import { describe, expect, it, vi } from 'vitest';
import { faFile } from '@fortawesome/free-solid-svg-icons';
import AsyncPanelContent from '$lib/components/layout/panel-system/__tests__/mocks/AsyncPanelContent.svelte';
import { TabTypeRegistry, type TabTypeComponentLoader, type TabTypeDefinition } from './registry';

function registration(type: string, loadComponent: TabTypeComponentLoader): TabTypeDefinition {
  return {
    type,
    loadComponent,
    icon: faFile,
    defaultTitle: type,
    categoryLabel: 'Test',
    defaultWidthTier: 'narrow',
  };
}

describe('TabTypeRegistry async components', () => {
  it('shares one loader promise and caches the resolved component', async () => {
    const registry = new TabTypeRegistry();
    const loader = vi.fn(async () => ({ default: AsyncPanelContent }));
    registry.register(registration('shared', loader));

    const first = registry.loadComponent('shared');
    const second = registry.loadComponent('shared');

    expect(first).toBe(second);
    await expect(first).resolves.toBe(AsyncPanelContent);
    expect(loader).toHaveBeenCalledOnce();
    expect(registry.getLoadedComponent('shared')).toBe(AsyncPanelContent);
  });

  it('does not cache a rejection and supports a fresh retry', async () => {
    const registry = new TabTypeRegistry();
    const loader = vi
      .fn<TabTypeComponentLoader>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ default: AsyncPanelContent });
    registry.register(registration('retry', loader));

    await expect(registry.loadComponent('retry')).rejects.toThrow('chunk failed');
    await expect(registry.loadComponent('retry')).resolves.toBe(AsyncPanelContent);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('ignores a late result after the registration is replaced', async () => {
    const registry = new TabTypeRegistry();
    let resolveFirst!: (module: { default: typeof AsyncPanelContent }) => void;
    const firstLoader = vi.fn(
      () =>
        new Promise<{ default: typeof AsyncPanelContent }>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    registry.register(registration('hmr', firstLoader));
    const staleLoad = registry.loadComponent('hmr');
    await vi.waitFor(() => expect(firstLoader).toHaveBeenCalledOnce());

    const currentLoader = vi.fn(async () => ({ default: AsyncPanelContent }));
    registry.register(registration('hmr', currentLoader));
    resolveFirst({ default: AsyncPanelContent });
    await staleLoad;

    expect(registry.getLoadedComponent('hmr')).toBeUndefined();
    await registry.loadComponent('hmr');
    expect(currentLoader).toHaveBeenCalledOnce();
  });
});
