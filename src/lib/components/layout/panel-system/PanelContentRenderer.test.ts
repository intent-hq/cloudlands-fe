import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { render as renderSsr } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { faFile } from '@fortawesome/free-solid-svg-icons';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { tabTypeRegistry, type TabTypeComponentLoader } from '$features/layout/tab-types/registry';
import AsyncPanelContent from './__tests__/mocks/AsyncPanelContent.svelte';
import PanelContentRenderer from './PanelContentRenderer.svelte';
import { store } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { labelWorkspace } from '../../../../test/fixtures/workspace-labels-state';

function tab(type: string, title = type): PanelTab {
  return { id: `${type}-tab`, type, title, closable: true } as PanelTab;
}

function register(type: string, loadComponent: TabTypeComponentLoader) {
  tabTypeRegistry.register({
    type,
    loadComponent,
    icon: faFile,
    defaultTitle: type,
    categoryLabel: 'Test',
    defaultWidthTier: 'narrow',
  });
}

function props(type: string, isActive = true) {
  return {
    tab: tab(type),
    workspaceId: 'workspace-1',
    layoutId: 'workspace-1',
    isActive,
  };
}

afterEach(cleanup);

describe('PanelContentRenderer async boundary', () => {
  it('shares one import across concurrent active panels', async () => {
    const loader = vi.fn(async () => ({ default: AsyncPanelContent }));
    register('async-shared', loader);

    render(PanelContentRenderer, { props: props('async-shared') });
    render(PanelContentRenderer, { props: props('async-shared') });

    expect(await screen.findAllByTestId('async-panel-content')).toHaveLength(2);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('retries a failed chunk with a fresh loader call', async () => {
    const loader = vi
      .fn<TabTypeComponentLoader>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ default: AsyncPanelContent });
    register('async-retry', loader);
    render(PanelContentRenderer, { props: props('async-retry') });

    await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('async-panel-content')).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not mount an inactive retained tab when its pending import resolves', async () => {
    let resolveLoader!: (module: { default: typeof AsyncPanelContent }) => void;
    const loader = vi.fn(
      () =>
        new Promise<{ default: typeof AsyncPanelContent }>((resolve) => {
          resolveLoader = resolve;
        }),
    );
    register('async-retained', loader);
    const view = render(PanelContentRenderer, { props: props('async-retained') });
    await waitFor(() => expect(loader).toHaveBeenCalledOnce());

    await view.rerender(props('async-retained', false));
    resolveLoader({ default: AsyncPanelContent });
    await waitFor(() =>
      expect(tabTypeRegistry.getLoadedComponent('async-retained')).toBe(AsyncPanelContent),
    );
    expect(screen.queryByTestId('async-panel-content')).toBeNull();

    await view.rerender(props('async-retained', true));
    expect(await screen.findByTestId('async-panel-content')).toBeTruthy();
    expect(loader).toHaveBeenCalledOnce();
  });

  it('mounts an inactive owned browser while leaving an inactive unowned browser dormant', async () => {
    const loader = vi.fn(async () => ({ default: AsyncPanelContent }));
    register('browser', loader);
    const unowned = render(PanelContentRenderer, { props: props('browser', false) });
    const owned = render(PanelContentRenderer, {
      props: {
        ...props('browser', false),
        tab: { ...tab('browser'), ownerAgentId: 'agent-1' } as PanelTab,
      },
    });

    await waitFor(() =>
      expect(owned.container.querySelector('[data-testid="async-panel-content"]')).toBeTruthy(),
    );
    expect(unowned.container.querySelector('[data-testid="async-panel-content"]')).toBeNull();
    expect(loader).toHaveBeenCalledOnce();
  });

  it('recovers an initially unknown type after registration and retry', async () => {
    const type = 'async-unknown';
    render(PanelContentRenderer, { props: props(type) });
    expect(await screen.findByText('Content type not yet implemented')).toBeTruthy();

    const loader = vi.fn(async () => ({ default: AsyncPanelContent }));
    register(type, loader);
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('async-panel-content')).toBeTruthy();
  });

  it('does not execute a tab loader during SSR', () => {
    const loader = vi.fn(async () => ({ default: AsyncPanelContent }));
    register('async-ssr', loader);

    renderSsr(PanelContentRenderer, { props: props('async-ssr') });

    expect(loader).not.toHaveBeenCalled();
  });

  it('mounts a preloaded component without re-entering the async load path', async () => {
    const loader = vi.fn(async () => ({ default: AsyncPanelContent }));
    register('async-preloaded', loader);
    await tabTypeRegistry.loadComponent('async-preloaded');
    const loadComponent = vi.spyOn(tabTypeRegistry, 'loadComponent');

    render(PanelContentRenderer, {
      props: props('async-preloaded'),
    });

    expect(screen.getByTestId('async-panel-content')).toBeTruthy();
    expect(loadComponent).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledOnce();
    loadComponent.mockRestore();
  });
});

describe('PanelContentRenderer with a detached workspace home', () => {
  it('keeps saved-script output tabs readable and covers shell terminals', async () => {
    store.init();
    store.dispatch(
      setWorkspaceEntity(
        labelWorkspace('ws-detached', {
          home: {
            homeId: 'h-1',
            nodeId: 'd-mac-studio',
            name: 'Mac Studio',
            state: 'detached',
            since: '2026-11-12T09:42:00Z',
          },
        }),
      ),
    );
    register('terminal', async () => ({ default: AsyncPanelContent }));
    const base = { workspaceId: 'ws-detached', layoutId: 'ws-detached', isActive: true };

    const script = render(PanelContentRenderer, {
      props: { ...base, tab: { ...tab('terminal'), scriptId: 'build' } as PanelTab },
    });
    expect(await script.findByTestId('async-panel-content')).toBeTruthy();
    expect(script.container.querySelector('[data-workspace-home-panel-notice]')).toBeNull();
    script.unmount();

    const shell = render(PanelContentRenderer, {
      props: { ...base, tab: { ...tab('terminal'), terminalId: 't-1' } as PanelTab },
    });
    await waitFor(() =>
      expect(shell.container.querySelector('[data-workspace-home-panel-notice]')).toBeTruthy(),
    );
  });
});
