import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/store';
import {
  selectPrincipalActionContext,
  selectHostAdministrationContext,
} from '@/store/principal/principal-selectors';
import * as selectors from '../workspace-initializer-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import { createLocalWorkspaceCreateSaga } from '../../../../../../src/store/renderer/slices/workspace-initializer/sagas/local-workspace-create-saga-factory';
import {
  hydrateWorkspaceInitializer,
  localWorkspaceCreateRequested,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceLocalCreation,
  workspaceLocalCreationClosed,
  workspaceLocalCreationOpened,
} from '../../../../../../src/store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { principalContextChanged } from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import type { WorkspaceDomainClient } from '../../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import { call } from 'typed-redux-saga';

const stops: Array<() => void> = [];
const create = vi.fn<WorkspaceDomainClient['create']>();
const persist = vi.fn<() => Promise<boolean>>();
const validate = vi.fn();
const workspace = { id: WorkspaceId('created'), path: '/owned/workspaces/created' } as Workspace;
let key = 0;
function request(retry = false) {
  const authority = selectors.selectWorkspaceLocalCreationAuthority.select(store.state);
  expect(authority).toBeTruthy();
  store.dispatch(localWorkspaceCreateRequested(authority!, retry));
}
const outcome = () => store.state.workspaceInitializer.localCreation;
beforeEach(() => {
  stops.push(store.init(createAdmittedLegacyPrincipal()));
  store.dispatch(
    hydrateWorkspaceInitializer({
      localCreation: null,
      localReceiptContext: selectHostAdministrationContext.select(store.state),
    }),
  );
  store.dispatch(
    setCompactWorkspaceInitializerFormState({
      repoType: 'local',
      repoPath: '/owned/repository',
      branch: 'main',
    }),
  );
  store.dispatch(
    workspaceLocalCreationOpened('form', selectPrincipalActionContext.select(store.state)!),
  );
  create.mockReset().mockResolvedValue({ ok: true, data: { workspace } });
  persist.mockReset().mockResolvedValue(true);
  validate.mockReset().mockResolvedValue({
    valid: true,
    directoryStatus: { exists: true, isDirectory: true, isGitRepo: true },
  });
  const saga = createLocalWorkspaceCreateSaga({
    selectState: selectors.selectWorkspaceInitializerState,
    selectAuthority: selectors.selectWorkspaceLocalCreationAuthority,
    selectLease: selectors.selectWorkspaceLocalCreationLease,
    validateRepoPath: validate,
    create,
    persist: function* () {
      return yield* call(persist);
    },
    newId: () => `create-${++key}`,
  });
  stops.push(store.runSaga(saga));
});
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
});

