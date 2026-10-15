import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { store } from '@/store';
import { DesktopPanels } from '@/features/desktop/desktop-panels';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  resetLayout,
  closePanel,
  splitPanel,
  focusPanel,
  resizePanelLayoutAtRootDivider,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { setShortcutOverride } from '../../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
vi.mock('@/features/desktop/desktop-note-preview', () => ({ DesktopNotePreview: () => null }));
let dispose: () => void, root: ReturnType<typeof createRoot>, host: HTMLDivElement;
let left: string, right: string;
const ws = 'review-workspace';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity({ id: ws, title: 'Review', myRole: 'owner' } as any));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(resetLayout(ws));
  left = selectDesktopLayout.select(store.state, ws).focusedPanelId!;
  const split = splitPanel(ws, left, 'horizontal');
  store.dispatch(split);
  right = split.payload.newPanelId;
  store.dispatch(focusPanel(ws, left));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  expect(selectAdmittedWorkspaceReadContext.select(store.state, ws)).not.toBeNull();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = (active = true) =>
  act(async () =>
    root.render(<DesktopPanels workspaceId={ws} active={active} onUnavailable={() => {}} />),
  );
const focus = () => selectDesktopLayout.select(store.state, ws).focusedPanelId;
async function press(
  target: EventTarget,
  key: string,
  mod: KeyboardEventInit = { ctrlKey: true, shiftKey: true },
) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mod }),
    );
  });
}
it('moves focus from the left panel to the right panel with the default column shortcut', async () => {
  await render();
  await press(host.querySelector('[data-panel-id]')!, ']');
  expect(focus()).toBe(right);
});
it('keeps column focus shortcuts available from editable content as the source does', async () => {
  await render();
  const input = document.createElement('input');
  host.querySelector('[data-panel-id]')!.append(input);
  input.focus();
  await press(input, ']');
  expect(focus()).toBe(right);
});
it('honors a configured column shortcut without Ctrl or Meta', async () => {
  store.dispatch(setShortcutOverride('panel.focus-next-column', 'alt+]'));
  await render();
  await press(host.querySelector('[data-panel-id]')!, ']', { altKey: true });
  expect(focus()).toBe(right);
});
it('does not let an inactive retained workspace consume panel keyboard actions', async () => {
  await render(false);
  await press(document.body, ']');
  expect(focus()).toBe(left);
});
it('does not handle panel keyboard actions when workspace admission is absent', async () => {
  store.dispatch(setWorkspaceHasLoaded(false, store.state.connections.windowBackendId, null));
  expect(selectAdmittedWorkspaceReadContext.select(store.state, ws)).toBeNull();
  await render();
  await press(host.querySelector('[data-panel-id]')!, ']');
  expect(focus()).toBe(left);
});
function pointer(target: EventTarget, type: string) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10 });
  target.dispatchEvent(event);
}
function captureDispatch() {
  const original = store.dispatch;
  const spy = vi.fn(original);
  vi.spyOn(store as { readonly dispatch: unknown }, 'dispatch', 'get').mockReturnValue(spy);
  return spy;
}
function commits(spy: any) {
  return spy.mock.calls.filter(([a]: any[]) => a.type === resizePanelLayoutAtRootDivider.type);
}
it('cancels a pending resize when its retained workspace becomes inactive', async () => {
  await render();
  const spy = captureDispatch();
  await act(async () => pointer(host.querySelector('.desktop-resize-handle')!, 'pointerdown'));
  await render(false);
  await act(async () => pointer(window, 'pointerup'));
  expect(commits(spy)).toHaveLength(0);
});
it('cancels a pending resize on unmount', async () => {
  await render();
  const spy = captureDispatch();
  await act(async () => pointer(host.querySelector('.desktop-resize-handle')!, 'pointerdown'));
  await act(async () => root.render(null));
  await act(async () => pointer(window, 'pointerup'));
  expect(commits(spy)).toHaveLength(0);
});
it('cancels a pending resize on Escape', async () => {
  await render();
  const spy = captureDispatch();
  await act(async () => pointer(host.querySelector('.desktop-resize-handle')!, 'pointerdown'));
  await press(window, 'Escape', {});
  await act(async () => pointer(window, 'pointerup'));
  expect(commits(spy)).toHaveLength(0);
});

it('retains the existing panel DOM when a second root column opens and closes', async () => {
  store.dispatch(closePanel(ws, right));
  await render();
  const original = host.querySelector(`[data-panel-id="${left}"]`);
  expect(original).not.toBeNull();
  const split = splitPanel(ws, left, 'horizontal');
  await act(async () => {
    store.dispatch(split);
  });
  expect(host.querySelector(`[data-panel-id="${left}"]`)).toBe(original);
  await act(async () => {
    store.dispatch(closePanel(ws, split.payload.newPanelId));
  });
  expect(host.querySelector(`[data-panel-id="${left}"]`)).toBe(original);
});
it('cancels a pending resize when canonical workspace admission is retired', async () => {
  await render();
  const spy = captureDispatch();
  await act(async () => pointer(host.querySelector('.desktop-resize-handle')!, 'pointerdown'));
  await act(async () => {
    store.dispatch(setWorkspaceHasLoaded(false, store.state.connections.windowBackendId, null));
  });
  await act(async () => pointer(window, 'pointerup'));
  expect(commits(spy)).toHaveLength(0);
});
