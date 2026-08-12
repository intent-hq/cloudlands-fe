import type { Action } from 'svelte/action';

function findPanel(panelId: string | null): HTMLElement | null {
  if (!panelId) return null;
  return (
    [...document.querySelectorAll<HTMLElement>('[data-panel-id]')].find(
      (element) => element.dataset.panelId === panelId,
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

function createPanelSnapshot(source: HTMLElement): HTMLElement {
  const snapshot = source.cloneNode(true) as HTMLElement;
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
  snapshot.classList.add('contained');
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

export const renderPanelLayoutPreview: Action<HTMLElement, string> = (host, panelId) => {
  function render(nextPanelId: string) {
    const source = findPanel(nextPanelId);
    if (!source) return;
    const snapshot = createPanelSnapshot(source);
    snapshot.dataset.panelLayoutPreviewSnapshot = nextPanelId;
    host.replaceChildren(snapshot);
    copyElementState(source, snapshot);
  }

  render(panelId);
  return { update: render };
};
