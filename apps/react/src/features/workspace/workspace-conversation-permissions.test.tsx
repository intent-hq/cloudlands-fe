// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { call, takeEvery } from 'typed-redux-saga';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceConversationPermissions } from './workspace-conversation-permissions';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { principalContextChanged } from '../../../../../src/store/renderer/slices/principal/principal-slice';
import {
  permissionRequestReceived,
  permissionScopeChanged,
  permissionResponseStarted,
  permissionResponseFailed,
  removePermissionRequest,
  selectPermissionOption,
} from '../../../../../src/store/renderer/slices/permission/permission-slice';
import type { PermissionRequest } from '../../../../../src/store/renderer/slices/permission/permission-types';
import {
  selectPermissionRecoveryScope,
  selectConversationPermissionRequests,
} from '@/store/permission/permission-selectors';
import { selectWorkspacePermissionContext } from '@/store/workspace/workspace-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

const workspaceId = WorkspaceId('permission-workspace');
const agentId = AgentId('permission-agent');
const prompt: PermissionRequest = {
  requestId: 'real-policy-fixture',
  workspaceId,
  sessionId: agentId,
  title: 'Implement this plan?',
  description: '{"plan":"Inspect the disposable fixture"}',
  timestamp: 1,
  options: [
    { id: 'implement_plan', label: 'Implement plan' },
    { id: 'revise_plan', label: 'Revise plan', destructive: true },
    { id: 'allow_always', label: 'Always allow' },
  ],
};
let dispose: () => void, root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const actions: unknown[] = [];
let stopObserving: () => void;
async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
async function render() {
  await act(async () =>
    root.render(
      <>
        <textarea aria-label="Composer" />
        <WorkspaceConversationPermissions workspaceId={workspaceId} agentId={agentId} />
      </>,
    ),
  );
}
const decisionButtons = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-permission-request] button'),
  ).filter((b) => /Implement plan|Revise plan/.test(b.textContent ?? ''));
async function key(target: HTMLElement, value: string) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      myRole: 'owner',
      path: '/owned/permission',
    } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId,
        backendSessionId: null,
        name: 'Permission agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
      },
    ]),
  );
  const scope = selectPermissionRecoveryScope.select(store.state);
  expect(scope).toBeTruthy();
  store.dispatch(permissionScopeChanged(scope));
  store.dispatch(permissionRequestReceived(prompt));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  actions.length = 0;
  stopObserving = store.runSaga(function* observeDecisions() {
    yield* takeEvery(selectPermissionOption, function* (action) {
      yield* call([actions, actions.push], action);
    });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopObserving();
  dispose();
  vi.unstubAllGlobals();
});
it('filters by the canonical session workspace and current subscription, without taking authority from prompt metadata', () => {
  expect(selectConversationPermissionRequests.select(store.state, workspaceId, agentId)).toEqual([
    prompt,
  ]);
  expect(
    selectConversationPermissionRequests.select(store.state, workspaceId, 'other-agent'),
  ).toEqual([]);
  expect(
    selectConversationPermissionRequests.select(store.state, 'other-workspace', agentId),
  ).toEqual([]);
  store.dispatch(
    permissionRequestReceived({
      ...prompt,
      requestId: 'wrong-workspace',
      workspaceId: 'other-workspace',
    }),
  );
  expect(selectConversationPermissionRequests.select(store.state, workspaceId, agentId)).toEqual([
    prompt,
  ]);
  store.dispatch(permissionScopeChanged('old-subscription'));
  store.dispatch(permissionRequestReceived(prompt));
  expect(selectConversationPermissionRequests.select(store.state, workspaceId, agentId)).toEqual(
    [],
  );
});
it('keeps shortcuts inside the focused permission host and out of composer editing', async () => {
  await render();
  expect(decisionButtons()).toHaveLength(2);
  expect(container.textContent).not.toContain('Always allow');
  const textarea = container.querySelector('textarea')!;
  await act(async () => textarea.focus());
  await key(textarea, '1');
  expect(actions).toHaveLength(0);
  await act(async () => decisionButtons()[0].focus());
  await key(decisionButtons()[0], '2');
  const context = selectWorkspacePermissionContext.select(store.state, workspaceId)!;
  expect(actions).toEqual([selectPermissionOption(prompt.requestId, 'revise_plan', context)]);
  await act(async () => textarea.focus());
  await key(textarea, 'Escape');
  expect(actions).toHaveLength(1);
});
it('renders submitting/failure/retry status from the canonical operation and retires resolved prompts', async () => {
  await render();
  const context = selectWorkspacePermissionContext.select(store.state, workspaceId)!;
  await act(async () => store.dispatch(permissionResponseStarted(prompt.requestId, context)));
  await flush();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(decisionButtons().every((b) => b.disabled)).toBe(true);
  await act(async () => decisionButtons()[0].click());
  expect(actions).toHaveLength(0);
  await act(async () =>
    store.dispatch(permissionResponseFailed(prompt.requestId, context, 1, 'offline')),
  );
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      m.chat_inlinePermission_responseFailed_error(),
    );
  });
  expect(decisionButtons().every((b) => !b.disabled)).toBe(true);
  await act(async () => decisionButtons()[0].click());
  expect(actions).toEqual([selectPermissionOption(prompt.requestId, 'implement_plan', context)]);
  await act(async () => store.dispatch(removePermissionRequest(prompt.requestId)));
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('[data-permission-request]')).toBeNull();
  });
});
it('rejects a retained old DOM callback before the principal retirement rerender', async () => {
  await render();
  const button = decisionButtons()[0];
  await act(async () => {
    store.dispatch(principalContextChanged(null));
    button.click();
  });
  expect(actions).toHaveLength(0);
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('[data-permission-request]')).toBeNull();
  });
});

it('removing a focused request must disarm shortcuts for later prompts', async () => {
  await render();
  await act(async () => decisionButtons()[0].focus());
  expect(document.activeElement).toBe(decisionButtons()[0]);
  await act(async () => store.dispatch(removePermissionRequest(prompt.requestId)));
  await flush();
  expect(document.activeElement).toBe(document.body);
  await act(async () =>
    store.dispatch(permissionRequestReceived({ ...prompt, requestId: 'second-prompt' })),
  );
  await flush();
  expect(document.activeElement).toBe(document.body);
  await key(document.body, '1');
  expect(actions).toHaveLength(0);
});
