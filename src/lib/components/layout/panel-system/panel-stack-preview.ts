import type { Action } from 'svelte/action';
import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';

export interface PanelLayoutPreviewSnapshot {
  panel: PanelState;
  sourcePanelId?: string | null;
}

function findPanel(panelId: string | null): HTMLElement | null {
  if (!panelId) return null;
  return (
    [...document.querySelectorAll<HTMLElement>('[data-panel-id]')].find(
      (element) => element.dataset.panelId === panelId,
    ) ?? null
  );
}

function findPanelContainingTab(tabId: string | null): HTMLElement | null {
  if (!tabId) return null;
  return (
    [...document.querySelectorAll<HTMLElement>('[data-panel-id]')].find((panel) =>
      [...panel.querySelectorAll<HTMLElement>('.tab-content-wrapper[data-tab-id]')].some(
        (wrapper) => wrapper.dataset.tabId === tabId,
      ),
    ) ?? null
  );
}

function copyElementState(source: Element, snapshot: Element): void {
  if (source instanceof HTMLElement && snapshot instanceof HTMLElement) {
    snapshot.scrollTop = source.scrollTop;
    snapshot.scrollLeft = source.scrollLeft;
  }
  if (source instanceof HTMLInputElement && snapshot instanceof HTMLInputElement) {
    snapshot.value = source.value;
    snapshot.checked = source.checked;
  } else if (source instanceof HTMLTextAreaElement && snapshot instanceof HTMLTextAreaElement) {
    snapshot.value = source.value;
  } else if (source instanceof HTMLSelectElement && snapshot instanceof HTMLSelectElement) {
    snapshot.value = source.value;
  } else if (source instanceof HTMLCanvasElement && snapshot instanceof HTMLCanvasElement) {
    try {
      snapshot.getContext('2d')?.drawImage(source, 0, 0);
    } catch {
      // Some browser/WebGL canvases cannot be copied; their surrounding DOM still previews.
    }
  }

  const sourceChildren = [...source.children];
  const snapshotChildren = [...snapshot.children];
  sourceChildren.forEach((child, index) => {
    const snapshotChild = snapshotChildren[index];
    if (snapshotChild) copyElementState(child, snapshotChild);
  });
}

function applyProjectedPanelState(snapshot: HTMLElement, panel: PanelState): void {
  const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId) ?? panel.tabs[0] ?? null;
  const contentWrappers = [
    ...snapshot.querySelectorAll<HTMLElement>('.tab-content-wrapper[data-tab-id]'),
  ];
  contentWrappers.forEach((wrapper) => {
    if (wrapper.dataset.tabId !== activeTab?.id) {
      wrapper.remove();
      return;
    }
    wrapper.classList.remove('hidden');
    wrapper.removeAttribute('inert');
    wrapper.setAttribute('aria-hidden', 'false');
  });

  snapshot.dataset.panelLayoutPreviewActivePane = activeTab?.id ?? '';
  snapshot.dataset.panelLayoutPreviewStackSize = String(panel.tabs.length);
  snapshot.querySelectorAll<HTMLElement>('[data-pane-stack]').forEach((stack) => {
    stack.dataset.paneStackSize = String(panel.tabs.length);
  });
  snapshot.querySelectorAll<HTMLElement>('[data-pane-stack-active]').forEach((active) => {
    active.dataset.paneStackActive = activeTab?.id ?? '';
  });
  const title = snapshot.querySelector<HTMLElement>('[data-panel-header-title]');
  if (title && activeTab) title.replaceChildren(activeTab.title ?? '');
}

function createPanelSnapshot(source: HTMLElement, panel: PanelState): HTMLElement {
  const snapshot = source.cloneNode(true) as HTMLElement;
  copyElementState(source, snapshot);
  applyProjectedPanelState(snapshot, panel);
  snapshot.removeAttribute('data-panel-id');
  snapshot.querySelectorAll('[data-panel-id]').forEach((element) => {
    element.removeAttribute('data-panel-id');
  });
  snapshot.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  snapshot.querySelectorAll('[draggable]').forEach((element) => {
    element.removeAttribute('draggable');
  });
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.inert = true;
  Object.assign(snapshot.style, {
    width: '100%',
    height: '100%',
    minWidth: '0',
    maxWidth: 'none',
    opacity: '1',
    transform: 'none',
    boxShadow: 'none',
    pointerEvents: 'none',
  });
  [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')].forEach((element) => {
    element.style.setProperty('animation', 'none', 'important');
    element.style.setProperty('transition', 'none', 'important');
    element.style.setProperty('view-transition-name', 'none', 'important');
  });
  return snapshot;
}

export const renderPanelLayoutPreview: Action<HTMLElement, PanelLayoutPreviewSnapshot> = (
  host,
  options,
) => {
  let renderedPanel: PanelState | null = null;
  let renderedSourcePanelId: string | null = null;

  function render(next: PanelLayoutPreviewSnapshot) {
    const sourcePanelId = next.sourcePanelId ?? null;
    if (next.panel === renderedPanel && sourcePanelId === renderedSourcePanelId) return;
    renderedPanel = next.panel;
    renderedSourcePanelId = sourcePanelId;
    const activeTabId = next.panel.activeTabId ?? next.panel.tabs[0]?.id ?? null;
    const source =
      findPanelContainingTab(activeTabId) ??
      findPanel(next.sourcePanelId ?? null) ??
      findPanel(next.panel.id);
    if (!source) {
      host.replaceChildren();
      return;
    }
    const snapshot = createPanelSnapshot(source, next.panel);
    snapshot.dataset.panelLayoutPreviewSnapshot = next.panel.id;
    snapshot.dataset.panelLayoutPreviewSnapshotSource = source.dataset.panelId ?? '';
    host.replaceChildren(snapshot);
  }

  render(options);
  return {
    update: render,
    destroy: () => host.replaceChildren(),
  };
};
