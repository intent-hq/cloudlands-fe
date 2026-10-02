/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet, type Component } from 'svelte';
import WorkspaceLayout from '../WorkspaceLayout.svelte';
import { recordedResizablePanelProps } from './mocks/RecordingResizablePanel.svelte';
import { store as appStore } from '$store/renderer/store';
import { setCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-slice';

vi.mock('$lib/components/layout/ResizablePanel.svelte', async (importOriginal) => {
  const actual = await importOriginal<{ default: Component<any> }>();
  const recorder = await import('./mocks/RecordingResizablePanel.svelte');
  recorder.actualResizablePanel.component = actual.default;
  return { default: recorder.default };
});

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
    recordedResizablePanelProps.length = 0;
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

  it('keeps content flush beside the collapsed left rail', async () => {
    const { mainArea, sidebarPanel } = renderLayout({ sidebarSide: 'left' });

    // Sidebar first, content after, no gutter while the sidebar is expanded.
    expect(sidebarPanel.compareDocumentPosition(mainArea)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sidebarPanel.classList.contains('workspace-sidebar-left')).toBe(true);
    expect(mainArea.classList.contains('bg-sidebar')).toBe(true);
    expect(hasOuterGutter(mainArea)).toBe(false);

    // The rail supplies the leading space when the sidebar is collapsed.
    appStore.dispatch(setCollapsed(true));
    await waitFor(() => expect(hasOuterGutter(mainArea)).toBe(false));
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

  it('forwards the sidebar sizing props, including the expanded width, to the resizable panel', () => {
    renderLayout();
    expect(recordedResizablePanelProps).toHaveLength(1);
    expect(recordedResizablePanelProps[0]).toMatchObject({
      side: 'left',
      minWidth: 280,
      maxWidth: 800,
      defaultWidth: 360,
      defaultExpandedWidth: 600,
      storageKey: 'workspace-left-panel-width',
      expandedStorageKey: 'workspace-left-panel-expanded-width',
      percentageWeight: 0,
      initiallyCollapsed: false,
    });
    cleanup();

    renderLayout({
      sidebarSide: 'right',
      sidebarMinWidth: 240,
      sidebarMaxWidth: 512,
      sidebarDefaultWidth: 333,
      sidebarDefaultExpandedWidth: 417,
      sidebarStorageKey: 'probe-width',
      sidebarExpandedStorageKey: 'probe-expanded-width',
      sidebarPercentageWeight: 0.5,
      startCollapsed: true,
    });
    expect(recordedResizablePanelProps).toHaveLength(2);
    expect(recordedResizablePanelProps[1]).toMatchObject({
      side: 'right',
      minWidth: 240,
      maxWidth: 512,
      defaultWidth: 333,
      defaultExpandedWidth: 417,
      storageKey: 'probe-width',
      expandedStorageKey: 'probe-expanded-width',
      percentageWeight: 0.5,
      initiallyCollapsed: true,
    });
  });
});
