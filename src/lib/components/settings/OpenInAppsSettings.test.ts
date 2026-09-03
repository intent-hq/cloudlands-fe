/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEditors,
  setEditorOrder,
  toggleHiddenEditor,
  type InstalledEditor,
} from '$store/renderer/slices/external-editors/external-editors-slice';

const mocks = vi.hoisted(() => {
  const writable = <T>(initial: T) => {
    let value = initial;
    const subscribers = new Set<(next: T) => void>();
    return {
      get: () => value,
      set(next: T) {
        value = next;
        for (const subscriber of subscribers) subscriber(next);
      },
      subscribe(subscriber: (next: T) => void) {
        subscribers.add(subscriber);
        subscriber(value);
        return () => subscribers.delete(subscriber);
      },
    };
  };
  return {
    editors$: writable<InstalledEditor[]>([]),
    hiddenIds$: writable<string[]>([]),
    dispatched: [] as unknown[],
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: (action: { type: string; payload: unknown[] }) => {
      mocks.dispatched.push(action);
      if (action.type === 'externalEditors/toggleHiddenEditor') {
        const id = action.payload[0] as string;
        const hiddenIds = mocks.hiddenIds$.get();
        mocks.hiddenIds$.set(
          hiddenIds.includes(id)
            ? hiddenIds.filter((hiddenId) => hiddenId !== id)
            : [...hiddenIds, id],
        );
      }
      if (action.type === 'externalEditors/setEditorOrder') {
        const editorIds = action.payload[0] as string[];
        const editors = mocks.editors$.get();
        const editorById = new Map(editors.map((editor) => [editor.id, editor]));
        const orderedIds = new Set(editorIds);
        mocks.editors$.set([
          ...editorIds.flatMap((id) => {
            const orderedEditor = editorById.get(id);
            return orderedEditor ? [orderedEditor] : [];
          }),
          ...editors.filter(({ id }) => !orderedIds.has(id)),
        ]);
      }
    },
  });
});

vi.mock('$store/renderer/slices/external-editors/external-editors-selectors', () => ({
  selectInstalledEditors: () => mocks.editors$,
  selectHiddenEditorIds: () => mocks.hiddenIds$,
}));

import OpenInAppsSettings from './OpenInAppsSettings.svelte';

const LONG_EDITOR_NAME =
  'Visual Studio Code Insiders With A Very Long Extension Profile Display Name';

function editor(overrides: Partial<InstalledEditor> = {}): InstalledEditor {
  return {
    id: 'vscode',
    name: LONG_EDITOR_NAME,
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    priority: 100,
    installed: true,
    ...overrides,
  };
}

function renderApps() {
  return render(OpenInAppsSettings);
}

function renderedEditorIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-editor-id]')).map(
    (element) => element.dataset.editorId ?? '',
  );
}

async function dispatchDragEvent(
  element: HTMLElement,
  type: 'dragover' | 'drop',
  dataTransfer: object,
  clientY?: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  if (clientY !== undefined) Object.defineProperty(event, 'clientY', { value: clientY });
  element.dispatchEvent(event);
  await Promise.resolve();
}

async function dispatchDragStart(
  element: HTMLElement,
  dataTransfer: object,
  clientX: number,
  clientY: number,
) {
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  element.dispatchEvent(event);
  await Promise.resolve();
}

