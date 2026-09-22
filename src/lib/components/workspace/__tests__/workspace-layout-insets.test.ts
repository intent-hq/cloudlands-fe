/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import WorkspaceLayout from '../WorkspaceLayout.svelte';
import { store as appStore } from '$store/renderer/store';
import { setCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-slice';

const sidebar = createRawSnippet(() => ({
  render: () => '<div data-testid="layout-sidebar">sidebar</div>',
}));
const content = createRawSnippet(() => ({
  render: () => '<div data-testid="layout-content">content</div>',
}));

function renderLayout(props: Record<string, unknown> = {}) {
  const view = render(WorkspaceLayout, { props: { sidebar, content, ...props } });
  const upperArea = view.container.querySelector<HTMLElement>('.upper-area')!;
  const mainArea = upperArea.querySelector<HTMLElement>('.main-content-area')!;
  const sidebarPanel = upperArea.querySelector<HTMLElement>('.workspace-sidebar-panel')!;
  return { ...view, upperArea, mainArea, sidebarPanel };
}

const hasOuterGutter = (element: HTMLElement) =>
  element.classList.contains('pl-2') && element.classList.contains('sm:pl-3');

describe('WorkspaceLayout panel insets', () => {
  beforeEach(() => {
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('preserves the outer leading inset when the sidebar is on the right', () => {
    const { mainArea, sidebarPanel } = renderLayout({ sidebarSide: 'right' });

    // Content renders before the right-hand sidebar and always keeps the gutter.
    expect(mainArea.compareDocumentPosition(sidebarPanel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(mainArea.classList.contains('bg-sidebar')).toBe(true);
    expect(hasOuterGutter(mainArea)).toBe(true);
    expect(sidebarPanel.classList.contains('workspace-sidebar-right')).toBe(true);
    expect(mainArea.querySelector('[data-testid="layout-content"]')).toBeTruthy();
    expect(sidebarPanel.querySelector('[data-testid="layout-sidebar"]')).toBeTruthy();

    // The gutter does not depend on the collapsed state on the right side.
    appStore.dispatch(setCollapsed(true));
    expect(hasOuterGutter(mainArea)).toBe(true);
  });

  it('matches the responsive outer gutter beside a collapsed left sidebar', async () => {
    const { mainArea, sidebarPanel } = renderLayout({ sidebarSide: 'left' });

    // Sidebar first, content after, no gutter while the sidebar is expanded.
    expect(sidebarPanel.compareDocumentPosition(mainArea)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sidebarPanel.classList.contains('workspace-sidebar-left')).toBe(true);
    expect(mainArea.classList.contains('bg-sidebar')).toBe(true);
    expect(hasOuterGutter(mainArea)).toBe(false);

    // The store-owned collapsed flag adds the gutter and removing it takes it away.
    appStore.dispatch(setCollapsed(true));
    await waitFor(() => expect(hasOuterGutter(mainArea)).toBe(true));
    appStore.dispatch(setCollapsed(false));
    await waitFor(() => expect(hasOuterGutter(mainArea)).toBe(false));
  });

  it('forwards the sidebar width bounds to the resizable panel', () => {
    const defaults = renderLayout();
    expect(defaults.sidebarPanel.style.maxWidth).toBe('800px');
    expect(defaults.sidebarPanel.style.minWidth).toBe('280px');
    cleanup();

    const bounded = renderLayout({ sidebarMaxWidth: 512, sidebarMinWidth: 240 });
    expect(bounded.sidebarPanel.style.maxWidth).toBe('512px');
    expect(bounded.sidebarPanel.style.minWidth).toBe('240px');
  });
});