describe('local workspace creation ownership', () => {
  it('blocks creation when saved request hydration failed or belongs to an earlier connection', () => {
    store.dispatch(hydrateWorkspaceInitializer({ localReceiptContext: null }));
    expect(selectors.selectWorkspaceLocalCreationReady.select(store.state)).toBe(false);
    expect(selectors.selectWorkspaceLocalCreationLease.select(store.state)).toBeNull();
    request();
    expect(create).not.toHaveBeenCalled();
    store.dispatch(hydrateWorkspaceInitializer({ localReceiptContext: 'retired-connection' }));
    expect(selectors.selectWorkspaceLocalCreationLease.select(store.state)).toBeNull();
  });
  it('durably retains the request key before one create and publishes only the returned workspace', async () => {
    let saved!: (value: boolean) => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          saved = resolve;
        }),
    );
    request();
    request();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
    const id = outcome()!.id;
    saved(true);
    await vi.waitFor(() => expect(outcome()?.status).toBe('success'));
    expect(create).toHaveBeenCalledExactlyOnceWith({
      repositoryPath: '/owned/repository',
      baseRef: 'main',
      idempotencyKey: id,
      progressId: id,
      isNewRepo: false,
      setupScript: 'cd .',
    });
    expect(outcome()?.workspaceId).toBe('created');
  });
  it('does not create when the durable receipt write fails', async () => {
    persist.mockResolvedValue(false);
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('failure'));
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a non-repository and permits a corrected definite retry', async () => {
    validate.mockResolvedValueOnce({ valid: false, error: 'Not a repository' });
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('failure'));
    expect(create).not.toHaveBeenCalled();
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('success'));
    expect(create).toHaveBeenCalledOnce();
  });
  it('uses a fresh key after a documented invalid-base refusal', async () => {
    create.mockResolvedValueOnce({
      ok: false,
      error: 'Invalid base',
      errorCode: 'base-ref-unresolvable',
    });
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('failure'));
    const old = outcome()!.id;
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('success'));
    expect(outcome()!.id).not.toBe(old);
  });
  it('requires explicit recovery and reuses the exact key and path after an uncertain response', async () => {
    create.mockRejectedValueOnce(new Error('Socket closed'));
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('uncertain'));
    const first = create.mock.calls[0][0];
    request();
    expect(create).toHaveBeenCalledOnce();
    store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/new', branch: 'other' }));
    request(true);
    await vi.waitFor(() => expect(outcome()?.status).toBe('success'));
    expect(create.mock.calls[1][0]).toEqual(first);
  });
  it('retains uncertainty on close and ignores the late created result', async () => {
    let done!: (value: Awaited<ReturnType<WorkspaceDomainClient['create']>>) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    request();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    store.dispatch(workspaceLocalCreationClosed('form'));
    await vi.waitFor(() => expect(outcome()?.status).toBe('uncertain'));
    done({ ok: true, data: { workspace } });
    await Promise.resolve();
    expect(outcome()?.workspaceId).toBeUndefined();
    store.dispatch(
      workspaceLocalCreationOpened('new-form', selectPrincipalActionContext.select(store.state)!),
    );
    request(true);
    await vi.waitFor(() => expect(outcome()?.status).toBe('success'));
    expect(create.mock.calls[1][0].idempotencyKey).toBe(create.mock.calls[0][0].idempotencyKey);
  });
  it('retires before dispatch when authority disappears during receipt persistence', async () => {
    let saved!: (value: boolean) => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          saved = resolve;
        }),
    );
    request();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    store.dispatch(principalContextChanged(null));
    saved(true);
    await vi.waitFor(() => expect(outcome()?.status).toBe('failure'));
    expect(create).not.toHaveBeenCalled();
    expect(selectors.selectWorkspaceLocalCreation.select(store.state)).toBeNull();
  });
  it('restores persisted pending as uncertain and does not create without an explicit recovery action', () => {
    const receipt = {
      id: 'old-key',
      authority: selectors.selectWorkspaceLocalCreationAuthority.select(store.state)!,
      repositoryPath: '/owned/old',
      baseRef: 'main',
      status: 'pending' as const,
    };
    store.dispatch(setWorkspaceLocalCreation(null));
    store.dispatch(hydrateWorkspaceInitializer({ localCreation: receipt }));
    expect(outcome()?.status).toBe('uncertain');
    request();
    expect(create).not.toHaveBeenCalled();
  });
});


describe('uncertain recovery preflight', () => {
  it.each(['validation', 'persistence', 'close'])('retains the original key after recovery %s fails', async (failure) => {
    create.mockRejectedValueOnce(new Error('Reply lost'));
    request();
    await vi.waitFor(() => expect(outcome()?.status).toBe('uncertain'));
    const original = create.mock.calls[0][0];
    let finishValidation: ((value: unknown) => void) | undefined;
    if (failure === 'validation') validate.mockResolvedValueOnce({ valid: false, error: 'Probe unavailable' });
    if (failure === 'persistence') persist.mockResolvedValueOnce(false);
    if (failure === 'close') validate.mockImplementationOnce(() => new Promise(resolve => { finishValidation = resolve; }));
    request(true);
    if (failure === 'close') {
      await vi.waitFor(() => expect(finishValidation).toBeDefined());
      store.dispatch(workspaceLocalCreationClosed('form'));
      finishValidation!({ valid: true, directoryStatus: { isGitRepo: true } });
      store.dispatch(workspaceLocalCreationOpened('reopened', selectPrincipalActionContext.select(store.state)!));
    }
    await vi.waitFor(() => expect(outcome()?.status).toBe('uncertain'));
    expect(outcome()?.id).toBe(original.idempotencyKey);
    request();
    expect(create).toHaveBeenCalledOnce();
    request(true);
    await vi.waitFor(() => expect(outcome()?.status).toBe('success'));
    expect(create.mock.calls[1][0]).toEqual(original);
  });
});