beforeEach(() => {
  mocks.editors$.set([]);
  mocks.hiddenIds$.set([]);
  mocks.dispatched.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('OpenInAppsSettings', () => {
  it('fetches on mount and excludes apps that are not installed', () => {
    mocks.editors$.set([editor({ id: 'missing', installed: false })]);

    renderApps();

    expect(screen.queryByRole('switch')).toBeNull();
    expect(mocks.dispatched).toContainEqual(fetchEditors());
  });

  it('keeps installed-only filtering, selected state, and the exact toggle action', async () => {
    const visible = editor({ iconBase64: 'cG5n' });
    mocks.editors$.set([visible, editor({ id: 'not-installed', installed: false })]);
    mocks.hiddenIds$.set([visible.id]);

    renderApps();
    const toggle = screen.getByRole('switch', { name: LONG_EDITOR_NAME });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(toggle);

    expect(mocks.dispatched).toContainEqual(fetchEditors());
    expect(
      mocks.dispatched.filter(
        (action) => (action as { type: string }).type === toggleHiddenEditor.type,
      ),
    ).toEqual([toggleHiddenEditor(visible.id)]);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('reorders Finder with pointer drag and preserves the selector order after remount', async () => {
    mocks.editors$.set([
      editor(),
      editor({ id: 'cursor', name: 'Cursor', appName: 'Cursor', handlerType: 'generic' }),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
    ]);

    const view = renderApps();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'finder'),
    };
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    const vscodeRow = document.querySelector<HTMLElement>('[data-editor-id="vscode"]');
    expect(vscodeRow).not.toBeNull();
    (vscodeRow as HTMLElement).getBoundingClientRect = () => ({ top: 100, height: 40 }) as DOMRect;

    await fireEvent.dragStart(finderHandle, { dataTransfer });
    await dispatchDragEvent(vscodeRow as HTMLElement, 'dragover', dataTransfer, 110);
    await dispatchDragEvent(vscodeRow as HTMLElement, 'drop', dataTransfer, 110);

    expect(mocks.dispatched).toContainEqual(setEditorOrder(['finder', 'vscode', 'cursor']));
    await waitFor(() => expect(renderedEditorIds()).toEqual(['finder', 'vscode', 'cursor']));

    view.unmount();
    renderApps();
    expect(renderedEditorIds()).toEqual(['finder', 'vscode', 'cursor']);
  });

  it('keeps the source row fixed and uses a distinct ghost copy for the native preview', async () => {
    mocks.editors$.set([
      editor(),
      editor({ id: 'cursor', name: 'Cursor', appName: 'Cursor', handlerType: 'generic' }),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
    ]);

    renderApps();
    const finderRow = document.querySelector<HTMLElement>('[data-editor-id="finder"]')!;
    finderRow.getBoundingClientRect = () =>
      ({ left: 40, top: 80, width: 360, height: 44, right: 400, bottom: 124 }) as DOMRect;
    const sourceParent = finderRow.parentElement;
    const sourceIndex = renderedEditorIds().indexOf('finder');
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    const vscodeRow = document.querySelector<HTMLElement>('[data-editor-id="vscode"]')!;
    vscodeRow.getBoundingClientRect = () => ({ top: 100, height: 40 }) as DOMRect;
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'finder'),
      setDragImage: vi.fn(),
    };

    await dispatchDragStart(finderHandle, dataTransfer, 100, 94);
    await dispatchDragEvent(vscodeRow, 'dragover', dataTransfer, 110);

    expect(finderRow.dataset.dragging).toBe('true');
    expect(document.querySelector('[data-editor-id="finder"]')).toBe(finderRow);
    expect(finderRow.parentElement).toBe(sourceParent);
    expect(renderedEditorIds().indexOf('finder')).toBe(sourceIndex);
    expect(finderRow.textContent).toContain('Finder');
    const dragPreview = document.querySelector<HTMLElement>('[data-editor-drag-preview]')!;
    expect(dragPreview).not.toBe(finderRow);
    expect(dragPreview.dataset.editorId).toBeUndefined();
    expect(dragPreview.getAttribute('aria-hidden')).toBe('true');
    expect(dragPreview.style.width).toBe('360px');
    expect(dragPreview.style.height).toBe('44px');
    expect(dragPreview.style.backgroundColor).toBe('hsl(var(--card))');
    expect(dragPreview.style.opacity).toBe('1');
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(
      expect.objectContaining({ dataset: expect.objectContaining({ editorDragPreview: '' }) }),
      60,
      14,
    );
    expect(dragPreview.textContent).toContain('Finder');
  });

  it('keeps source and target rows neutral while showing the insertion line', async () => {
    mocks.editors$.set([
      editor(),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
    ]);

    renderApps();
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    const sourceRow = document.querySelector<HTMLElement>('[data-editor-id="finder"]')!;
    const targetRow = document.querySelector<HTMLElement>('[data-editor-id="vscode"]')!;
    targetRow.getBoundingClientRect = () => ({ top: 100, height: 40 }) as DOMRect;
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'finder'),
    };

    await fireEvent.dragStart(finderHandle, { dataTransfer });
    await dispatchDragEvent(targetRow, 'dragover', dataTransfer, 110);

    expect(sourceRow.dataset.dragging).toBe('true');
    expect(targetRow.dataset.dragOver).toBe('true');
    expect(sourceRow.className).not.toContain('ring');
    expect(targetRow.className).not.toContain('bg-muted');
    expect(document.querySelectorAll('[data-editor-insertion-line]')).toHaveLength(1);
    expect(document.querySelector('[data-editor-insertion-line]')?.parentElement).toBe(targetRow);
  });

  it('places exactly one insertion line before or after the row by pointer half', async () => {
    mocks.editors$.set([
      editor(),
      editor({ id: 'cursor', name: 'Cursor', appName: 'Cursor', handlerType: 'generic' }),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
    ]);

    renderApps();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'finder'),
    };
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    const vscodeRow = document.querySelector<HTMLElement>('[data-editor-id="vscode"]')!;
    const cursorRow = document.querySelector<HTMLElement>('[data-editor-id="cursor"]')!;
    vscodeRow.getBoundingClientRect = () => ({ top: 100, height: 40 }) as DOMRect;
    cursorRow.getBoundingClientRect = () => ({ top: 200, height: 40 }) as DOMRect;

    await fireEvent.dragStart(finderHandle, { dataTransfer });
    await dispatchDragEvent(vscodeRow, 'dragover', dataTransfer, 110);
    const beforeLine = document.querySelector<HTMLElement>('[data-editor-insertion-line]')!;
    expect(document.querySelectorAll('[data-editor-insertion-line]')).toHaveLength(1);
    expect(vscodeRow.dataset.dropPosition).toBe('before');
    expect(beforeLine.dataset.position).toBe('before');
    expect(beforeLine.style.position).toBe('absolute');
    expect(beforeLine.parentElement).toBe(vscodeRow);
    expect(vscodeRow.style.position).toBe('relative');

    await dispatchDragEvent(cursorRow, 'dragover', dataTransfer, 230);
    const afterLine = document.querySelector<HTMLElement>('[data-editor-insertion-line]')!;
    expect(document.querySelectorAll('[data-editor-insertion-line]')).toHaveLength(1);
    expect(cursorRow.dataset.dropPosition).toBe('after');
    expect(afterLine.dataset.position).toBe('after');
    expect(afterLine.style.position).toBe('absolute');
    expect(afterLine.parentElement).toBe(cursorRow);
    expect(vscodeRow.querySelector('[data-editor-insertion-line]')).toBeNull();
  });

  it('commits the pointer-selected after placement and cleans up on drag end', async () => {
    mocks.editors$.set([
      editor(),
      editor({ id: 'cursor', name: 'Cursor', appName: 'Cursor', handlerType: 'generic' }),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
    ]);

    renderApps();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'finder'),
      setDragImage: vi.fn(),
    };
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    const vscodeRow = document.querySelector<HTMLElement>('[data-editor-id="vscode"]')!;
    vscodeRow.getBoundingClientRect = () => ({ top: 100, height: 40 }) as DOMRect;

    await fireEvent.dragStart(finderHandle, { dataTransfer });
    await dispatchDragEvent(vscodeRow, 'dragover', dataTransfer, 130);
    await dispatchDragEvent(vscodeRow, 'drop', dataTransfer, 130);

    expect(mocks.dispatched).toContainEqual(setEditorOrder(['vscode', 'finder', 'cursor']));
    expect(document.querySelector('[data-editor-insertion-line]')).toBeNull();
    expect(document.querySelector('[data-editor-drag-preview]')).toBeNull();
    expect(document.querySelector('[data-editor-id="finder"]')?.dataset.dragging).toBeUndefined();

    const finderHandleAfterDrop = document.querySelector<HTMLElement>(
      '[data-editor-id="finder"] button',
    )!;
    await fireEvent.dragStart(finderHandleAfterDrop, { dataTransfer });
    await fireEvent.dragEnd(finderHandleAfterDrop);
    expect(document.querySelector('[data-editor-insertion-line]')).toBeNull();
    expect(document.querySelector('[data-editor-drag-preview]')).toBeNull();
  });

  it('cleans up the insertion line and ghost preview when the component is destroyed', async () => {
    mocks.editors$.set([
      editor(),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
    ]);

    const view = renderApps();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'finder'),
      setDragImage: vi.fn(),
    };
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    const vscodeRow = document.querySelector<HTMLElement>('[data-editor-id="vscode"]')!;
    vscodeRow.getBoundingClientRect = () => ({ top: 100, height: 40 }) as DOMRect;

    await fireEvent.dragStart(finderHandle, { dataTransfer });
    await dispatchDragEvent(vscodeRow, 'dragover', dataTransfer, 110);
    expect(document.querySelector('[data-editor-drag-preview]')).not.toBeNull();
    expect(document.querySelector('[data-editor-insertion-line]')).not.toBeNull();

    view.unmount();

    expect(document.querySelector('[data-editor-drag-preview]')).toBeNull();
    expect(document.querySelector('[data-editor-insertion-line]')).toBeNull();
  });

  it('provides keyboard reordering without changing toggle behavior', async () => {
    mocks.editors$.set([
      editor(),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
      editor({ id: 'cursor', name: 'Cursor', appName: 'Cursor', handlerType: 'generic' }),
    ]);

    renderApps();
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    await fireEvent.keyDown(finderHandle, { key: 'ArrowUp' });

    expect(mocks.dispatched).toContainEqual(setEditorOrder(['finder', 'vscode', 'cursor']));
    await waitFor(() => expect(renderedEditorIds()).toEqual(['finder', 'vscode', 'cursor']));
  });

  it('moves an editor down with keyboard reordering', async () => {
    mocks.editors$.set([
      editor(),
      editor({
        id: 'finder',
        name: 'Finder',
        appName: 'Finder',
        category: 'finder',
        handlerType: 'finder',
      }),
      editor({ id: 'cursor', name: 'Cursor', appName: 'Cursor', handlerType: 'generic' }),
    ]);

    renderApps();
    const finderHandle = screen.getByRole('button', { name: /Reorder Finder/ });
    await fireEvent.keyDown(finderHandle, { key: 'ArrowDown' });

    expect(mocks.dispatched).toContainEqual(setEditorOrder(['vscode', 'cursor', 'finder']));
    await waitFor(() => expect(renderedEditorIds()).toEqual(['vscode', 'cursor', 'finder']));
  });
});
