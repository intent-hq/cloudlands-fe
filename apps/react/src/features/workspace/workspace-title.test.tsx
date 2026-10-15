import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceTitle, WorkspaceTitleStatus } from './workspace-title';
import { store } from '@/store';
import { workspaceTitleSaga } from '@/store/workspace/sagas/workspace-title-saga';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectWorkspaceTitleOperations } from '@/store/workspace/workspace-title-selectors';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import type { Workspace } from '$shared/types';
const transport = vi.hoisted(() => ({ backendRequest: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backend: transport }));
let dispose: () => void,
  stop: () => void,
  root: ReturnType<typeof createRoot>,
  container: HTMLDivElement;
const ws = 'title-workspace';
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({
      id: ws,
      title: 'Original',
      myRole: 'owner',
      worktreePath: '/owned/repo',
    } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  transport.backendRequest.mockReset().mockImplementation(async (_method, params, options) => {
    options.onDispatch();
    return { workspace: { id: ws, title: params.title } };
  });
  stop = store.runSaga(workspaceTitleSaga);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <h1>
          <WorkspaceTitle workspaceId={ws} />
        </h1>
        <WorkspaceTitleStatus workspaceId={ws} />
      </>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
async function edit(value: string) {
  await act(async () => container.querySelector('button')!.click());
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function key(input: HTMLInputElement, value: string) {
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })),
  );
}
it('sends exactly one rename for Enter followed by blur and no writes for Escape/blank/unchanged', async () => {
  await key(await edit('discard this'), 'Escape');
  await key(await edit('   '), 'Enter');
  await key(await edit(' Original '), 'Enter');
  expect(transport.backendRequest).not.toHaveBeenCalled();
  const input = await edit('  Café 日本語  ');
  await key(input, 'Enter');
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(transport.backendRequest.mock.calls[0][1]).toEqual({
    workspaceId: ws,
    title: 'Café 日本語',
  });
  expect(selectWorkspaceTitleOperations.select(store.state, ws)).toEqual([
    expect.objectContaining({ status: 'confirmed' }),
  ]);
  await act(async () => {
    await vi.waitFor(() =>
      expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Café 日本語'),
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(container.querySelector('h1')!.textContent).toContain('Café 日本語');
  });
});
it('preserves an in-progress draft across an authoritative update and does not submit it against the newer base', async () => {
  const input = await edit('My draft');
  await act(async () =>
    store.dispatch(
      setWorkspaceEntity({ ...selectWorkspaceById.select(store.state, ws)!, title: 'External' }),
    ),
  );
  expect(input.value).toBe('My draft');
  await key(input, 'Enter');
  expect(transport.backendRequest).not.toHaveBeenCalled();
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('External');
});
it('shows failed and unknown outcomes without treating unknown as a retryable rollback', async () => {
  transport.backendRequest.mockRejectedValueOnce(new Error('offline before dispatch'));
  await key(await edit('Failed'), 'Enter');
  await act(async () => {
    await vi.waitFor(() =>
      expect(container.querySelector('[role=alert]')?.textContent).toContain('not saved'),
    );
  });
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw new Error('lost response');
  });
  await key(await edit('Unknown'), 'Enter');
  await act(async () => {
    await vi.waitFor(() =>
      expect(container.querySelector('[role=alert]')?.textContent).toContain('unknown'),
    );
  });
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Original');
});
it('declines an old edit after the authoritative title changes away and back', async () => {
  const input = await edit('My draft');
  await act(async () => {
    store.dispatch(
      setWorkspaceEntity({ ...selectWorkspaceById.select(store.state, ws)!, title: 'External' }),
    );
    store.dispatch(
      setWorkspaceEntity({ ...selectWorkspaceById.select(store.state, ws)!, title: 'Original' }),
    );
  });
  expect(input.value).toBe('My draft');
  await key(input, 'Enter');
  expect(transport.backendRequest).not.toHaveBeenCalled();
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Original');
});
