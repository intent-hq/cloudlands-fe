import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const mocks = vi.hoisted(() => ({ startRootStoreLifecycle: vi.fn(() => () => {}) }));

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: mocks.startRootStoreLifecycle,
}));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/backend/splash-gate', () => ({ wireSplashGate: () => () => {} }));
vi.mock('$lib/utils/history-navigation', () => ({
  attachMouseHistoryNavigation: () => () => {},
  handleHistoryNavigateIpc: () => {},
}));
import { store as appStore } from '$store/renderer/store';
import RootLayout from '../+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="root-children">content</div>',
}));

describe('root +layout.svelte sandbox Store lifecycle', () => {
  beforeEach(() => {
    appStore.init();
    mocks.startRootStoreLifecycle.mockClear();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('initializes the shared root Store without owning app sagas', () => {
    render(RootLayout, { props: { children: childrenSnippet } });
    const lifecycle = mocks.startRootStoreLifecycle.mock.calls[0]?.[1] as {
      startSagas: (store: typeof appStore) => Array<() => void>;
    };

    expect(lifecycle.startSagas(appStore)).toEqual([]);
    expect(screen.getByTestId('root-children')).toBeTruthy();
  });

  it('keeps app-only saga and action HUD imports behind the app route group', () => {
    const routesRoot = path.resolve(process.cwd(), 'src/routes');
    const rootLayout = readFileSync(path.join(routesRoot, '+layout.svelte'), 'utf8');
    const appLayout = readFileSync(path.join(routesRoot, '(app)/+layout.svelte'), 'utf8');
    const hudLayout = readFileSync(path.join(routesRoot, 'hud/+layout.svelte'), 'utf8');

    expect(rootLayout).not.toContain('$store/renderer/sagas');
    expect(rootLayout).not.toContain('$store/renderer/seeders');
    expect(rootLayout).not.toContain('ActionKeyHud');
    expect(appLayout).toContain('$store/renderer/app-store-lifecycle');
    expect(appLayout).toContain('$store/renderer/seeders');
    expect(appLayout.indexOf("import '$store/renderer/seeders'")).toBeLessThan(
      appLayout.indexOf('startAppStoreLifecycle(appStore'),
    );
    expect(appLayout).toContain('ActionKeyHud');
    expect(hudLayout).toContain('$store/renderer/app-store-lifecycle');
    expect(hudLayout).toContain('$store/renderer/seeders');
    expect(hudLayout.indexOf("import '$store/renderer/seeders'")).toBeLessThan(
      hudLayout.indexOf('startAppStoreLifecycle(appStore'),
    );
  });
});
